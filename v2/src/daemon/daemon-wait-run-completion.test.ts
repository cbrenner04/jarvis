import { afterEach, beforeEach, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WriteLoopInput } from "../execution/write-loop.ts";
import { connectIpcClient, type IpcClient } from "../ipc/client.ts";
import { type IpcServer, startIpcServer } from "../ipc/server.ts";
import type { IpcFrame } from "../ipc/types.ts";
import { type LogSink, openLogReader, openLogSink } from "../persistence/log-stream.ts";
import { openStateStore, type RunStatus, type StateStore } from "../persistence/state-store.ts";
import { canUseUnixSockets } from "../testing/unix-socket.ts";
import { createRunControlHandlers } from "./daemon.ts";

const SOCKET_PATH = join(tmpdir(), `jarvis-daemon-wait-test-${process.pid}.sock`);
const socketTest = test.skipIf(!canUseUnixSockets());

let stateStore: StateStore;
let logSink: LogSink;
let server: IpcServer;
let logsPath: string;

function input(): WriteLoopInput {
  return {
    worktree: {
      projectRoot: "/tmp/test-project",
      projectName: "test-project",
      branchName: "test-branch",
      baseRef: "main",
    },
    specPath: "/tmp/test-project/spec.md",
    stepRules: "test rules",
    expectedArtifactPath: "/tmp/test-project/artifact",
    bindings: [],
  };
}

function createRun(): string {
  return stateStore.createRun({
    project: "test-project",
    specRef: "main",
    worktreePath: "/tmp/test-project",
    branch: `test-branch-${crypto.randomUUID()}`,
    specPath: "/tmp/test-project/spec.md",
  });
}

function finishLoop(runId: string, status: RunStatus, iterationsConsumed = 1): void {
  stateStore.setRunStatus(runId, status);
  logSink.append(runId, {
    kind: "loop_finished",
    loopOutcomeKind: status === "blocked" ? "blocked" : "complete",
    iterationsConsumed,
    resumable: status === "paused" || status === "budget-soft-stopped",
  });
}

function failRun(runId: string): void {
  stateStore.setRunStatus(runId, "failed");
  logSink.append(runId, { kind: "run_execution_failed" });
}

async function waitRequest(client: IpcClient, id: string, runId: string): Promise<IpcFrame> {
  client.send({ kind: "request", id, method: "wait", params: { runId } });
  return client.nextFrame(2_000);
}

async function expectResponse(frame: IpcFrame): Promise<Record<string, unknown>> {
  expect(frame.kind).toBe("response");
  if (frame.kind !== "response") throw new Error("not a response");
  return frame.result as Record<string, unknown>;
}

beforeEach(async () => {
  if (!canUseUnixSockets()) return;
  rmSync(SOCKET_PATH, { force: true });
  const unique = `${process.pid}-${Date.now()}-${crypto.randomUUID()}`;
  stateStore = openStateStore(join(tmpdir(), `jarvis-wait-state-${unique}.db`));
  logsPath = join(tmpdir(), `jarvis-wait-logs-${unique}.jsonl`);
  logSink = openLogSink(logsPath);
  const { reportReviewDebateProgress: _reportReviewDebateProgress, ...handlers } = createRunControlHandlers({
    stateStore,
    logReader: openLogReader(logsPath),
    writeLoopExecutor: async () => undefined,
    failureReporter: () => undefined,
  });
  server = await startIpcServer(SOCKET_PATH, handlers);
});

afterEach(async () => {
  if (!canUseUnixSockets()) return;
  try {
    await server.close();
  } catch {
    // server may have already stopped
  }
  logSink.close();
  stateStore.close();
  rmSync(SOCKET_PATH, { force: true });
});

socketTest("wait rejects missing and unknown runId before following logs", async () => {
  const client = await connectIpcClient(SOCKET_PATH, 2_000);

  client.send({ kind: "request", id: "missing", method: "wait", params: {} });
  const missing = await client.nextFrame();
  expect(missing.kind).toBe("error");
  expect(missing.kind === "error" && missing.code).toBe("invalid_params");

  client.send({ kind: "request", id: "unknown", method: "wait", params: { runId: "nope" } });
  const unknown = await client.nextFrame();
  expect(unknown.kind).toBe("error");
  expect(unknown.kind === "error" && unknown.code).toBe("unknown_run");
  client.close();
});

socketTest("wait returns immediately for quiescent run with last loop_finished payload", async () => {
  const runId = createRun();
  finishLoop(runId, "completed", 3);
  const client = await connectIpcClient(SOCKET_PATH, 2_000);

  const result = await expectResponse(await waitRequest(client, "wait", runId));

  expect(result).toEqual({
    runStatus: "completed",
    loopOutcomeKind: "complete",
    iterationsConsumed: 3,
    resumable: false,
  });
  client.close();
});

