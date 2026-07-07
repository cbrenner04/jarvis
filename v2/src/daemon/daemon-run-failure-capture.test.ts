import { afterEach, beforeEach, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WriteLoopInput } from "../execution/write-loop.ts";
import { openLogReader } from "../persistence/log-stream.ts";
import { openStateStore, type StateStore } from "../persistence/state-store.ts";
import { listRunsDirect, mockWriteLoopInput, startRunDirect } from "../testing/run-control.ts";
import { createRunControlHandlers, createRunExecutionFailureReporter } from "./daemon.ts";

type Handlers = ReturnType<typeof createRunControlHandlers>;

let stateStore: StateStore;
let logsPath: string;
let reportedFailures: Array<{ runId: string; reason: unknown }>;
let failureReporter: (runId: string, reason: unknown) => void | Promise<void>;
let executorBehavior: "reject" | "resolve";
let handlers: Handlers;

async function flushBackgroundRuns(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

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
