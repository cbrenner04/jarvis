import { afterEach, beforeEach, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WriteWorkflowStep } from "../execution/workflow-runner.ts";
import type { WriteLoopInput } from "../execution/write-loop.ts";
import { openLogReader } from "../persistence/log-stream.ts";
import { openStateStore, type StateStore } from "../persistence/state-store.ts";
import { flushBackgroundRuns, listRunsDirect } from "../testing/run-control.ts";
import {
  createBindingFactory,
  doneWithArtifactBindingFactory,
  writeStepFixtures,
} from "../testing/workflow-step-fixtures.ts";
import { createRunControlHandlers, createRunExecutionFailureReporter } from "./daemon.ts";

type Handlers = ReturnType<typeof createRunControlHandlers>;

const { createWriteStep } = writeStepFixtures();

function executorBindingFactory() {
  return createBindingFactory(async () => {
    if (executorBehavior === "reject") {
      throw new Error("executor boom");
    }
    return { kind: "ok", stdout: "done", stderr: "" } as const;
  });
}

async function startWorkflowRun(
  h: Handlers,
  branch = "failure-capture",
  createBinding = executorBindingFactory(),
): Promise<string> {
  const step = createWriteStep("step-1", branch, createBinding, { suppressShrink: true });
  const response = await h.start(requestFrame("wf-start", "start", { steps: [step] }), new AbortController().signal);
  expect(response.kind).toBe("response");
  const runId = response.kind === "response" ? (response.result as { runId?: string }).runId : undefined;
  if (!runId) throw new Error("expected workflow run id");
  return runId;
}

let stateStore: StateStore;
let logsPath: string;
let reportedFailures: Array<{ runId: string; reason: unknown }>;
let failureReporter: (runId: string, reason: unknown) => void | Promise<void>;
let executorBehavior: "reject" | "resolve";
let handlers: Handlers;

function createHandlers(): Handlers {
  const writeLoopExecutor = async (_input: WriteLoopInput, _signal: AbortSignal): Promise<void> => {
    if (executorBehavior === "reject") {
      throw new Error("executor boom");
    }
  };

  return createRunControlHandlers({
    stateStore,
    writeLoopExecutor,
    failureReporter,
    logReader: openLogReader(logsPath),
    hasMemoryHeadroom: () => true,
    settleDelayMs: 0,
  });
}

beforeEach(() => {
  stateStore = openStateStore(join(tmpdir(), `jarvis-failure-state-${process.pid}-${Date.now()}.db`));
  logsPath = join(tmpdir(), `jarvis-failure-logs-${process.pid}-${Date.now()}.jsonl`);
  reportedFailures = [];
  executorBehavior = "reject";
  failureReporter = (runId, reason) => {
    reportedFailures.push({ runId, reason });
  };

  handlers = createHandlers();
});

afterEach(() => {
  try {
    stateStore.close();
  } catch {
    // store may be closed
  }
});

test("executor rejection sets durable status to failed", async () => {
  const runId = await startWorkflowRun(handlers);
  await flushBackgroundRuns();

  const run = stateStore.loadRun(runId as string);
  expect(run?.status).toBe("failed");
});

test("failed run keeps in-progress attempt row", async () => {
  const runId = await startWorkflowRun(handlers);
  stateStore.recordAttemptStart(runId);
  await flushBackgroundRuns();

  const run = stateStore.loadRun(runId as string);
  expect(run?.status).toBe("failed");
  const latestAttempt = run?.attempts.at(-1);
  expect(latestAttempt?.status).toBe("in-progress");
});

test("after executor rejection list reports isLive false and accepts second start", async () => {
  const branch = "failure-second-start";
  const runId = await startWorkflowRun(handlers, branch);
  await flushBackgroundRuns();

  const runs = await listRunsDirect(handlers);
  const failedRun = runs?.find((candidate) => candidate.runId === runId);
  expect(failedRun?.isLive).toBe(false);
  expect(failedRun?.status).toBe("failed");

  executorBehavior = "resolve";
  await startWorkflowRun(handlers, branch);
});

