import { afterEach, beforeEach, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRunControlHandlers } from "./daemon.ts";
import type { DaemonListRunRow } from "./daemon-wire.ts";
import { connectIpcClient } from "./ipc/client.ts";
import { type IpcServer, startIpcServer } from "./ipc/server.ts";
import { openStateStore, type StateStore } from "./state-store.ts";
import { canUseUnixSockets } from "./testing/unix-socket.ts";
import type { WriteLoopInput } from "./write-loop.ts";

const SOCKET_PATH = join(tmpdir(), `jarvis-daemon-test-${process.pid}.sock`);
const socketTest = test.skipIf(!canUseUnixSockets());

type PendingExecutorRun = {
  signal: AbortSignal;
  pauseSignal: AbortSignal;
  release: (mode: "settle" | "abort") => void;
};

function createFakeWriteLoopExecutor() {
  const pending: PendingExecutorRun[] = [];

  const executor = async (input: WriteLoopInput, signal: AbortSignal, pauseSignal: AbortSignal): Promise<void> => {
    void input;
    await new Promise<void>((resolve) => {
      let released = false;
      const release = (mode: "settle" | "abort"): void => {
        void mode;
        if (released) {
          return;
        }
        released = true;
        resolve();
      };
      pending.push({ signal, pauseSignal, release });
      signal.addEventListener("abort", () => release("abort"), { once: true });
    });
  };

  const drainPending = (mode: "settle" | "abort"): void => {
    while (pending.length > 0) {
      pending.shift()?.release(mode);
    }
  };

  return {
    executor,
    settleAll: (): void => drainPending("settle"),
    abortAll: (): void => drainPending("abort"),
    isPauseSignalTriggered: (): boolean => pending.some((run) => run.pauseSignal.aborted),
    isAbortSignalTriggered: (): boolean => pending.some((run) => run.signal.aborted),
  };
}

type FakeWriteLoopExecutor = ReturnType<typeof createFakeWriteLoopExecutor>;
type ListRunsResult = { runs?: DaemonListRunRow[] } | undefined;

let stateStore: StateStore;
let server: IpcServer;
let fakeExecutor: FakeWriteLoopExecutor;

