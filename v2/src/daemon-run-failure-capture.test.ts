import { afterEach, beforeEach, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRunControlHandlers, createRunExecutionFailureReporter } from "./daemon.ts";
import { connectIpcClient } from "./ipc/client.ts";
import { type IpcServer, startIpcServer } from "./ipc/server.ts";
import { openLogReader } from "./log-stream.ts";
import { openStateStore, type StateStore } from "./state-store.ts";
import { canUseUnixSockets } from "./testing/unix-socket.ts";
import type { WriteLoopInput } from "./write-loop.ts";

const SOCKET_PATH = join(tmpdir(), `jarvis-daemon-failure-test-${process.pid}.sock`);
const socketTest = test.skipIf(!canUseUnixSockets());

type RunSummary = { runId: string; project: string; branch: string; status: string; isLive: boolean };
type ListRunsResult = { runs?: RunSummary[] } | undefined;

let stateStore: StateStore;
let server: IpcServer;
let logsPath: string;
let reportedFailures: Array<{ runId: string; reason: unknown }>;
let failureReporter: (runId: string, reason: unknown) => void | Promise<void>;
let executorBehavior: "reject" | "resolve";

async function flushBackgroundRuns(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

function mockWriteLoopInput(worktreeOverrides: Partial<WriteLoopInput["worktree"]> = {}): WriteLoopInput {
  return {
    worktree: {
      projectRoot: "/tmp/test-project",
      projectName: "test-project",
      branchName: "test-branch",
      baseRef: "main",
      ...worktreeOverrides,
    },
    specPath: "/tmp/test-project/spec.md",
    stepRules: "test rules",
    expectedArtifactPath: "/tmp/test-project/artifact",
    bindings: [],
  };
}

async function startRun(
  client: Awaited<ReturnType<typeof connectIpcClient>>,
  input = mockWriteLoopInput(),
): Promise<string | undefined> {
  client.send({ kind: "request", id: "s1", method: "start", params: { input } });
  const frame = await client.nextFrame();
  expect(frame.kind).toBe("response");
  return frame.kind === "response" ? (frame.result as { runId?: string } | undefined)?.runId : undefined;
}

async function listRuns(client: Awaited<ReturnType<typeof connectIpcClient>>): Promise<RunSummary[] | undefined> {
  client.send({ kind: "request", id: "l1", method: "list" });
  const frame = await client.nextFrame();
  expect(frame.kind).toBe("response");
  return frame.kind === "response" ? (frame.result as ListRunsResult)?.runs : undefined;
}

function createHandlers() {
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
  });
}

beforeEach(async () => {
  if (!canUseUnixSockets()) {
    return;
  }
  rmSync(SOCKET_PATH, { force: true });
  stateStore = openStateStore(join(tmpdir(), `jarvis-failure-state-${process.pid}-${Date.now()}.db`));
  logsPath = join(tmpdir(), `jarvis-failure-logs-${process.pid}-${Date.now()}.jsonl`);
  reportedFailures = [];
  executorBehavior = "reject";
  failureReporter = (runId, reason) => {
    reportedFailures.push({ runId, reason });
  };

  server = await startIpcServer(SOCKET_PATH, createHandlers());
});

afterEach(async () => {
  if (!canUseUnixSockets()) {
    return;
  }
  try {
    await server.close();
  } catch {
    // server may have already stopped
  }
  rmSync(SOCKET_PATH, { force: true });
  try {
    stateStore.close();
  } catch {
    // store may be closed
  }
});

socketTest("executor rejection sets durable status to failed", async () => {
  const client = await connectIpcClient(SOCKET_PATH);
  const runId = await startRun(client);
  expect(runId).toBeDefined();
  await flushBackgroundRuns();

  const run = stateStore.loadRun(runId!);
  expect(run?.status).toBe("failed");
  client.close();
});

socketTest("executor rejection appends exactly one run_execution_failed via failure reporter", async () => {
  failureReporter = createRunExecutionFailureReporter(logsPath);

  await server.close();
  server = await startIpcServer(SOCKET_PATH, createHandlers());

  const client = await connectIpcClient(SOCKET_PATH);
  const runId = await startRun(client);
  await flushBackgroundRuns();

  const records = openLogReader(logsPath).tail(runId!);
  expect(records).toHaveLength(1);
  expect(records[0]?.event).toEqual({ kind: "run_execution_failed" });
  client.close();
});

