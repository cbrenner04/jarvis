import { afterEach, beforeEach, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WriteWorkflowStep } from "../execution/workflow-runner.ts";
import type { WriteLoopInput } from "../execution/write-loop.ts";
import { openLogReader } from "../persistence/log-stream.ts";
import { openStateStore, type RunStatus, type StateStore } from "../persistence/state-store.ts";
import { flushBackgroundRuns, listRunsDirect, mockWriteLoopInput, startRunDirect } from "../testing/run-control.ts";
import { doneWithArtifactBindingFactory, writeStepFixtures } from "../testing/workflow-step-fixtures.ts";
import { createRunControlHandlers, createRunExecutionFailureReporter } from "./daemon.ts";

type Handlers = ReturnType<typeof createRunControlHandlers>;

const { createWriteStep } = writeStepFixtures();

let stateStore: StateStore;
let logsPath: string;
let reportedFailures: Array<{ runId: string; reason: unknown }>;
let failureReporter: (runId: string, reason: unknown) => void | Promise<void>;
let executorBehavior: "reject" | "resolve";
let handlers: Handlers;

function createHandlers(): Handlers {
  const writeLoopExecutor = async (
    _input: WriteLoopInput,
    _signal: AbortSignal,
    _pauseSignal: AbortSignal,
  ): Promise<void> => {
    if (executorBehavior === "reject") {
      throw new Error("executor boom");
    }
  };

  return createRunControlHandlers({
    stateStore,
    writeLoopExecutor,
    failureReporter,
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
  const runId = await startRunDirect(handlers);
  await flushBackgroundRuns();

  const run = stateStore.loadRun(runId as string);
  expect(run?.status).toBe("failed");
});

test("executor rejection appends exactly one run_execution_failed via failure reporter", async () => {
  failureReporter = createRunExecutionFailureReporter(logsPath);
  handlers = createHandlers();

  const runId = await startRunDirect(handlers);
  await flushBackgroundRuns();

  const records = openLogReader(logsPath).tail(runId as string);
  expect(records).toHaveLength(1);
  expect(records[0]?.event).toEqual({ kind: "run_execution_failed" });
});

test("failed run keeps in-progress attempt row", async () => {
  const runId = await startRunDirect(handlers);
  stateStore.recordAttemptStart(runId as string);
  await flushBackgroundRuns();

  const run = stateStore.loadRun(runId as string);
  expect(run?.status).toBe("failed");
  const latestAttempt = run?.attempts.at(-1);
  expect(latestAttempt?.status).toBe("in-progress");
});

test("after executor rejection list reports isLive false and accepts second start", async () => {
  const input = mockWriteLoopInput();
  const runId = await startRunDirect(handlers, input);
  await flushBackgroundRuns();

  const runs = await listRunsDirect(handlers);
  const failedRun = runs?.find((candidate) => candidate.runId === runId);
  expect(failedRun?.isLive).toBe(false);
  expect(failedRun?.status).toBe("failed");

  executorBehavior = "resolve";
  await startRunDirect(handlers, input);
});

test("failure reporter throw keeps failed status and releases ownership", async () => {
  failureReporter = async () => {
    throw new Error("reporter failed");
  };
  handlers = createHandlers();

  const input = mockWriteLoopInput();
  const runId = await startRunDirect(handlers, input);
  await flushBackgroundRuns();

  const run = stateStore.loadRun(runId as string);
  expect(run?.status).toBe("failed");

  const runs = await listRunsDirect(handlers);
  expect(runs?.find((candidate) => candidate.runId === runId)?.isLive).toBe(false);

  executorBehavior = "resolve";
  await startRunDirect(handlers, input);
});

test("spawn boundary forwards original rejection to failure reporter", async () => {
  class CustomExecutorError extends Error {
    constructor() {
      super("custom executor failure");
      this.name = "CustomExecutorError";
    }
  }

  const writeLoopExecutor = async (): Promise<void> => {
    throw new CustomExecutorError();
  };

  handlers = createRunControlHandlers({
    stateStore,
    writeLoopExecutor,
    failureReporter: (runId, reason) => {
      reportedFailures.push({ runId, reason });
    },
    hasMemoryHeadroom: () => true,
    settleDelayMs: 0,
  });

  await startRunDirect(handlers);
  await flushBackgroundRuns();

  const reason = reportedFailures[0]?.reason;
  expect(reason).toBeInstanceOf(CustomExecutorError);
  expect((reason as Error).message).toBe("custom executor failure");
});

test("terminal durable status is not overwritten on executor rejection", async () => {
  let releaseExecutor!: (err: Error) => void;
  const writeLoopExecutor = async (): Promise<void> => {
    await new Promise<void>((_resolve, reject) => {
      releaseExecutor = reject;
    });
  };

  const setRunStatusCalls: string[] = [];
  const originalSetRunStatus = stateStore.setRunStatus.bind(stateStore);
  stateStore.setRunStatus = (runId, status) => {
    setRunStatusCalls.push(status);
    originalSetRunStatus(runId, status);
  };

  handlers = createRunControlHandlers({
    stateStore,
    writeLoopExecutor,
    failureReporter,
    hasMemoryHeadroom: () => true,
    settleDelayMs: 0,
  });

  const runId = await startRunDirect(handlers);
  await flushBackgroundRuns();

  stateStore.setRunStatus(runId as string, "killed");
  releaseExecutor(new Error("executor boom"));
  await flushBackgroundRuns();

  const run = stateStore.loadRun(runId as string);
  expect(run?.status).toBe("killed");
  expect(setRunStatusCalls.filter((status) => status === "failed")).toHaveLength(0);
});

test("settled executor does not invoke failure reporter", async () => {
  executorBehavior = "resolve";
  handlers = createHandlers();

  await startRunDirect(handlers);
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

/** After `createRun` for `stepId`, pin terminal status so later in-progress writes are ignored. */
function lockTerminalStatusOnStepCreate(store: StateStore, stepId: string, status: RunStatus): StateStore {
  const locked = new Map<string, RunStatus>();
  return new Proxy(store, {
    get(target, prop, receiver) {
      if (prop === "createRun") {
        return (...args: Parameters<StateStore["createRun"]>) => {
          const runId = target.createRun(...args);
          if (args[0]?.stepId === stepId) {
            locked.set(runId, status);
            target.setRunStatus(runId, status);
          }
          return runId;
        };
      }
      if (prop === "setRunStatus") {
        return (...args: Parameters<StateStore["setRunStatus"]>) => {
          const [runId, nextStatus] = args;
          const lock = locked.get(runId);
          if (lock !== undefined && nextStatus !== lock) {
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

test("workflow async-path failure after step 0's row demotes durable status and appends a terminal record", async () => {
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
  expect(run?.status).toBe("failed");

  const records = openLogReader(logsPath).tail(failedRunId as string);
  const terminalRecords = records.filter((record) => record.event.kind === "run_execution_failed");
  expect(terminalRecords).toHaveLength(1);
  expect(terminalRecords[0]?.event).toEqual({ kind: "run_execution_failed", message: "recordAttemptStart boom" });

  const row = (await listRunsDirect(workflowHandlers))?.find((r) => r.runId === failedRunId);
  expect(row?.isLive).toBe(false);

  const waitResponse = await workflowHandlers.wait(
    requestFrame("w1", "wait", { runId: failedRunId }),
    new AbortController().signal,
  );
  expect(waitResponse).toMatchObject({
    kind: "response",
    result: { runStatus: "failed", error: { reason: "harness_failure" } },
  });

  const secondSteps: WriteWorkflowStep[] = [workflowStep("step-1", `${branch}-retry`)];
  const secondResponse = await workflowHandlers.start(
    requestFrame("s2", "start", { steps: secondSteps }),
    new AbortController().signal,
  );
  expect(secondResponse.kind).toBe("response");
});

test("a run already terminal at rejection time is not re-demoted and gets no terminal record", async () => {
  const branch = "workflow-killed";
  const failingStore = throwOnNthRecordAttemptStart(lockTerminalStatusOnStepCreate(stateStore, "step-2", "killed"), 2);
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

  const killedRunId = findStepRunId(stateStore, branch, "step-2");
  expect(killedRunId).toBeTruthy();

  const run = stateStore.loadRun(killedRunId as string);
  expect(run?.status).toBe("killed");

  const records = openLogReader(logsPath).tail(killedRunId as string);
  const terminalRecords = records.filter((record) => record.event.kind === "run_execution_failed");
  expect(terminalRecords).toHaveLength(0);
});
