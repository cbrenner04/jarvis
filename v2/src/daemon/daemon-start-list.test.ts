import { afterEach, beforeEach, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WriteLoopInput } from "../execution/write-loop.ts";
import { connectIpcClient } from "../ipc/client.ts";
import { type IpcServer, startIpcServer } from "../ipc/server.ts";
import { openStateStore, type StateStore } from "../persistence/state-store.ts";
import { listRuns, mockWriteLoopInput, startRun } from "../testing/run-control.ts";
import { canUseUnixSockets } from "../testing/unix-socket.ts";
import { createRunControlHandlers, reportReviewDebateProgress, reviewDebateProgressByInvocation } from "./daemon.ts";

const SOCKET_PATH = join(tmpdir(), `jarvis-daemon-test-${process.pid}.sock`);
const socketTest = test.skipIf(!canUseUnixSockets());

type PendingExecutorRun = {
  signal: AbortSignal;
  pauseSignal: AbortSignal;
  release: (mode: "settle" | "abort") => void;
};

function createFakeWriteLoopExecutor(onStart?: (input: WriteLoopInput) => void) {
  const pending: PendingExecutorRun[] = [];

  const executor = async (input: WriteLoopInput, signal: AbortSignal, pauseSignal: AbortSignal): Promise<void> => {
    onStart?.(input);
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

function workflowSnapshot(
  invocationId: string,
  ...steps: Array<{ stepId: string; role: string; behavior?: "review-debate" }>
) {
  return { invocationId, steps };
}

let stateStore: StateStore;
let server: IpcServer;
let fakeExecutor: FakeWriteLoopExecutor;

function loadRunOrThrow(store: StateStore, runId: string) {
  const run = store.loadRun(runId);
  if (!run) throw new Error(`missing run ${runId}`);
  return run;
}

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
  reviewDebateProgressByInvocation.clear();
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

socketTest("start returns a run ID", async () => {
  const client = await connectIpcClient(SOCKET_PATH, 2_000);
  const runId = await startRun(client);
  expect(typeof runId).toBe("string");
  client.close();
});

socketTest("start rejects when any run is active (single in-flight guard)", async () => {
  const client = await connectIpcClient(SOCKET_PATH, 2_000);
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
  const client = await connectIpcClient(SOCKET_PATH, 2_000);
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
  const client = await connectIpcClient(SOCKET_PATH, 2_000);
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
  const client = await connectIpcClient(SOCKET_PATH, 2_000);
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

socketTest("list returns workflow step snapshots for live, stopped, and completed workflow-backed runs", async () => {
  await server.close();
  fakeExecutor = createFakeWriteLoopExecutor((input) => {
    const run = stateStore.findRunByProjectBranch({
      project: input.worktree.projectName,
      branch: input.worktree.branchName,
      ...(input.stepId !== undefined ? { stepId: input.stepId } : {}),
    });
    if (run && run.attempts.length === 0) {
      stateStore.recordAttemptStart(run.id);
    }
  });
  server = await startIpcServer(
    SOCKET_PATH,
    createRunControlHandlers({
      stateStore,
      writeLoopExecutor: fakeExecutor.executor,
      failureReporter: () => {},
    }),
  );

  const snapshot = workflowSnapshot(
    "workflow-1",
    { stepId: "step-1", role: "implement" },
    { stepId: "step-2", role: "review" },
    { stepId: "step-3", role: "verify" },
  );

  const priorRunId = stateStore.createRun({
    project: "wf-project",
    specRef: "main",
    worktreePath: "/tmp/wf-project",
    branch: "wf-live",
    specPath: "/tmp/spec.md",
    stepId: "step-1",
    workflowSnapshot: snapshot,
  });
  const priorAttemptId = stateStore.recordAttemptStart(priorRunId);
  stateStore.commitCompletionBoundary({ attemptId: priorAttemptId, runStatus: "in-progress", outcomeKind: "progress" });
  const priorAttempt2Id = stateStore.recordAttemptStart(priorRunId);
  stateStore.commitCompletionBoundary({ attemptId: priorAttempt2Id, runStatus: "completed", outcomeKind: "done" });

  const client = await connectIpcClient(SOCKET_PATH, 2_000);
  const liveRunId = await startRun(client, {
    ...mockWriteLoopInput({ projectName: "wf-project", branchName: "wf-live", projectRoot: "/tmp/wf-project" }),
    stepId: "step-2",
    workflowSnapshot: snapshot,
  });
  expect(liveRunId).toBeDefined();

  let runs = await listRuns(client);
  const liveRow = runs?.find((row) => row.runId === liveRunId);
  expect(liveRow?.workflow).toEqual({
    steps: [
      { stepId: "step-1", role: "implement", status: "completed", attemptCount: 2, terminalOutcome: "complete" },
      { stepId: "step-2", role: "review", status: "in_progress", attemptCount: 1 },
      { stepId: "step-3", role: "verify", status: "pending", attemptCount: 0 },
    ],
  });

  fakeExecutor.settleAll();
  await flushBackgroundRuns();
  const liveAttemptId = loadRunOrThrow(stateStore, liveRunId as string).attempts[0]?.id;
  expect(liveAttemptId).toBeDefined();
  stateStore.commitCompletionBoundary({
    attemptId: liveAttemptId as string,
    runStatus: "completed",
    outcomeKind: "done",
  });

  const finalRunId = stateStore.createRun({
    project: "wf-project",
    specRef: "main",
    worktreePath: "/tmp/wf-project",
    branch: "wf-live",
    specPath: "/tmp/spec.md",
    stepId: "step-3",
    workflowSnapshot: snapshot,
  });
  const finalAttemptId = stateStore.recordAttemptStart(finalRunId);
  stateStore.commitCompletionBoundary({ attemptId: finalAttemptId, runStatus: "blocked", outcomeKind: "blocked" });

  runs = await listRuns(client);
  const stoppedRow = runs?.find((row) => row.runId === finalRunId);
  expect(stoppedRow?.workflow).toEqual({
    steps: [
      { stepId: "step-1", role: "implement", status: "completed", attemptCount: 2, terminalOutcome: "complete" },
      { stepId: "step-2", role: "review", status: "completed", attemptCount: 1, terminalOutcome: "complete" },
      { stepId: "step-3", role: "verify", status: "stopped", attemptCount: 1, terminalOutcome: "blocked" },
    ],
  });

  const completeSnapshot = workflowSnapshot(
    "workflow-1",
    { stepId: "step-a", role: "implement" },
    { stepId: "step-b", role: "review" },
  );
  const completeRunA = stateStore.createRun({
    project: "wf-project",
    specRef: "main",
    worktreePath: "/tmp/wf-project",
    branch: "wf-done",
    specPath: "/tmp/spec.md",
    stepId: "step-a",
    workflowSnapshot: completeSnapshot,
  });
  const completeAttemptA = stateStore.recordAttemptStart(completeRunA);
  stateStore.commitCompletionBoundary({ attemptId: completeAttemptA, runStatus: "completed", outcomeKind: "done" });
  const completeRunB = stateStore.createRun({
    project: "wf-project",
    specRef: "main",
    worktreePath: "/tmp/wf-project",
    branch: "wf-done",
    specPath: "/tmp/spec.md",
    stepId: "step-b",
    workflowSnapshot: completeSnapshot,
  });
  const completeAttemptB = stateStore.recordAttemptStart(completeRunB);
  stateStore.commitCompletionBoundary({ attemptId: completeAttemptB, runStatus: "completed", outcomeKind: "done" });

  runs = await listRuns(client);
  const completedRow = runs?.find((row) => row.runId === completeRunB);
  expect(completedRow?.workflow).toEqual({
    steps: [
      { stepId: "step-a", role: "implement", status: "completed", attemptCount: 1, terminalOutcome: "complete" },
      { stepId: "step-b", role: "review", status: "completed", attemptCount: 1, terminalOutcome: "complete" },
    ],
  });

  client.close();
});

socketTest(
  "list maps stopped workflow steps to budget-exhausted, paused, killed, and contract_miss outcomes",
  async () => {
    const client = await connectIpcClient(SOCKET_PATH, 2_000);

    const budgetRunId = stateStore.createRun({
      project: "wf-outcomes",
      specRef: "main",
      worktreePath: "/tmp/wf-outcomes",
      branch: "wf-budget",
      specPath: "/tmp/spec.md",
      stepId: "step-budget",
      workflowSnapshot: workflowSnapshot("workflow-1", { stepId: "step-budget", role: "implement" }),
    });
    stateStore.recordAttemptStart(budgetRunId);
    stateStore.setRunStatus(budgetRunId, "budget-soft-stopped");

    const pausedRunId = stateStore.createRun({
      project: "wf-outcomes",
      specRef: "main",
      worktreePath: "/tmp/wf-outcomes",
      branch: "wf-paused",
      specPath: "/tmp/spec.md",
      stepId: "step-paused",
      workflowSnapshot: workflowSnapshot("workflow-1", { stepId: "step-paused", role: "implement" }),
    });
    stateStore.recordAttemptStart(pausedRunId);
    stateStore.setRunStatus(pausedRunId, "paused");

    const killedRunId = stateStore.createRun({
      project: "wf-outcomes",
      specRef: "main",
      worktreePath: "/tmp/wf-outcomes",
      branch: "wf-killed",
      specPath: "/tmp/spec.md",
      stepId: "step-killed",
      workflowSnapshot: workflowSnapshot("workflow-1", { stepId: "step-killed", role: "implement" }),
    });
    stateStore.recordAttemptStart(killedRunId);
    stateStore.setRunStatus(killedRunId, "killed");

    const contractMissRunId = stateStore.createRun({
      project: "wf-outcomes",
      specRef: "main",
      worktreePath: "/tmp/wf-outcomes",
      branch: "wf-contract",
      specPath: "/tmp/spec.md",
      stepId: "step-contract",
      workflowSnapshot: workflowSnapshot("workflow-1", { stepId: "step-contract", role: "implement" }),
    });
    const contractMissAttemptId = stateStore.recordAttemptStart(contractMissRunId);
    stateStore.commitCompletionBoundary({
      attemptId: contractMissAttemptId,
      runStatus: "blocked",
      outcomeKind: "contract_miss",
    });

    const awaitingHumanRunId = stateStore.createRun({
      project: "wf-outcomes",
      specRef: "main",
      worktreePath: "/tmp/wf-outcomes",
      branch: "wf-human",
      specPath: "/tmp/spec.md",
      stepId: "step-human",
      workflowSnapshot: workflowSnapshot("workflow-1", { stepId: "step-human", role: "implement" }),
    });
    stateStore.setRunStatus(awaitingHumanRunId, "awaiting-human");

    const runs = await listRuns(client);
    expect(runs?.find((row) => row.runId === budgetRunId)?.workflow).toEqual({
      steps: [
        {
          stepId: "step-budget",
          role: "implement",
          status: "stopped",
          attemptCount: 1,
          terminalOutcome: "budget-exhausted",
        },
      ],
    });
    expect(runs?.find((row) => row.runId === pausedRunId)?.workflow).toEqual({
      steps: [
        { stepId: "step-paused", role: "implement", status: "stopped", attemptCount: 1, terminalOutcome: "paused" },
      ],
    });
    expect(runs?.find((row) => row.runId === killedRunId)?.workflow).toEqual({
      steps: [
        { stepId: "step-killed", role: "implement", status: "stopped", attemptCount: 1, terminalOutcome: "killed" },
      ],
    });
    expect(runs?.find((row) => row.runId === contractMissRunId)?.workflow).toEqual({
      steps: [
        {
          stepId: "step-contract",
          role: "implement",
          status: "stopped",
          attemptCount: 1,
          terminalOutcome: "contract_miss",
        },
      ],
    });
    expect(runs?.find((row) => row.runId === awaitingHumanRunId)?.workflow).toEqual({
      steps: [
        {
          stepId: "step-human",
          role: "implement",
          status: "stopped",
          attemptCount: 0,
          terminalOutcome: "awaiting-human",
        },
      ],
    });

    client.close();
  },
);

socketTest("list builds a review-debate row from the live role pointer while in progress", async () => {
  const client = await connectIpcClient(SOCKET_PATH, 2_000);

  const snapshot = workflowSnapshot(
    "workflow-debate",
    { stepId: "step-1", role: "implement" },
    { stepId: "step-debate", role: "", behavior: "review-debate" },
  );
  const runId = stateStore.createRun({
    project: "wf-debate",
    specRef: "main",
    worktreePath: "/tmp/wf-debate",
    branch: "wf-debate",
    specPath: "/tmp/spec.md",
    stepId: "step-1",
    workflowSnapshot: snapshot,
  });
  stateStore.setRunStatus(runId, "completed");

  let runs = await listRuns(client);
  let row = runs?.find((candidate) => candidate.runId === runId);
  expect(row?.workflow?.steps.find((step) => step.stepId === "step-debate")).toEqual({
    stepId: "step-debate",
    role: "",
    status: "pending",
    attemptCount: 0,
  });

  reportReviewDebateProgress("workflow-debate", "step-debate", { status: "in_progress", role: "advocate" });

  runs = await listRuns(client);
  row = runs?.find((candidate) => candidate.runId === runId);
  expect(row?.workflow?.steps.find((step) => step.stepId === "step-debate")).toEqual({
    stepId: "step-debate",
    role: "advocate",
    status: "in_progress",
    attemptCount: 0,
  });

  client.close();
});

socketTest("list builds a review-debate row from the terminal role/outcome once the cycle ends", async () => {
  const client = await connectIpcClient(SOCKET_PATH, 2_000);

  const snapshot = workflowSnapshot(
    "workflow-debate-done",
    { stepId: "step-1", role: "implement" },
    { stepId: "step-debate", role: "", behavior: "review-debate" },
  );
  const runId = stateStore.createRun({
    project: "wf-debate-done",
    specRef: "main",
    worktreePath: "/tmp/wf-debate-done",
    branch: "wf-debate-done",
    specPath: "/tmp/spec.md",
    stepId: "step-1",
    workflowSnapshot: snapshot,
  });
  stateStore.setRunStatus(runId, "completed");

  reportReviewDebateProgress("workflow-debate-done", "step-debate", { status: "in_progress", role: "adjudicator" });
  reportReviewDebateProgress("workflow-debate-done", "step-debate", {
    status: "completed",
    role: "actuator",
    terminalOutcome: "complete",
  });

  const runs = await listRuns(client);
  const row = runs?.find((candidate) => candidate.runId === runId);
  expect(row?.workflow?.steps.find((step) => step.stepId === "step-debate")).toEqual({
    stepId: "step-debate",
    role: "actuator",
    status: "completed",
    attemptCount: 0,
    terminalOutcome: "complete",
  });

  client.close();
});

socketTest("review-debate progress does not bleed across invocations sharing a stepId", async () => {
  const client = await connectIpcClient(SOCKET_PATH, 2_000);

  const snapshotA = workflowSnapshot(
    "workflow-debate-a",
    { stepId: "step-1", role: "implement" },
    { stepId: "step-debate", role: "", behavior: "review-debate" },
  );
  const runA = stateStore.createRun({
    project: "wf-debate-a",
    specRef: "main",
    worktreePath: "/tmp/wf-debate-a",
    branch: "wf-debate-a",
    specPath: "/tmp/spec.md",
    stepId: "step-1",
    workflowSnapshot: snapshotA,
  });
  stateStore.setRunStatus(runA, "completed");

  const snapshotB = workflowSnapshot(
    "workflow-debate-b",
    { stepId: "step-1", role: "implement" },
    { stepId: "step-debate", role: "", behavior: "review-debate" },
  );
  const runB = stateStore.createRun({
    project: "wf-debate-b",
    specRef: "main",
    worktreePath: "/tmp/wf-debate-b",
    branch: "wf-debate-b",
    specPath: "/tmp/spec.md",
    stepId: "step-1",
    workflowSnapshot: snapshotB,
  });
  stateStore.setRunStatus(runB, "completed");

  reportReviewDebateProgress("workflow-debate-a", "step-debate", { status: "in_progress", role: "advocate" });

  const runs = await listRuns(client);
  const rowA = runs?.find((candidate) => candidate.runId === runA);
  const rowB = runs?.find((candidate) => candidate.runId === runB);
  expect(rowA?.workflow?.steps.find((step) => step.stepId === "step-debate")).toEqual({
    stepId: "step-debate",
    role: "advocate",
    status: "in_progress",
    attemptCount: 0,
  });
  expect(rowB?.workflow?.steps.find((step) => step.stepId === "step-debate")).toEqual({
    stepId: "step-debate",
    role: "",
    status: "pending",
    attemptCount: 0,
  });

  client.close();
});

socketTest("pause signals graceful stop for an active run", async () => {
  const client = await connectIpcClient(SOCKET_PATH, 2_000);
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
  const client = await connectIpcClient(SOCKET_PATH, 2_000);

  client.send({ kind: "request", id: "p1", method: "pause", params: { runId: "unknown-id" } });
  const pauseResponse = await client.nextFrame();
  expect(pauseResponse.kind).toBe("error");
  if (pauseResponse.kind === "error") {
    expect(pauseResponse.code).toBe("unknown_run");
  }
  client.close();
});

socketTest("list includes error on terminal rows and omits it on in-progress and completed", async () => {
  const client = await connectIpcClient(SOCKET_PATH, 2_000);
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

  const client = await connectIpcClient(SOCKET_PATH, 2_000);
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
  const client = await connectIpcClient(SOCKET_PATH, 2_000);
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
  const client = await connectIpcClient(SOCKET_PATH, 2_000);

  client.send({ kind: "request", id: "k1", method: "kill", params: { runId: "unknown-id" } });
  const killResponse = await client.nextFrame();
  expect(killResponse.kind).toBe("error");
  if (killResponse.kind === "error") {
    expect(killResponse.code).toBe("unknown_run");
  }
  client.close();
});

socketTest("resume rejects unknown run ID", async () => {
  const client = await connectIpcClient(SOCKET_PATH, 2_000);

  client.send({ kind: "request", id: "r1", method: "resume", params: { runId: "unknown-id" } });
  const resumeResponse = await client.nextFrame();
  expect(resumeResponse.kind).toBe("error");
  if (resumeResponse.kind === "error") {
    expect(resumeResponse.code).toBe("unknown_run");
  }
  client.close();
});

socketTest("resume rejects terminal run status", async () => {
  const client = await connectIpcClient(SOCKET_PATH, 2_000);
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

socketTest("resume without decision on an awaiting-human run is rejected invalid_params", async () => {
  const client = await connectIpcClient(SOCKET_PATH, 2_000);

  const runId = stateStore.createRun({
    project: "test-project",
    specRef: "main",
    worktreePath: "/tmp/test-project",
    branch: "human-branch",
    specPath: "/tmp/test-project/spec.md",
  });
  stateStore.setRunStatus(runId, "awaiting-human");

  client.send({ kind: "request", id: "r1", method: "resume", params: { runId } });
  const resumeResponse = await client.nextFrame();
  expect(resumeResponse.kind).toBe("error");
  if (resumeResponse.kind === "error") {
    expect(resumeResponse.code).toBe("invalid_params");
  }
  client.close();
});

socketTest("resume with decision approve completes the human step run", async () => {
  const client = await connectIpcClient(SOCKET_PATH, 2_000);

  const runId = stateStore.createRun({
    project: "test-project",
    specRef: "main",
    worktreePath: "/tmp/test-project",
    branch: "human-branch",
    specPath: "/tmp/test-project/spec.md",
  });
  stateStore.setRunStatus(runId, "awaiting-human");

  client.send({ kind: "request", id: "r1", method: "resume", params: { runId, decision: "approve" } });
  const resumeResponse = await client.nextFrame();
  expect(resumeResponse.kind).toBe("response");

  const runs = await listRuns(client);
  if (runs) {
    const run = runs.find((candidate) => candidate.runId === runId);
    expect(run).toBeDefined();
    expect(run?.status).toBe("completed");
  }
  client.close();
});

socketTest("resume with decision abort kills the human step run", async () => {
  const client = await connectIpcClient(SOCKET_PATH, 2_000);

  const runId = stateStore.createRun({
    project: "test-project",
    specRef: "main",
    worktreePath: "/tmp/test-project",
    branch: "human-branch",
    specPath: "/tmp/test-project/spec.md",
  });
  stateStore.setRunStatus(runId, "awaiting-human");

  client.send({ kind: "request", id: "r1", method: "resume", params: { runId, decision: "abort" } });
  const resumeResponse = await client.nextFrame();
  expect(resumeResponse.kind).toBe("response");

  const runs = await listRuns(client);
  if (runs) {
    const run = runs.find((candidate) => candidate.runId === runId);
    expect(run).toBeDefined();
    expect(run?.status).toBe("killed");
  }
  client.close();
});

socketTest("resume with decision revise on an awaiting-human run is rejected", async () => {
  const client = await connectIpcClient(SOCKET_PATH, 2_000);

  const runId = stateStore.createRun({
    project: "test-project",
    specRef: "main",
    worktreePath: "/tmp/test-project",
    branch: "human-branch",
    specPath: "/tmp/test-project/spec.md",
  });
  stateStore.setRunStatus(runId, "awaiting-human");

  client.send({ kind: "request", id: "r1", method: "resume", params: { runId, decision: "revise" } });
  const resumeResponse = await client.nextFrame();
  expect(resumeResponse.kind).toBe("error");
  if (resumeResponse.kind === "error") {
    expect(resumeResponse.code).toBe("revise_unsupported");
  }
  client.close();
});

socketTest("resume with a decision param on a non-awaiting-human run is rejected", async () => {
  const client = await connectIpcClient(SOCKET_PATH, 2_000);
  const runId = await startRun(client);
  if (!runId) {
    client.close();
    return;
  }

  fakeExecutor.settleAll();
  await flushBackgroundRuns();

  const pausedRunId = stateStore.createRun({
    project: "test-project",
    specRef: "main",
    worktreePath: "/tmp/test-project",
    branch: "paused-branch",
    specPath: "/tmp/test-project/spec.md",
  });
  stateStore.setRunStatus(pausedRunId, "paused");

  client.send({ kind: "request", id: "r1", method: "resume", params: { runId: pausedRunId, decision: "approve" } });
  const resumeResponse = await client.nextFrame();
  expect(resumeResponse.kind).toBe("error");
  if (resumeResponse.kind === "error") {
    expect(resumeResponse.code).toBe("invalid_params");
  }
  client.close();
});

socketTest("resume rejects if another run is in-flight (single in-flight guard)", async () => {
  const client = await connectIpcClient(SOCKET_PATH, 2_000);
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
  const client = await connectIpcClient(SOCKET_PATH, 2_000);
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