test("failure reporter throw keeps failed status and releases ownership", async () => {
  failureReporter = async () => {
    throw new Error("reporter failed");
  };
  handlers = createHandlers();

  const branch = "failure-reporter-throw";
  const runId = await startWorkflowRun(handlers, branch);
  await flushBackgroundRuns();

  const run = stateStore.loadRun(runId);
  expect(run?.status).toBe("failed");

  const runs = await listRunsDirect(handlers);
  expect(runs?.find((candidate) => candidate.runId === runId)?.isLive).toBe(false);

  executorBehavior = "resolve";
  await startWorkflowRun(handlers, branch);
});

test("settled executor does not invoke failure reporter", async () => {
  executorBehavior = "resolve";
  handlers = createHandlers();

  await startWorkflowRun(handlers, "failure-settled");
  await flushBackgroundRuns();

  expect(reportedFailures).toHaveLength(0);
});

test("createRunExecutionFailureReporter appends run_execution_failed through log sink", async () => {
  const path = join(tmpdir(), `jarvis-prod-reporter-${process.pid}-${Date.now()}.jsonl`);
  const reporter = createRunExecutionFailureReporter(path);

  await reporter("run-abc", new Error("ignored"));

  const records = openLogReader(path).tail("run-abc");
  expect(records).toHaveLength(1);
  expect(records[0]?.event).toEqual({ kind: "run_execution_failed" });
});

// --- Workflow async-path failure capture (steps-based start) ---

