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

async function waitFor(predicate: () => boolean, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate() && Date.now() < deadline) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

async function waitForInProgress(runId: string): Promise<void> {
  await waitFor(() => stateStore.loadRun(runId)?.status === "in-progress");
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

  await waitForInProgress(runId);
  finishLoop(runId, "completed", 2);
  const result = await expectResponse(await pending);

  expect(result).toMatchObject({ runStatus: "completed", iterationsConsumed: 2 });
});

test("two concurrent waits resolve with the same terminal payload", async () => {
  const runId = createRun();
  const first = waitDirect("w1", runId);
  const second = waitDirect("w2", runId);

  await waitForInProgress(runId);
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

  await waitForInProgress(runId);
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

  await waitForInProgress(runId);
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
    reason: "unsupported_resume_context",
    retryable: false,
    nextAction: "stop",
  });
});

test("wait returns durable terminal status only when no terminal log signal exists", async () => {
  const runId = createRun();
  stateStore.setRunStatus(runId, "killed");

  const result = await expectResponse(await waitDirect("wait", runId));

  expect(result).toEqual({
    runStatus: "killed",
    error: { reason: "unsupported_resume_context", retryable: false, nextAction: "stop" },
  });
});

test("close() rejects an in-flight wait", async () => {
  const runId = createRun();
  const pending = waitDirect("wait", runId);

  await waitForInProgress(runId);
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
      await waitForInProgress(runId);
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

test("wait resolves when a second sink appends the terminal event to the same run", async () => {
  const runId = createRun();
  const pending = waitDirect("wait", runId);

  await waitForInProgress(runId);
  const secondSink = openLogSink(logsPath);
  stateStore.setRunStatus(runId, "completed");
  secondSink.append(runId, {
    kind: "loop_finished",
    loopOutcomeKind: "complete",
    iterationsConsumed: 2,
    resumable: false,
  });
  secondSink.close();

  const result = await expectResponse(await pending);
  expect(result).toEqual({
    runStatus: "completed",
    loopOutcomeKind: "complete",
    iterationsConsumed: 2,
    resumable: false,
  });
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

test("workflow list reports rollup status reflecting all steps, not just entry row status", async () => {
  const writeStepId = "write-step";
  const reviewStepId = "review-step";
  const invocationId = "inv-workflow-123";

  // Create entry run (write step) with workflow snapshot
  const entryRunId = stateStore.createRun({
    project: "test-project",
    specRef: "main",
    worktreePath: "/tmp/test-project",
    branch: "test-branch-workflow",
    specPath: "/tmp/test-project/spec.md",
    stepId: writeStepId,
    workflowSnapshot: {
      invocationId,
      steps: [
        { stepId: writeStepId, role: "implement" },
        { stepId: reviewStepId, role: "review", behavior: "review" },
      ],
    },
  });

  // Create review run
  const reviewRunId = stateStore.createRun({
    project: "test-project",
    specRef: "main",
    worktreePath: "/tmp/test-project",
    branch: "test-branch-workflow",
    specPath: "/tmp/test-project/spec.md",
    stepId: reviewStepId,
    workflowSnapshot: {
      invocationId,
      steps: [
        { stepId: writeStepId, role: "implement" },
        { stepId: reviewStepId, role: "review", behavior: "review" },
      ],
    },
  });

  // Complete write step
  finishLoop(entryRunId, "completed", 1);

  // List should report entry run as in-progress (rolled up), not completed, because review is in-progress
  let list = await expectResponse(await listDirect("list-before"));
  let entryRow = (list.runs as Array<{ runId: string; status: string }>).find((r) => r.runId === entryRunId);
  expect(entryRow?.status).toBe("in-progress");

  // Complete review step
  finishLoop(reviewRunId, "completed", 2);

  // Now list should show completed (all steps done)
  list = await expectResponse(await listDirect("list-after"));
  entryRow = (list.runs as Array<{ runId: string; status: string }>).find((r) => r.runId === entryRunId);
  expect(entryRow?.status).toBe("completed");
});

test("list and wait preserve failed hidden-shrink publication evidence and resumability", async () => {
  const invocationId = "inv-failed-shrink-publication";
  const workflowSnapshot = {
    invocationId,
    steps: [
      {
        stepId: "implement",
        role: "implement",
        stepRules: "retry rules",
        expectedArtifactPath: "/tmp/test-project/artifact",
        agents: ["codex"],
        agentModelConfig: {
          codex: {
            implement: { rungs: [{ adapterModel: "M1", priceKey: "P1" }] },
            shrink: { rungs: [{ adapterModel: "S1", priceKey: "S1" }] },
          },
        },
      },
    ],
  };
  const entryRunId = stateStore.createRun({
    project: "test-project",
    specRef: "main",
    worktreePath: "/tmp/test-project",
    branch: "failed-shrink",
    specPath: "/tmp/test-project/spec.md",
    stepId: "implement",
    workflowSnapshot,
  });
  const shrinkRunId = stateStore.createRun({
    project: "test-project",
    specRef: "main",
    worktreePath: "/tmp/test-project",
    branch: "failed-shrink",
    specPath: "/tmp/test-project/spec.md",
    stepId: "implement~shrink",
    workflowSnapshot,
  });
  finishLoop(entryRunId, "completed", 1);
  stateStore.setRunStatus(shrinkRunId, "failed");
  logSink.append(shrinkRunId, {
    kind: "loop_finished",
    loopOutcomeKind: "completion_commit_failed",
    iterationsConsumed: 2,
    resumable: true,
    publicationFailure: {
      operation: "push",
      message: "remote rejected",
      exitCode: 7,
      stdoutTail: "out",
      stderrTail: "err",
    },
  });

  const list = await expectResponse(await listDirect());
  const rows = list.runs as Array<{ runId: string; status: string; error?: unknown }>;
  expect(rows.find((row) => row.runId === entryRunId)?.status).toBe("failed");
  expect(rows.find((row) => row.runId === shrinkRunId)).toMatchObject({
    status: "failed",
    error: {
      reason: "completion_commit_failed",
      nextAction: "resume",
      publicationFailure: { operation: "push", exitCode: 7 },
    },
  });
  expect(await expectResponse(await waitDirect("failed-shrink", shrinkRunId))).toMatchObject({
    runStatus: "failed",
    loopOutcomeKind: "completion_commit_failed",
    resumable: true,
    error: { reason: "completion_commit_failed", nextAction: "resume", publicationFailure: { stderrTail: "err" } },
  });
});

test("workflow wait returns killed when review step never runs and workflow is not live", async () => {
  const writeStepId = "write-step-killed";
  const reviewStepId = "review-step-killed";
  const invocationId = "inv-workflow-killed";

  // Create entry run with workflow snapshot
  const entryRunId = stateStore.createRun({
    project: "test-project",
    specRef: "main",
    worktreePath: "/tmp/test-project",
    branch: "test-branch-workflow-killed",
    specPath: "/tmp/test-project/spec.md",
    stepId: writeStepId,
    workflowSnapshot: {
      invocationId,
      steps: [
        { stepId: writeStepId, role: "implement" },
        { stepId: reviewStepId, role: "review", behavior: "review" },
      ],
    },
  });

  // Complete write step but don't create review step
  finishLoop(entryRunId, "completed", 1);

  // Wait should resolve with killed status (review step never ran and workflow not live)
  const result = await expectResponse(await waitDirect("wait-killed", entryRunId));
  expect(result.runStatus).toBe("killed");
});