async function flushBackgroundRuns(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

beforeEach(async () => {
  if (!canUseUnixSockets()) {
    return;
  }
  rmSync(SOCKET_PATH, { force: true });
  stateStore = openStateStore(join(tmpdir(), `jarvis-state-${process.pid}-${Date.now()}.db`));
  fakeExecutor = createFakeWriteLoopExecutor();

  const handlers = createRunControlHandlers({
    stateStore,
    writeLoopExecutor: fakeExecutor.executor,
    failureReporter: () => {},
  });

  server = await startIpcServer(SOCKET_PATH, handlers);
});

afterEach(async () => {
  if (!canUseUnixSockets()) {
    return;
  }
  fakeExecutor.abortAll();
  await flushBackgroundRuns();
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

async function listRuns(client: Awaited<ReturnType<typeof connectIpcClient>>): Promise<DaemonListRunRow[] | undefined> {
  client.send({ kind: "request", id: "l1", method: "list" });
  const frame = await client.nextFrame();
  expect(frame.kind).toBe("response");
  return frame.kind === "response" ? (frame.result as ListRunsResult)?.runs : undefined;
}

socketTest("start returns a run ID", async () => {
  const client = await connectIpcClient(SOCKET_PATH);
  const runId = await startRun(client);
  expect(typeof runId).toBe("string");
  client.close();
});

socketTest("start rejects when any run is active (single in-flight guard)", async () => {
  const client = await connectIpcClient(SOCKET_PATH);
  await startRun(client);

  const input2 = mockWriteLoopInput({ projectName: "other-project" });
  client.send({ kind: "request", id: "s2", method: "start", params: { input: input2 } });
  const response2 = await client.nextFrame();
  expect(response2.kind).toBe("error");
  if (response2.kind === "error") {
    expect(response2.code).toBe("run_in_progress");
  }
  client.close();
});

socketTest("start rejects second start for same (project, branch) while first is active", async () => {
  const client = await connectIpcClient(SOCKET_PATH);
  const input = mockWriteLoopInput();
  await startRun(client, input);

  client.send({ kind: "request", id: "s2", method: "start", params: { input } });
  const response2 = await client.nextFrame();
  expect(response2.kind).toBe("error");
  if (response2.kind === "error") {
    expect(response2.code).toBe("worktree_claimed");
  }
  client.close();
});

socketTest("list returns durable runs with liveness info", async () => {
  const client = await connectIpcClient(SOCKET_PATH);
  await startRun(client);
  const runs = await listRuns(client);
  if (!runs) {
    client.close();
    return;
  }

  expect(runs.length).toBeGreaterThan(0);
  const run = runs[0];
  expect(run).toHaveProperty("runId");
  expect(run).toHaveProperty("project");
  expect(run).toHaveProperty("branch");
  expect(run).toHaveProperty("status");
  expect(run).toHaveProperty("isLive");
  expect(run?.isLive).toBe(true);
  client.close();
});

socketTest("settled run is no longer live in list", async () => {
  const client = await connectIpcClient(SOCKET_PATH);
  await startRun(client);

  fakeExecutor.settleAll();
  await flushBackgroundRuns();

  const runs = await listRuns(client);
  if (!runs) {
    client.close();
    return;
  }

  expect(runs.length).toBeGreaterThan(0);
  const run = runs[0];
  expect(run?.isLive).toBe(false);
  client.close();
});

socketTest("pause signals graceful stop for an active run", async () => {
  const client = await connectIpcClient(SOCKET_PATH);
  const runId = await startRun(client);
  if (!runId) {
    client.close();
    return;
  }

  client.send({ kind: "request", id: "p1", method: "pause", params: { runId } });
  const pauseResponse = await client.nextFrame();
  expect(pauseResponse.kind).toBe("response");
  if (pauseResponse.kind === "response") {
    expect((pauseResponse.result as { ok?: boolean } | undefined)?.ok).toBe(true);
  }
  expect(fakeExecutor.isPauseSignalTriggered()).toBe(true);
  client.close();
});

socketTest("pause rejects unknown run ID", async () => {
  const client = await connectIpcClient(SOCKET_PATH);

  client.send({ kind: "request", id: "p1", method: "pause", params: { runId: "unknown-id" } });
  const pauseResponse = await client.nextFrame();
  expect(pauseResponse.kind).toBe("error");
  if (pauseResponse.kind === "error") {
    expect(pauseResponse.code).toBe("unknown_run");
  }
  client.close();
});

socketTest("list includes error on terminal rows and omits it on in-progress and completed", async () => {
  const client = await connectIpcClient(SOCKET_PATH);
  const runId = await startRun(client);
  if (!runId) {
    client.close();
    return;
  }

  let runs = await listRuns(client);
  expect(runs?.[0]?.error).toBeUndefined();

  client.send({ kind: "request", id: "k1", method: "kill", params: { runId } });
  await client.nextFrame();

  runs = await listRuns(client);
  const killed = runs?.find((candidate) => candidate.runId === runId);
  expect(killed?.error).toEqual({
    reason: "resumable_kill",
    retryable: true,
    nextAction: "resume",
  });

  fakeExecutor.settleAll();
  await flushBackgroundRuns();
  stateStore.setRunStatus(runId, "completed");

  runs = await listRuns(client);
  const completed = runs?.find((candidate) => candidate.runId === runId);
  expect(completed?.error).toBeUndefined();

  const pausedRunId = stateStore.createRun({
    project: "terminal-project",
    specRef: "main",
    worktreePath: "/tmp/paused",
    branch: "paused-branch",
    specPath: "/tmp/spec.md",
  });
  stateStore.setRunStatus(pausedRunId, "paused");

  const budgetRunId = stateStore.createRun({
    project: "terminal-project",
    specRef: "main",
    worktreePath: "/tmp/budget",
    branch: "budget-branch",
    specPath: "/tmp/spec.md",
  });
  stateStore.setRunStatus(budgetRunId, "budget-soft-stopped");

  const blockedRunId = stateStore.createRun({
    project: "terminal-project",
    specRef: "main",
    worktreePath: "/tmp/blocked",
    branch: "blocked-branch",
    specPath: "/tmp/spec.md",
  });
  stateStore.setRunStatus(blockedRunId, "blocked");
  const blockedAttemptId = stateStore.recordAttemptStart(blockedRunId);
  stateStore.commitCompletionBoundary({
    attemptId: blockedAttemptId,
    runStatus: "blocked",
    outcomeKind: "blocked",
  });

  const failedRunId = stateStore.createRun({
    project: "terminal-project",
    specRef: "main",
    worktreePath: "/tmp/failed",
    branch: "failed-branch",
    specPath: "/tmp/spec.md",
  });
  stateStore.setRunStatus(failedRunId, "failed");

  runs = await listRuns(client);
  expect(runs?.find((row) => row.runId === pausedRunId)?.error).toEqual({
    reason: "resumable_pause",
    retryable: true,
    nextAction: "resume",
  });
  expect(runs?.find((row) => row.runId === budgetRunId)?.error).toEqual({
    reason: "resumable_budget",
    retryable: true,
    nextAction: "resume",
  });
  expect(runs?.find((row) => row.runId === blockedRunId)?.error).toEqual({
    reason: "agent_blocked",
    retryable: false,
    nextAction: "inspect_spec",
  });
  expect(runs?.find((row) => row.runId === failedRunId)?.error).toEqual({
    reason: "harness_failure",
    retryable: false,
    nextAction: "stop",
  });

  client.close();
});

socketTest("list without logReader composes store-only error", async () => {
  await server.close();
  const handlers = createRunControlHandlers({
    stateStore,
    writeLoopExecutor: fakeExecutor.executor,
    failureReporter: () => {},
  });
  server = await startIpcServer(SOCKET_PATH, handlers);

  const pausedRunId = stateStore.createRun({
    project: "paused-project",
    specRef: "main",
    worktreePath: "/tmp/paused",
    branch: "paused-branch",
    specPath: "/tmp/spec.md",
  });
  stateStore.setRunStatus(pausedRunId, "paused");

  const client = await connectIpcClient(SOCKET_PATH);
  const runs = await listRuns(client);
  const paused = runs?.find((candidate) => candidate.runId === pausedRunId);
  expect(paused?.error).toEqual({
    reason: "resumable_pause",
    retryable: true,
    nextAction: "resume",
  });
  client.close();
});

socketTest("kill aborts an active run and records killed status", async () => {
  const client = await connectIpcClient(SOCKET_PATH);
  const runId = await startRun(client);
  if (!runId) {
    client.close();
    return;
  }

  client.send({ kind: "request", id: "k1", method: "kill", params: { runId } });
  const killResponse = await client.nextFrame();
  expect(killResponse.kind).toBe("response");
  if (killResponse.kind === "response") {
    expect((killResponse.result as { ok?: boolean } | undefined)?.ok).toBe(true);
  }
  expect(fakeExecutor.isAbortSignalTriggered()).toBe(true);

  const runs = await listRuns(client);
  if (runs) {
    const run = runs.find((candidate) => candidate.runId === runId);
    expect(run).toBeDefined();
    expect(run?.status).toBe("killed");
  }
  client.close();
});

socketTest("kill rejects unknown run ID", async () => {
  const client = await connectIpcClient(SOCKET_PATH);

  client.send({ kind: "request", id: "k1", method: "kill", params: { runId: "unknown-id" } });
  const killResponse = await client.nextFrame();
  expect(killResponse.kind).toBe("error");
  if (killResponse.kind === "error") {
    expect(killResponse.code).toBe("unknown_run");
  }
  client.close();
});

socketTest("resume rejects unknown run ID", async () => {
  const client = await connectIpcClient(SOCKET_PATH);

  client.send({ kind: "request", id: "r1", method: "resume", params: { runId: "unknown-id" } });
  const resumeResponse = await client.nextFrame();
  expect(resumeResponse.kind).toBe("error");
  if (resumeResponse.kind === "error") {
    expect(resumeResponse.code).toBe("unknown_run");
  }
  client.close();
});

socketTest("resume rejects terminal run status", async () => {
  const client = await connectIpcClient(SOCKET_PATH);
  const runId = await startRun(client);
  if (!runId) {
    client.close();
    return;
  }

  fakeExecutor.settleAll();
  await flushBackgroundRuns();
  stateStore.setRunStatus(runId, "completed");

  client.send({ kind: "request", id: "r1", method: "resume", params: { runId } });
  const resumeResponse = await client.nextFrame();
  expect(resumeResponse.kind).toBe("error");
  if (resumeResponse.kind === "error") {
    expect(resumeResponse.code).toBe("terminal_run");
    expect(resumeResponse.message).toBe("Cannot resume a completed run");
  }
  client.close();
});

socketTest("resume rejects if another run is in-flight (single in-flight guard)", async () => {
  const client = await connectIpcClient(SOCKET_PATH);
  await startRun(client);

  const pausedRunId = stateStore.createRun({
    project: "test-project",
    specRef: "main",
    worktreePath: "/tmp/other-worktree",
    branch: "other-branch",
    specPath: "/tmp/test-project/spec.md",
  });
  stateStore.setRunStatus(pausedRunId, "paused");

  client.send({ kind: "request", id: "r1", method: "resume", params: { runId: pausedRunId } });
  const resumeResponse = await client.nextFrame();
  expect(resumeResponse.kind).toBe("error");
  if (resumeResponse.kind === "error") {
    expect(resumeResponse.code).toBe("run_in_progress");
    expect(resumeResponse.message).toBe("A run is already in progress; at most one in-flight run globally");
  }
  client.close();
});

socketTest("kill aborts the abort signal that bindings can observe", async () => {
  const client = await connectIpcClient(SOCKET_PATH);
  const runId = await startRun(client);
  if (!runId) {
    client.close();
    return;
  }

  client.send({ kind: "request", id: "k1", method: "kill", params: { runId } });
  const killResponse = await client.nextFrame();
  expect(killResponse.kind).toBe("response");
  expect(fakeExecutor.isAbortSignalTriggered()).toBe(true);

  const runs = await listRuns(client);
  if (runs) {
    const run = runs.find((candidate) => candidate.runId === runId);
    expect(run?.status).toBe("killed");
  }

  client.close();
});
