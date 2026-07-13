import { afterEach, beforeEach, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { InvocationBinding, InvocationResult } from "../../../shared/invocation/execute.ts";
import type { WriteWorkflowStep } from "../execution/workflow-runner.ts";
import { openLogReader } from "../persistence/log-stream.ts";
import { openStateStore, type RunStatus, type StateStore } from "../persistence/state-store.ts";
import { listRunsDirect } from "../testing/run-control.ts";
import { createFakeWithExternalWorktree, createJarvisHome, trackedTempRoots } from "../testing/write-fixtures.ts";
import { createRunControlHandlers } from "./daemon.ts";

const { roots } = trackedTempRoots();

const DEFAULT_AGENT_MODEL_CONFIG = {
  claude: {
    implement: { rungs: [{ adapterModel: "M1", priceKey: "P1" }] },
    shrink: { rungs: [{ adapterModel: "S1", priceKey: "P1" }] },
  },
};

function createBindingFactory(
  invoke: (binding: { agentId: string; adapterModel: string; cwd: string }) => Promise<InvocationResult>,
): NonNullable<WriteWorkflowStep["createBinding"]> {
  return ({ agentId, adapterModel }: { agentId: string; adapterModel: string }) => {
    return {
      id: `${agentId}/${adapterModel}`,
      invoke: ({ cwd }: Parameters<InvocationBinding["invoke"]>[0]) => invoke({ agentId, adapterModel, cwd }),
      metadata: { agent: agentId, model: adapterModel },
    } satisfies InvocationBinding;
  };
}

const doneWithArtifactBindingFactory = createBindingFactory(async ({ cwd }) => {
  writeFileSync(join(cwd, "proof.txt"), "done\n", "utf8");
  return { kind: "ok", stdout: "done", stderr: "" } as const;
});

function createWriteStep(stepId: string, branchName: string): WriteWorkflowStep {
  const home = createJarvisHome();
  roots.push(home.jarvisRoot);
  return {
    behavior: "write",
    worktree: {
      projectRoot: "/fake",
      projectName: "demo",
      branchName,
      baseRef: "HEAD",
      jarvisRoot: home.jarvisRoot,
    },
    specPath: "spec.md",
    stepRules: "Return exactly one terminal token.",
    expectedArtifactPath: "proof.txt",
    role: "implement",
    suppressShrink: true,
    agents: ["claude"],
    agentModelConfig: DEFAULT_AGENT_MODEL_CONFIG,
    createBinding: doneWithArtifactBindingFactory,
    withExternalWorktree: createFakeWithExternalWorktree(home.jarvisRoot),
    stepId,
  };
}

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

async function flushBackgroundRuns(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

function findStepRunId(store: StateStore, branch: string, stepId: string): string | undefined {
  return store.findRunByProjectBranch({ project: "demo", branch, stepId })?.id;
}

let stateStore: StateStore;
let logsPath: string;

beforeEach(() => {
  stateStore = openStateStore(join(tmpdir(), `jarvis-workflow-async-failure-${process.pid}-${Date.now()}-${Math.random()}.db`));
  logsPath = join(tmpdir(), `jarvis-workflow-async-failure-${process.pid}-${Date.now()}-${Math.random()}.jsonl`);
});

afterEach(() => {
  try {
    stateStore.close();
  } catch {
    // already closed
  }
});

test("workflow async-path failure after step 0's row demotes durable status and appends a terminal record", async () => {
  const branch = "workflow-async-failure";
  const failingStore = throwOnNthRecordAttemptStart(stateStore, 2);
  const handlers = createRunControlHandlers({
    stateStore: failingStore,
    writeLoopExecutor: async () => {},
    failureReporter: () => {},
    hasMemoryHeadroom: () => true,
    logsPath,
    logReader: openLogReader(logsPath),
    operatorSessionId: "workflow-async-failure-test",
  });

  const steps: WriteWorkflowStep[] = [createWriteStep("step-1", branch), createWriteStep("step-2", branch)];
  const response = await handlers.start(requestFrame("s1", "start", { steps }), new AbortController().signal);
  expect(response.kind).toBe("response");

  await flushBackgroundRuns();

  const failedRunId = findStepRunId(stateStore, branch, "step-2");
  expect(failedRunId).toBeTruthy();

  const run = stateStore.loadRun(failedRunId as string);
  expect(run?.status).toBe("failed");

  const records = openLogReader(logsPath).tail(failedRunId as string);
  const terminalRecords = records.filter((record) => record.event.kind === "run_execution_failed");
  expect(terminalRecords).toHaveLength(1);
  expect(terminalRecords[0]?.event).toEqual({ kind: "run_execution_failed", message: "recordAttemptStart boom" });

  const row = (await listRunsDirect(handlers))?.find((r) => r.runId === failedRunId);
  expect(row?.isLive).toBe(false);

  const waitResponse = await handlers.wait(
    requestFrame("w1", "wait", { runId: failedRunId }),
    new AbortController().signal,
  );
  expect(waitResponse).toMatchObject({
    kind: "response",
    result: { runStatus: "failed", error: { reason: "harness_failure" } },
  });

  const secondSteps: WriteWorkflowStep[] = [createWriteStep("step-1", `${branch}-retry`)];
  const secondResponse = await handlers.start(
    requestFrame("s2", "start", { steps: secondSteps }),
    new AbortController().signal,
  );
  expect(secondResponse.kind).toBe("response");
});

test("workflow rejection before step 0's row exists still resolves start with invalid_params", async () => {
  const handlers = createRunControlHandlers({
    stateStore,
    writeLoopExecutor: async () => {},
    failureReporter: () => {},
    hasMemoryHeadroom: () => true,
    logsPath,
    operatorSessionId: "workflow-async-failure-test",
  });

  const duplicateStepId = "dup";
  const steps: WriteWorkflowStep[] = [
    createWriteStep(duplicateStepId, "b1"),
    createWriteStep(duplicateStepId, "b2"),
  ];
  const response = await handlers.start(requestFrame("s1", "start", { steps }), new AbortController().signal);
  expect(response.kind).toBe("error");
  if (response.kind === "error") {
    expect(response.message).toContain(duplicateStepId);
  }
});

test("a run already terminal (failed) at rejection time is not re-demoted and gets no terminal record", async () => {
  const branch = "workflow-already-failed";
  const failingStore = throwOnNthRecordAttemptStart(
    lockTerminalStatusOnStepCreate(stateStore, "step-2", "failed"),
    2,
  );
  const handlers = createRunControlHandlers({
    stateStore: failingStore,
    writeLoopExecutor: async () => {},
    failureReporter: () => {},
    hasMemoryHeadroom: () => true,
    logsPath,
    operatorSessionId: "workflow-async-failure-test",
  });

  const steps: WriteWorkflowStep[] = [createWriteStep("step-1", branch), createWriteStep("step-2", branch)];
  const response = await handlers.start(requestFrame("s1", "start", { steps }), new AbortController().signal);
  expect(response.kind).toBe("response");

  await flushBackgroundRuns();

  const failedRunId = findStepRunId(stateStore, branch, "step-2");
  expect(failedRunId).toBeTruthy();

  const records = openLogReader(logsPath).tail(failedRunId as string);
  const terminalRecords = records.filter((record) => record.event.kind === "run_execution_failed");
  expect(terminalRecords).toHaveLength(0);
});

test("a run already paused at rejection time is not re-demoted and gets no terminal record", async () => {
  const branch = "workflow-paused";
  const failingStore = throwOnNthRecordAttemptStart(
    lockTerminalStatusOnStepCreate(stateStore, "step-2", "paused"),
    2,
  );
  const handlers = createRunControlHandlers({
    stateStore: failingStore,
    writeLoopExecutor: async () => {},
    failureReporter: () => {},
    hasMemoryHeadroom: () => true,
    logsPath,
    operatorSessionId: "workflow-async-failure-test",
  });

  const steps: WriteWorkflowStep[] = [createWriteStep("step-1", branch), createWriteStep("step-2", branch)];
  const response = await handlers.start(requestFrame("s1", "start", { steps }), new AbortController().signal);
  expect(response.kind).toBe("response");

  await flushBackgroundRuns();

  const pausedRunId = findStepRunId(stateStore, branch, "step-2");
  expect(pausedRunId).toBeTruthy();

  const run = stateStore.loadRun(pausedRunId as string);
  expect(run?.status).toBe("paused");

  const records = openLogReader(logsPath).tail(pausedRunId as string);
  const terminalRecords = records.filter((record) => record.event.kind === "run_execution_failed");
  expect(terminalRecords).toHaveLength(0);
});

test("no configured log sink: durable demotion still lands, no append attempted", async () => {
  const branch = "workflow-no-sink";
  const failingStore = throwOnNthRecordAttemptStart(stateStore, 2);
  const handlers = createRunControlHandlers({
    stateStore: failingStore,
    writeLoopExecutor: async () => {},
    failureReporter: () => {},
    hasMemoryHeadroom: () => true,
  });

  const steps: WriteWorkflowStep[] = [createWriteStep("step-1", branch), createWriteStep("step-2", branch)];
  const response = await handlers.start(requestFrame("s1", "start", { steps }), new AbortController().signal);
  expect(response.kind).toBe("response");

  await flushBackgroundRuns();

  const failedRunId = findStepRunId(stateStore, branch, "step-2");
  expect(failedRunId).toBeTruthy();

  const run = stateStore.loadRun(failedRunId as string);
  expect(run?.status).toBe("failed");
});

test("fault injection: throwing setRunStatus still releases ownership, closes sink, and still appends", async () => {
  const branch = "workflow-set-status-throws";
  const withThrowingDemote = new Proxy(stateStore, {
    get(target, prop, receiver) {
      if (prop === "setRunStatus") {
        return (...args: Parameters<StateStore["setRunStatus"]>) => {
          if (args[1] === "failed") {
            throw new Error("setRunStatus boom");
          }
          return target.setRunStatus(...args);
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  });
  const failingStore = throwOnNthRecordAttemptStart(withThrowingDemote, 2);
  const handlers = createRunControlHandlers({
    stateStore: failingStore,
    writeLoopExecutor: async () => {},
    failureReporter: () => {},
    hasMemoryHeadroom: () => true,
    logsPath,
    operatorSessionId: "workflow-async-failure-test",
  });

  const steps: WriteWorkflowStep[] = [createWriteStep("step-1", branch), createWriteStep("step-2", branch)];
  const response = await handlers.start(requestFrame("s1", "start", { steps }), new AbortController().signal);
  expect(response.kind).toBe("response");

  await flushBackgroundRuns();

  const failedRunId = findStepRunId(stateStore, branch, "step-2");
  expect(failedRunId).toBeTruthy();

  const records = openLogReader(logsPath).tail(failedRunId as string);
  const terminalRecords = records.filter((record) => record.event.kind === "run_execution_failed");
  expect(terminalRecords).toHaveLength(1);

  const secondSteps: WriteWorkflowStep[] = [createWriteStep("step-1", `${branch}-retry`)];
  const secondResponse = await handlers.start(
    requestFrame("s2", "start", { steps: secondSteps }),
    new AbortController().signal,
  );
  expect(secondResponse.kind).toBe("response");
});

test("fault injection: throwing logSink.append still demotes durable status and releases ownership", async () => {
  const branch = "workflow-append-throws";
  const failingStore = throwOnNthRecordAttemptStart(stateStore, 2);
  const handlers = createRunControlHandlers({
    stateStore: failingStore,
    writeLoopExecutor: async () => {},
    failureReporter: () => {},
    hasMemoryHeadroom: () => true,
    logsPath: join(tmpdir(), "does-not-exist", "unwritable.jsonl"),
    operatorSessionId: "workflow-async-failure-test",
  });

  const steps: WriteWorkflowStep[] = [createWriteStep("step-1", branch), createWriteStep("step-2", branch)];
  const response = await handlers.start(requestFrame("s1", "start", { steps }), new AbortController().signal);
  expect(response.kind).toBe("response");

  await flushBackgroundRuns();

  const failedRunId = findStepRunId(stateStore, branch, "step-2");
  expect(failedRunId).toBeTruthy();

  const run = stateStore.loadRun(failedRunId as string);
  expect(run?.status).toBe("failed");

  const secondSteps: WriteWorkflowStep[] = [createWriteStep("step-1", `${branch}-retry`)];
  const secondResponse = await handlers.start(
    requestFrame("s2", "start", { steps: secondSteps }),
    new AbortController().signal,
  );
  expect(secondResponse.kind).toBe("response");
});

test("a run already killed at rejection time (kill committed before the abort-driven rejection surfaces) is not re-demoted and gets no terminal record", async () => {
  const branch = "workflow-killed";
  const failingStore = throwOnNthRecordAttemptStart(
    lockTerminalStatusOnStepCreate(stateStore, "step-2", "killed"),
    2,
  );
  const handlers = createRunControlHandlers({
    stateStore: failingStore,
    writeLoopExecutor: async () => {},
    failureReporter: () => {},
    hasMemoryHeadroom: () => true,
    logsPath,
    operatorSessionId: "workflow-async-failure-test",
  });

  const steps: WriteWorkflowStep[] = [createWriteStep("step-1", branch), createWriteStep("step-2", branch)];
  const response = await handlers.start(requestFrame("s1", "start", { steps }), new AbortController().signal);
  expect(response.kind).toBe("response");

  await flushBackgroundRuns();

  const killedRunId = findStepRunId(stateStore, branch, "step-2");
  expect(killedRunId).toBeTruthy();

  const run = stateStore.loadRun(killedRunId as string);
  expect(run?.status).toBe("killed");

  const records = openLogReader(logsPath).tail(killedRunId as string);
  const terminalRecords = records.filter((record) => record.event.kind === "run_execution_failed");
  expect(terminalRecords).toHaveLength(0);
});
