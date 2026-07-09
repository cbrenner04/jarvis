import { afterEach, beforeEach, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WriteLoopInput } from "../execution/write-loop.ts";
import type { RpcHandler } from "../ipc/server.ts";
import { type LogSink, openLogReader, openLogSink } from "../persistence/log-stream.ts";
import { openStateStore, type RunStatus, type StateStore } from "../persistence/state-store.ts";
import { createRunControlHandlers } from "./daemon.ts";

type Handlers = ReturnType<typeof createRunControlHandlers>;

let stateStore: StateStore;
let logSink: LogSink;
let logsPath: string;
let handlers: Handlers;

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

type RpcResult = Awaited<ReturnType<RpcHandler>>;

async function waitDirect(id: string, runId: string, signal = new AbortController().signal): Promise<RpcResult> {
  return handlers.wait({ kind: "request", id, method: "wait", params: { runId } }, signal);
}

async function listDirect(id = "list"): Promise<RpcResult> {
  return handlers.list({ kind: "request", id, method: "list" }, new AbortController().signal);
}

async function expectResponse(frame: RpcResult): Promise<Record<string, unknown>> {
  expect(frame.kind).toBe("response");
  if (frame.kind !== "response") throw new Error("not a response");
  return frame.result as Record<string, unknown>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

beforeEach(() => {
  const unique = `${process.pid}-${Date.now()}-${crypto.randomUUID()}`;
  stateStore = openStateStore(join(tmpdir(), `jarvis-wait-state-${unique}.db`));
  logsPath = join(tmpdir(), `jarvis-wait-logs-${unique}.jsonl`);
  logSink = openLogSink(logsPath);
  handlers = createRunControlHandlers({
    stateStore,
    logReader: openLogReader(logsPath),
    writeLoopExecutor: async () => undefined,
    failureReporter: () => undefined,
    hasMemoryHeadroom: () => true,
    settleDelayMs: 0,
  });
});

afterEach(() => {
  handlers.close();
  logSink.close();
  stateStore.close();
  rmSync(logsPath, { force: true });
});

test("wait rejects missing and unknown runId before following logs", async () => {
  const missing = await waitDirect("missing", "");
  expect(missing.kind).toBe("error");
  expect(missing.kind === "error" && missing.code).toBe("invalid_params");

  const unknown = await waitDirect("unknown", "nope");
  expect(unknown.kind).toBe("error");
  expect(unknown.kind === "error" && unknown.code).toBe("unknown_run");
});

test("wait returns immediately for quiescent run with last loop_finished payload", async () => {
  const runId = createRun();
  finishLoop(runId, "completed", 3);

  const result = await expectResponse(await waitDirect("wait", runId));

  expect(result).toEqual({
    runStatus: "completed",
    loopOutcomeKind: "complete",
    iterationsConsumed: 3,
    resumable: false,
  });
});

test("wait on resumed in-progress run ignores historical loop_finished and resolves on next edge", async () => {
  const runId = createRun();
  logSink.append(runId, {
    kind: "loop_finished",
    loopOutcomeKind: "progress",
    iterationsConsumed: 1,
    resumable: true,
  });
  const pending = waitDirect("wait", runId);

  await sleep(25);
  finishLoop(runId, "completed", 2);
  const result = await expectResponse(await pending);

  expect(result).toMatchObject({ runStatus: "completed", iterationsConsumed: 2 });
});

test("two concurrent waits resolve with the same terminal payload", async () => {
  const runId = createRun();
  const first = waitDirect("w1", runId);
  const second = waitDirect("w2", runId);

  await sleep(25);
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
});

test("pending wait does not block other RPCs on the same connection", async () => {
  const runId = createRun();
  const pending = waitDirect("wait", runId);

  const listFrame = await listDirect();
  expect(listFrame.kind).toBe("response");
  expect(listFrame.kind === "response" && (listFrame.result as { runs?: unknown[] }).runs?.length).toBe(1);

  finishLoop(runId, "completed", 1);
  const waitFrame = await pending;
  expect(waitFrame.kind).toBe("response");
});

test("disconnecting one wait client leaves other waiters and durable status alone", async () => {
  const runId = createRun();
  const firstController = new AbortController();
  const firstWait = waitDirect("first", runId, firstController.signal);
  const secondWait = waitDirect("second", runId);

  await sleep(25);
  firstController.abort();
  await expect(firstWait).rejects.toThrow();
  expect(stateStore.loadRun(runId)?.status).toBe("in-progress");

  finishLoop(runId, "completed", 1);
  const result = await expectResponse(await secondWait);
  expect(result.runStatus).toBe("completed");
});

test("wait resolves failed run_execution_failed without loop fields", async () => {
  const runId = createRun();
  const pending = waitDirect("wait", runId);

  await sleep(25);
  failRun(runId);
  const result = await expectResponse(await pending);

  expect(result).toEqual({
    runStatus: "failed",
    error: { reason: "harness_failure", retryable: false, nextAction: "stop" },
  });
});

test("wait resolve payload includes the same error object as list for the same run", async () => {
  const runId = createRun();
  stateStore.setRunStatus(runId, "killed");

  const listFrame = await listDirect();
  expect(listFrame.kind).toBe("response");
  const listError =
    listFrame.kind === "response"
      ? (listFrame.result as { runs?: Array<{ runId: string; error?: unknown }> }).runs?.find(
          (row) => row.runId === runId,
        )?.error
      : undefined;

  const waitResult = await expectResponse(await waitDirect("wait", runId));
  expect(waitResult.error).toEqual(listError);
  expect(waitResult.error).toEqual({
    reason: "resumable_kill",
    retryable: true,
    nextAction: "resume",
  });
});

test("wait returns durable terminal status only when no terminal log signal exists", async () => {
  const runId = createRun();
  stateStore.setRunStatus(runId, "killed");

  const result = await expectResponse(await waitDirect("wait", runId));

  expect(result).toEqual({
    runStatus: "killed",
    error: { reason: "resumable_kill", retryable: true, nextAction: "resume" },
  });
});

test("close() rejects an in-flight wait", async () => {
  const runId = createRun();
  const pending = waitDirect("wait", runId);

  await sleep(25);
  handlers.close();

  await expect(pending).rejects.toThrow();
  expect(stateStore.loadRun(runId)?.status).toBe("in-progress");
});

test("normal wait completions leave nothing for close() to abort", async () => {
  const originalAbort = AbortController.prototype.abort;
  let abortCalls = 0;
  AbortController.prototype.abort = function (...args: Parameters<typeof originalAbort>) {
    abortCalls++;
    return originalAbort.apply(this, args);
  };

  try {
    for (let i = 0; i < 3; i++) {
      const runId = createRun();
      const pending = waitDirect(`w${i}`, runId);
      await sleep(10);
      finishLoop(runId, "completed", 1);
      await expectResponse(await pending);
    }

    abortCalls = 0;
    handlers.close();
    expect(abortCalls).toBe(0);
  } finally {
    AbortController.prototype.abort = originalAbort;
  }
});

test("existing start/list behavior stays unchanged", async () => {
  const start = await handlers.start(
    { kind: "request", id: "start", method: "start", params: { input: input() } },
    new AbortController().signal,
  );
  expect(start.kind).toBe("response");

  const list = await listDirect();
  expect(list.kind).toBe("response");
});