socketTest("failed run keeps in-progress attempt row", async () => {
  const client = await connectIpcClient(SOCKET_PATH);
  const runId = await startRun(client);
  expect(runId).toBeDefined();
  stateStore.recordAttemptStart(runId!);
  await flushBackgroundRuns();

  const run = stateStore.loadRun(runId!);
  expect(run?.status).toBe("failed");
  const latestAttempt = run?.attempts.at(-1);
  expect(latestAttempt?.status).toBe("in-progress");
  client.close();
});

socketTest("after executor rejection list reports isLive false and accepts second start", async () => {
  const client = await connectIpcClient(SOCKET_PATH);
  const input = mockWriteLoopInput();
  const runId = await startRun(client, input);
  await flushBackgroundRuns();

  const runs = await listRuns(client);
  const failedRun = runs?.find((candidate) => candidate.runId === runId);
  expect(failedRun?.isLive).toBe(false);
  expect(failedRun?.status).toBe("failed");

  executorBehavior = "resolve";
  client.send({ kind: "request", id: "s2", method: "start", params: { input } });
  const response2 = await client.nextFrame();
  expect(response2.kind).toBe("response");
  client.close();
});

socketTest("failure reporter throw keeps failed status and releases ownership", async () => {
  failureReporter = async () => {
    throw new Error("reporter failed");
  };

  await server.close();
  server = await startIpcServer(SOCKET_PATH, createHandlers());

  const client = await connectIpcClient(SOCKET_PATH);
  const input = mockWriteLoopInput();
  const runId = await startRun(client, input);
  await flushBackgroundRuns();

  const run = stateStore.loadRun(runId!);
  expect(run?.status).toBe("failed");

  const runs = await listRuns(client);
  expect(runs?.find((candidate) => candidate.runId === runId)?.isLive).toBe(false);

  executorBehavior = "resolve";
  client.send({ kind: "request", id: "s2", method: "start", params: { input } });
  const response2 = await client.nextFrame();
  expect(response2.kind).toBe("response");
  client.close();
});

socketTest("spawn boundary forwards original rejection to failure reporter", async () => {
  class CustomExecutorError extends Error {
    constructor() {
      super("custom executor failure");
      this.name = "CustomExecutorError";
    }
  }

  const writeLoopExecutor = async (): Promise<void> => {
    throw new CustomExecutorError();
  };

  await server.close();
  server = await startIpcServer(
    SOCKET_PATH,
    createRunControlHandlers({
      stateStore,
      writeLoopExecutor,
      failureReporter: (runId, reason) => {
        reportedFailures.push({ runId, reason });
      },
    }),
  );

  const client = await connectIpcClient(SOCKET_PATH);
  await startRun(client);
  await flushBackgroundRuns();

  const reason = reportedFailures[0]?.reason;
  expect(reason).toBeInstanceOf(CustomExecutorError);
  expect((reason as Error).message).toBe("custom executor failure");
  client.close();
});

socketTest("terminal durable status is not overwritten on executor rejection", async () => {
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

  await server.close();
  server = await startIpcServer(
    SOCKET_PATH,
    createRunControlHandlers({
      stateStore,
      writeLoopExecutor,
      failureReporter,
    }),
  );

  const client = await connectIpcClient(SOCKET_PATH);
  const runId = await startRun(client);
  await flushBackgroundRuns();

  stateStore.setRunStatus(runId!, "killed");
  releaseExecutor(new Error("executor boom"));
  await flushBackgroundRuns();

  const run = stateStore.loadRun(runId!);
  expect(run?.status).toBe("killed");
  expect(setRunStatusCalls.filter((status) => status === "failed")).toHaveLength(0);
  client.close();
});

socketTest("settled executor does not invoke failure reporter", async () => {
  executorBehavior = "resolve";

  await server.close();
  server = await startIpcServer(SOCKET_PATH, createHandlers());

  const client = await connectIpcClient(SOCKET_PATH);
  await startRun(client);
  await flushBackgroundRuns();

  expect(reportedFailures).toHaveLength(0);
  client.close();
});

test("createRunExecutionFailureReporter appends run_execution_failed through log sink", async () => {
  const path = join(tmpdir(), `jarvis-prod-reporter-${process.pid}-${Date.now()}.jsonl`);
  const reporter = createRunExecutionFailureReporter(path);

  await reporter("run-abc", new Error("ignored"));

  const records = openLogReader(path).tail("run-abc");
  expect(records).toHaveLength(1);
  expect(records[0]?.event).toEqual({ kind: "run_execution_failed" });
});