/** Wraps a real store so `recordAttemptStart`'s Nth call (1-indexed) throws. */
function throwOnNthRecordAttemptStart(store: StateStore, n: number): StateStore {
  let calls = 0;
  return new Proxy(store, {
    get(target, prop, receiver) {
      if (prop === "recordAttemptStart") {
        return (...args: Parameters<StateStore["recordAttemptStart"]>) => {
          calls += 1;
          if (calls === n) {
            throw new Error("recordAttemptStart boom");
          }
          return target.recordAttemptStart(...args);
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}

/** After `createRun` for `stepId`, pin completed settlement so later in-progress writes are ignored. */
function lockCompletedSettlementOnStepCreate(store: StateStore, stepId: string): StateStore {
  const locked = new Set<string>();
  return new Proxy(store, {
    get(target, prop, receiver) {
      if (prop === "createRun") {
        return (...args: Parameters<StateStore["createRun"]>) => {
          const runId = target.createRun(...args);
          if (args[0]?.stepId === stepId) {
            locked.add(runId);
            target.commitTerminalRunSettlement({ runId, status: "completed", terminalCause: "complete" });
          }
          return runId;
        };
      }
      if (prop === "setRunStatus") {
        return (...args: Parameters<StateStore["setRunStatus"]>) => {
          const [runId, nextStatus] = args;
          if (locked.has(runId) && nextStatus !== "completed") {
            return;
          }
          return target.setRunStatus(...args);
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}

function requestFrame(id: string, method: string, params?: unknown) {
  return { kind: "request" as const, id, method, params };
}

function workflowStep(stepId: string, branch: string): WriteWorkflowStep {
  return createWriteStep(stepId, branch, doneWithArtifactBindingFactory, { suppressShrink: true });
}

function findStepRunId(store: StateStore, branch: string, stepId: string): string | undefined {
  return store.findRunByProjectBranch({ project: "demo", branch, stepId })?.id;
}

test("workflow async rejection exposes atomic durable cause and evidence", async () => {
  const branch = "workflow-async-failure";
  const failingStore = throwOnNthRecordAttemptStart(stateStore, 2);
  const workflowHandlers = createRunControlHandlers({
    stateStore: failingStore,
    writeLoopExecutor: async () => {},
    failureReporter: () => {},
    hasMemoryHeadroom: () => true,
    logsPath,
    logReader: openLogReader(logsPath),
    operatorSessionId: "workflow-async-failure-test",
  });

  const steps: WriteWorkflowStep[] = [workflowStep("step-1", branch), workflowStep("step-2", branch)];
  const response = await workflowHandlers.start(requestFrame("s1", "start", { steps }), new AbortController().signal);
  expect(response.kind).toBe("response");

  await flushBackgroundRuns(5);

  const failedRunId = findStepRunId(stateStore, branch, "step-2");
  expect(failedRunId).toBeTruthy();

  const run = stateStore.loadRun(failedRunId as string);
  expect(run).toMatchObject({
    status: "failed",
    terminalCause: "invocation_failure",
    terminalFailureDetail: { failureKind: "error", bindingAttempts: [], message: "recordAttemptStart boom" },
  });

  const records = openLogReader(logsPath).tail(failedRunId as string);
  const terminalRecords = records.filter((record) => record.event.kind === "run_execution_failed");
  expect(terminalRecords).toHaveLength(1);
  expect(terminalRecords[0]?.event).toEqual({ kind: "run_execution_failed", message: "recordAttemptStart boom" });

  const row = (await listRunsDirect(workflowHandlers))?.find((r) => r.runId === failedRunId);
  expect(row).toMatchObject({
    status: "failed",
    isLive: false,
    loopOutcomeKind: "invocation_failure",
    error: { reason: "invocation_error", message: "recordAttemptStart boom" },
  });

  const waitResponse = await workflowHandlers.wait(
    requestFrame("w1", "wait", { runId: failedRunId }),
    new AbortController().signal,
  );
  expect(waitResponse).toMatchObject({
    kind: "response",
    result: {
      runStatus: "failed",
      loopOutcomeKind: "invocation_failure",
      error: { reason: "invocation_error", message: "recordAttemptStart boom" },
    },
  });

  const secondSteps: WriteWorkflowStep[] = [workflowStep("step-1", `${branch}-retry`)];
  const secondResponse = await workflowHandlers.start(
    requestFrame("s2", "start", { steps: secondSteps }),
    new AbortController().signal,
  );
  expect(secondResponse.kind).toBe("response");
  // Settle the retry before teardown closes the store: its publication tail is still running.
  const retryRunId = (secondResponse as { result: { runId: string } }).result.runId;
  await workflowHandlers.wait(requestFrame("w2", "wait", { runId: retryRunId }), new AbortController().signal);
});

test("a run already terminal at rejection time is not re-demoted but still records the failure", async () => {
  const branch = "workflow-completed";
  const failingStore = throwOnNthRecordAttemptStart(lockCompletedSettlementOnStepCreate(stateStore, "step-2"), 2);
  const workflowHandlers = createRunControlHandlers({
    stateStore: failingStore,
    writeLoopExecutor: async () => {},
    failureReporter: () => {},
    hasMemoryHeadroom: () => true,
    logsPath,
    logReader: openLogReader(logsPath),
    operatorSessionId: "workflow-async-failure-test",
  });

  const steps: WriteWorkflowStep[] = [workflowStep("step-1", branch), workflowStep("step-2", branch)];
  const response = await workflowHandlers.start(requestFrame("s1", "start", { steps }), new AbortController().signal);
  expect(response.kind).toBe("response");

  await flushBackgroundRuns(5);

  const completedRunId = findStepRunId(stateStore, branch, "step-2");
  expect(completedRunId).toBeTruthy();

  const run = stateStore.loadRun(completedRunId as string);
  expect(run).toMatchObject({ status: "completed", terminalCause: "complete", terminalFailureDetail: null });

  const records = openLogReader(logsPath).tail(completedRunId as string);
  const terminalRecords = records.filter((record) => record.event.kind === "run_execution_failed");
  expect(terminalRecords).toHaveLength(1);
});