socketTest("wait on resumed in-progress run ignores historical loop_finished and resolves on next edge", async () => {
  const runId = createRun();
  logSink.append(runId, {
    kind: "loop_finished",
    loopOutcomeKind: "progress",
    iterationsConsumed: 1,
    resumable: true,
  });
  const client = await connectIpcClient(SOCKET_PATH, 2_000);
  const pending = waitRequest(client, "wait", runId);

  await new Promise<void>((resolve) => setTimeout(resolve, 25));
  finishLoop(runId, "completed", 2);
  const result = await expectResponse(await pending);

  expect(result).toMatchObject({ runStatus: "completed", iterationsConsumed: 2 });
  client.close();
});

socketTest("two concurrent waits resolve with the same terminal payload", async () => {
  const runId = createRun();
  const firstClient = await connectIpcClient(SOCKET_PATH, 2_000);
  const secondClient = await connectIpcClient(SOCKET_PATH, 2_000);
  const first = waitRequest(firstClient, "w1", runId);
  const second = waitRequest(secondClient, "w2", runId);

  await new Promise<void>((resolve) => setTimeout(resolve, 25));
  finishLoop(runId, "blocked", 4);
  const firstResult = await expectResponse(await first);
  const secondResult = await expectResponse(await second);

  expect(firstResult).toEqual(secondResult);
  expect(firstResult).toMatchObject({
    runStatus: "blocked",
    loopOutcomeKind: "blocked",
    iterationsConsumed: 4,
    error: { reason: "agent_blocked", retryable: false, nextAction: "inspect_spec" },
  });
  firstClient.close();
  secondClient.close();
});

socketTest("pending wait does not block other RPCs on the same connection", async () => {
  const runId = createRun();
  const client = await connectIpcClient(SOCKET_PATH, 2_000);
  client.send({ kind: "request", id: "wait", method: "wait", params: { runId } });
  client.send({ kind: "request", id: "list", method: "list" });

  const listFrame = await client.nextFrame(2_000);
  expect(listFrame.kind).toBe("response");
  expect(listFrame.kind === "response" && (listFrame.result as { runs?: unknown[] }).runs?.length).toBe(1);

  finishLoop(runId, "completed", 1);
  const waitFrame = await client.nextFrame(2_000);
  expect(waitFrame.kind).toBe("response");
  client.close();
});

socketTest("disconnecting one wait client leaves other waiters and durable status alone", async () => {
  const runId = createRun();
  const first = await connectIpcClient(SOCKET_PATH, 2_000);
  const second = await connectIpcClient(SOCKET_PATH, 2_000);
  first.send({ kind: "request", id: "first", method: "wait", params: { runId } });
  const secondWait = waitRequest(second, "second", runId);

  await new Promise<void>((resolve) => setTimeout(resolve, 100));
  first.close();
  await new Promise<void>((resolve) => setTimeout(resolve, 25));
  expect(stateStore.loadRun(runId)?.status).toBe("in-progress");

  finishLoop(runId, "completed", 1);
  const result = await expectResponse(await secondWait);
  expect(result.runStatus).toBe("completed");
  second.close();
});

socketTest("wait resolves failed run_execution_failed without loop fields", async () => {
  const runId = createRun();
  const client = await connectIpcClient(SOCKET_PATH, 2_000);
  const pending = waitRequest(client, "wait", runId);

  await new Promise<void>((resolve) => setTimeout(resolve, 25));
  failRun(runId);
  const result = await expectResponse(await pending);

  expect(result).toEqual({
    runStatus: "failed",
    error: { reason: "harness_failure", retryable: false, nextAction: "stop" },
  });
  client.close();
});

socketTest("wait resolve payload includes the same error object as list for the same run", async () => {
  const runId = createRun();
  stateStore.setRunStatus(runId, "killed");
  const client = await connectIpcClient(SOCKET_PATH, 2_000);

  client.send({ kind: "request", id: "list", method: "list" });
  const listFrame = await client.nextFrame();
  expect(listFrame.kind).toBe("response");
  const listError =
    listFrame.kind === "response"
      ? (listFrame.result as { runs?: Array<{ runId: string; error?: unknown }> }).runs?.find(
          (row) => row.runId === runId,
        )?.error
      : undefined;

  const waitResult = await expectResponse(await waitRequest(client, "wait", runId));
  expect(waitResult.error).toEqual(listError);
  expect(waitResult.error).toEqual({
    reason: "resumable_kill",
    retryable: true,
    nextAction: "resume",
  });
  client.close();
});

socketTest("wait returns durable terminal status only when no terminal log signal exists", async () => {
  const runId = createRun();
  stateStore.setRunStatus(runId, "killed");
  const client = await connectIpcClient(SOCKET_PATH, 2_000);

  const result = await expectResponse(await waitRequest(client, "wait", runId));

  expect(result).toEqual({
    runStatus: "killed",
    error: { reason: "resumable_kill", retryable: true, nextAction: "resume" },
  });
  client.close();
});

socketTest("existing start/list behavior stays unchanged", async () => {
  const client = await connectIpcClient(SOCKET_PATH, 2_000);
  client.send({ kind: "request", id: "start", method: "start", params: { input: input() } });
  const start = await client.nextFrame();
  expect(start.kind).toBe("response");

  client.send({ kind: "request", id: "list", method: "list" });
  const list = await client.nextFrame();
  expect(list.kind).toBe("response");
  client.close();
});
