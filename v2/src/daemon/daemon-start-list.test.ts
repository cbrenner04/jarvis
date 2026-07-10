import { afterEach, beforeEach, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentModelConfig } from "../config/agent-model-config.ts";
import type { WriteLoopInput } from "../execution/write-loop.ts";
import type { Attempt, Run } from "../persistence/state-store.ts";
import type { LogReader } from "../persistence/log-stream.ts";
import { openStateStore, type StateStore } from "../persistence/state-store.ts";
import { listRunsDirect, mockWriteLoopInput, startRunDirect } from "../testing/run-control.ts";
import { createFakeWriteLoopExecutor, type FakeWriteLoopExecutor } from "../testing/write-loop-executor.ts";
import { createRunControlHandlers, stoppedOutcomeForRun } from "./daemon.ts";

type Handlers = ReturnType<typeof createRunControlHandlers>;

async function pauseDirect(h: Handlers, runId: string) {
  return h.pause({ kind: "request", id: "p1", method: "pause", params: { runId } }, new AbortController().signal);
}

async function killDirect(h: Handlers, runId: string) {
  return h.kill({ kind: "request", id: "k1", method: "kill", params: { runId } }, new AbortController().signal);
}

async function resumeDirect(h: Handlers, params: { runId: string; decision?: string; prompt?: string }) {
  return h.resume({ kind: "request", id: "r1", method: "resume", params }, new AbortController().signal);
}

function runFixture(
  status: Run["status"],
  attempts: Array<Pick<Attempt, "outcomeKind">> = [],
): Run & { attempts: Attempt[] } {
  return {
    id: "run-1",
    project: "wf-outcomes",
    specRef: "main",
    createdAt: 0,
    status,
    attemptCount: attempts.length,
    worktreePath: "/tmp/wf-outcomes",
    branch: "wf-outcomes",
    specPath: "/tmp/spec.md",
    attempts: attempts.map((attempt, index) => ({
      id: `attempt-${index}`,
      runId: "run-1",
      attemptNumber: index + 1,
      startedAt: 0,
      status: "completed",
      outcomeKind: attempt.outcomeKind,
      invocationFailureDetail: null,
    })),
  };
}

function workflowSnapshot(
  invocationId: string,
  ...steps: Array<{ stepId: string; role: string; behavior?: "review-debate" }>
) {
  return { invocationId, steps };
}

let stateStore: StateStore;
let fakeExecutor: FakeWriteLoopExecutor;
let memoryHeadroom: boolean;
let handlers: Handlers;

const AGENT_MODEL_CONFIG: AgentModelConfig = {
  codex: {
    implement: {
      rungs: [
        { adapterModel: "codex-fast", priceKey: "codex-fast" },
        { adapterModel: "codex-deep", priceKey: "codex-deep" },
      ],
    },
  },
};

function loadRunOrThrow(store: StateStore, runId: string) {
  const run = store.loadRun(runId);
  if (!run) throw new Error(`missing run ${runId}`);
  return run;
}

function serialized(input: WriteLoopInput): WriteLoopInput {
  return JSON.parse(JSON.stringify(input)) as WriteLoopInput;
}

async function flushBackgroundRuns(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

beforeEach(() => {
  stateStore = openStateStore(join(tmpdir(), `jarvis-state-${process.pid}-${Date.now()}.db`));
  fakeExecutor = createFakeWriteLoopExecutor();
  memoryHeadroom = true;

  handlers = createRunControlHandlers({
    stateStore,
    writeLoopExecutor: fakeExecutor.executor,
    failureReporter: () => {},
    hasMemoryHeadroom: () => memoryHeadroom,
    settleDelayMs: 0,
  });
});

afterEach(async () => {
  fakeExecutor.abortAll();
  await flushBackgroundRuns();
  try {
    stateStore.close();
  } catch {
    // store may be closed
  }
});

test("start admits a second (project, branch) while another run is active", async () => {
  await startRunDirect(handlers);

  const response2 = await handlers.start(
    {
      kind: "request",
      id: "s2",
      method: "start",
      params: { input: mockWriteLoopInput({ projectName: "other-project" }) },
    },
    new AbortController().signal,
  );
  expect(response2.kind).toBe("response");
});

test("start persists a queued run when memory headroom is unavailable", async () => {
  memoryHeadroom = false;

  const runId = await startRunDirect(handlers);
  expect(typeof runId).toBe("string");
  if (runId) {
    const run = loadRunOrThrow(stateStore, runId);
    expect(run.status).toBe("queued");
    expect(fakeExecutor.isAbortSignalTriggered()).toBe(false);
  }

  const runs = await listRunsDirect(handlers);
  const row = runs?.find((candidate) => candidate.runId === runId);
  expect(row?.status).toBe("queued");
  expect(row?.isLive).toBe(false);
});

test("start resolves serialized workflow-step input from binding context", async () => {
  const starts: WriteLoopInput[] = [];
  const localHandlers = createRunControlHandlers({
    stateStore,
    writeLoopExecutor: async (input) => {
      starts.push(input);
    },
    failureReporter: () => {},
    hasMemoryHeadroom: () => true,
    settleDelayMs: 0,
  });
  const input: WriteLoopInput = {
    ...mockWriteLoopInput({ projectName: "workflow-project", branchName: "workflow-branch" }),
    bindings: [{ id: "codex" } as WriteLoopInput["bindings"][number]],
    bindingResolution: {
      role: "implement",
      agents: ["codex"],
      agentModelConfig: AGENT_MODEL_CONFIG,
    },
    stepId: "step-1",
  };

  const runId = await startRunDirect(localHandlers, serialized(input));

  expect(runId).toBeDefined();
  expect(starts[0]?.bindings.map((binding) => binding.id)).toEqual([
    "codex/codex-fast/codex-fast",
    "codex/codex-deep/codex-deep",
  ]);
});

test("start rejects a second start for a (project, branch) with an existing queued run", async () => {
  memoryHeadroom = false;
  const input = mockWriteLoopInput();
  await startRunDirect(handlers, input);

  const response2 = await handlers.start(
    { kind: "request", id: "s2", method: "start", params: { input } },
    new AbortController().signal,
  );
  expect(response2.kind).toBe("error");
  if (response2.kind === "error") {
    expect(response2.code).toBe("worktree_claimed");
  }
});

test("start rejects second start for same (project, branch) while first is active", async () => {
  const input = mockWriteLoopInput();
  await startRunDirect(handlers, input);

  const response2 = await handlers.start(
    { kind: "request", id: "s2", method: "start", params: { input } },
    new AbortController().signal,
  );
  expect(response2.kind).toBe("error");
  if (response2.kind === "error") {
    expect(response2.code).toBe("worktree_claimed");
  }
});

test("settled run is no longer live in list", async () => {
  await startRunDirect(handlers);

  fakeExecutor.settleAll();
  await flushBackgroundRuns();

  const runs = await listRunsDirect(handlers);
  expect(runs?.length).toBeGreaterThan(0);
  const run = runs?.[0];
  expect(run?.isLive).toBe(false);
});

test("two admitted runs progress concurrently, settling independently", async () => {
  const input1 = mockWriteLoopInput({ projectName: "project-one", branchName: "branch-one" });
  const input2 = mockWriteLoopInput({ projectName: "project-two", branchName: "branch-two" });

  const runId1 = await startRunDirect(handlers, input1);
  const runId2 = await startRunDirect(handlers, input2);
  await flushBackgroundRuns();

  expect(fakeExecutor.pendingCount()).toBe(2);

  const runsBothLive = await listRunsDirect(handlers);
  expect(runsBothLive?.find((run) => run.runId === runId1)?.isLive).toBe(true);
  expect(runsBothLive?.find((run) => run.runId === runId2)?.isLive).toBe(true);

  fakeExecutor.settleFirst();
  await flushBackgroundRuns();
  // Fake executor mirrors only liveness, not the real loop's terminal status
  // commit; simulate that commit directly, as other tests in this file do.
  stateStore.setRunStatus(runId1 as string, "completed");

  expect(fakeExecutor.pendingCount()).toBe(1);
  const runsAfterFirstSettles = await listRunsDirect(handlers);
  expect(runsAfterFirstSettles?.find((run) => run.runId === runId1)?.status).toBe("completed");
  expect(runsAfterFirstSettles?.find((run) => run.runId === runId2)?.isLive).toBe(true);
});

test("list returns workflow step snapshots for live, stopped, and completed workflow-backed runs", async () => {
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
  handlers = createRunControlHandlers({
    stateStore,
    writeLoopExecutor: fakeExecutor.executor,
    failureReporter: () => {},
    hasMemoryHeadroom: () => true,
    settleDelayMs: 0,
  });

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

  const liveRunId = await startRunDirect(handlers, {
    ...mockWriteLoopInput({ projectName: "wf-project", branchName: "wf-live", projectRoot: "/tmp/wf-project" }),
    stepId: "step-2",
    workflowSnapshot: snapshot,
  });
  expect(liveRunId).toBeDefined();

  let runs = await listRunsDirect(handlers);
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

  runs = await listRunsDirect(handlers);
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

  runs = await listRunsDirect(handlers);
  const completedRow = runs?.find((row) => row.runId === completeRunB);
  expect(completedRow?.workflow).toEqual({
    steps: [
      { stepId: "step-a", role: "implement", status: "completed", attemptCount: 1, terminalOutcome: "complete" },
      { stepId: "step-b", role: "review", status: "completed", attemptCount: 1, terminalOutcome: "complete" },
    ],
  });
});

test("stoppedOutcomeForRun maps blocked with a contract_miss attempt to contract_miss", () => {
  expect(stoppedOutcomeForRun(runFixture("blocked", [{ outcomeKind: "contract_miss" }]))).toBe("contract_miss");
});

test("stoppedOutcomeForRun maps blocked without a contract_miss attempt to blocked", () => {
  expect(stoppedOutcomeForRun(runFixture("blocked", [{ outcomeKind: "blocked" }]))).toBe("blocked");
});

test("stoppedOutcomeForRun maps budget-soft-stopped to budget-exhausted", () => {
  expect(stoppedOutcomeForRun(runFixture("budget-soft-stopped"))).toBe("budget-exhausted");
});

test("stoppedOutcomeForRun maps paused to paused", () => {
  expect(stoppedOutcomeForRun(runFixture("paused"))).toBe("paused");
});

test("stoppedOutcomeForRun maps killed to killed", () => {
  expect(stoppedOutcomeForRun(runFixture("killed"))).toBe("killed");
});

test("stoppedOutcomeForRun maps awaiting-human to awaiting-human", () => {
  expect(stoppedOutcomeForRun(runFixture("awaiting-human"))).toBe("awaiting-human");
});

test("stoppedOutcomeForRun falls back to invocation_failure for any other status", () => {
  expect(stoppedOutcomeForRun(runFixture("failed"))).toBe("invocation_failure");
});

test("list builds a review-debate row from the live role pointer while in progress", async () => {
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

  let runs = await listRunsDirect(handlers);
  let row = runs?.find((candidate) => candidate.runId === runId);
  expect(row?.workflow?.steps.find((step) => step.stepId === "step-debate")).toEqual({
    stepId: "step-debate",
    role: "",
    status: "pending",
    attemptCount: 0,
  });

  handlers.reportReviewDebateProgress("workflow-debate", "step-debate", { status: "in_progress", role: "advocate" });

  runs = await listRunsDirect(handlers);
  row = runs?.find((candidate) => candidate.runId === runId);
  expect(row?.workflow?.steps.find((step) => step.stepId === "step-debate")).toEqual({
    stepId: "step-debate",
    role: "advocate",
    status: "in_progress",
    attemptCount: 0,
  });
});

test("list builds a review-debate row from the terminal role/outcome once the cycle ends", async () => {
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

  handlers.reportReviewDebateProgress("workflow-debate-done", "step-debate", {
    status: "in_progress",
    role: "adjudicator",
  });
  handlers.reportReviewDebateProgress("workflow-debate-done", "step-debate", {
    status: "completed",
    role: "actuator",
    terminalOutcome: "complete",
  });

  const runs = await listRunsDirect(handlers);
  const row = runs?.find((candidate) => candidate.runId === runId);
  expect(row?.workflow?.steps.find((step) => step.stepId === "step-debate")).toEqual({
    stepId: "step-debate",
    role: "actuator",
    status: "completed",
    attemptCount: 0,
    terminalOutcome: "complete",
  });
});

test("review-debate progress does not bleed across invocations sharing a stepId", async () => {
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

  handlers.reportReviewDebateProgress("workflow-debate-a", "step-debate", { status: "in_progress", role: "advocate" });

  const runs = await listRunsDirect(handlers);
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
});

test("review-debate progress does not leak between separate handler instances", async () => {
  const snapshot = workflowSnapshot(
    "workflow-debate-instances",
    { stepId: "step-1", role: "implement" },
    { stepId: "step-debate", role: "", behavior: "review-debate" },
  );
  const runId = stateStore.createRun({
    project: "wf-debate-instances",
    specRef: "main",
    worktreePath: "/tmp/wf-debate-instances",
    branch: "wf-debate-instances",
    specPath: "/tmp/spec.md",
    stepId: "step-1",
    workflowSnapshot: snapshot,
  });
  stateStore.setRunStatus(runId, "completed");

  const otherHandlers = createRunControlHandlers({
    stateStore,
    writeLoopExecutor: fakeExecutor.executor,
    failureReporter: () => {},
    hasMemoryHeadroom: () => memoryHeadroom,
    settleDelayMs: 0,
  });

  otherHandlers.reportReviewDebateProgress("workflow-debate-instances", "step-debate", {
    status: "in_progress",
    role: "advocate",
  });

  const runs = await listRunsDirect(handlers);
  const row = runs?.find((candidate) => candidate.runId === runId);
  expect(row?.workflow?.steps.find((step) => step.stepId === "step-debate")).toEqual({
    stepId: "step-debate",
    role: "",
    status: "pending",
    attemptCount: 0,
  });
});

test("pause signals graceful stop for an active run", async () => {
  const runId = await startRunDirect(handlers);
  if (!runId) return;

  const pauseResponse = await pauseDirect(handlers, runId);
  expect(pauseResponse.kind).toBe("response");
  if (pauseResponse.kind === "response") {
    expect((pauseResponse.result as { ok?: boolean } | undefined)?.ok).toBe(true);
  }
  expect(fakeExecutor.isPauseSignalTriggered()).toBe(true);
});

test("pause rejects unknown run ID", async () => {
  const pauseResponse = await pauseDirect(handlers, "unknown-id");
  expect(pauseResponse.kind).toBe("error");
  if (pauseResponse.kind === "error") {
    expect(pauseResponse.code).toBe("unknown_run");
  }
});

test("list includes error on terminal rows and omits it on in-progress and completed", async () => {
  const runId = await startRunDirect(handlers);
  if (!runId) return;

  let runs = await listRunsDirect(handlers);
  expect(runs?.[0]?.error).toBeUndefined();

  await killDirect(handlers, runId);

  runs = await listRunsDirect(handlers);
  const killed = runs?.find((candidate) => candidate.runId === runId);
  expect(killed?.error).toEqual({
    reason: "resumable_kill",
    retryable: true,
    nextAction: "resume",
  });

  fakeExecutor.settleAll();
  await flushBackgroundRuns();
  stateStore.setRunStatus(runId, "completed");

  runs = await listRunsDirect(handlers);
  const completed = runs?.find((candidate) => candidate.runId === runId);
  expect(completed?.error).toBeUndefined();
});

test("kill aborts an active run and records killed status", async () => {
  const runId = await startRunDirect(handlers);
  if (!runId) return;

  const killResponse = await killDirect(handlers, runId);
  expect(killResponse.kind).toBe("response");
  if (killResponse.kind === "response") {
    expect((killResponse.result as { ok?: boolean } | undefined)?.ok).toBe(true);
  }
  expect(fakeExecutor.isAbortSignalTriggered()).toBe(true);

  const runs = await listRunsDirect(handlers);
  const run = runs?.find((candidate) => candidate.runId === runId);
  expect(run).toBeDefined();
  expect(run?.status).toBe("killed");
});

test("kill rejects unknown run ID", async () => {
  const killResponse = await killDirect(handlers, "unknown-id");
  expect(killResponse.kind).toBe("error");
  if (killResponse.kind === "error") {
    expect(killResponse.code).toBe("unknown_run");
  }
});

test("resume rejects unknown run ID", async () => {
  const resumeResponse = await resumeDirect(handlers, { runId: "unknown-id" });
  expect(resumeResponse.kind).toBe("error");
  if (resumeResponse.kind === "error") {
    expect(resumeResponse.code).toBe("unknown_run");
  }
});

test("resume rejects terminal run status", async () => {
  const runId = await startRunDirect(handlers);
  if (!runId) return;

  fakeExecutor.settleAll();
  await flushBackgroundRuns();
  stateStore.setRunStatus(runId, "completed");

  const resumeResponse = await resumeDirect(handlers, { runId });
  expect(resumeResponse.kind).toBe("error");
  if (resumeResponse.kind === "error") {
    expect(resumeResponse.code).toBe("terminal_run");
    expect(resumeResponse.message).toBe("Cannot resume a completed run");
  }
});

test("resume retries a completed run after completion publication failed", async () => {
  const runId = stateStore.createRun({
    project: "test-project",
    specRef: "main",
    worktreePath: "/tmp/test-project",
    branch: "test-branch",
    specPath: "/tmp/test-project/spec.md",
  });
  stateStore.setRunStatus(runId, "completed");
  const logReader: LogReader = {
    tail: () => [
      {
        runId,
        seq: 1,
        ts: "2026-01-01T00:00:00.000Z",
        event: { kind: "loop_finished", loopOutcomeKind: "completion_commit_failed", iterationsConsumed: 1, resumable: true },
      },
    ],
    async *follow() {},
  };
  handlers = createRunControlHandlers({
    stateStore,
    logReader,
    writeLoopExecutor: fakeExecutor.executor,
    failureReporter: () => {},
    hasMemoryHeadroom: () => true,
    settleDelayMs: 0,
  });

  expect((await resumeDirect(handlers, { runId })).kind).toBe("response");
  expect(fakeExecutor.pendingCount()).toBe(1);
});

test("resume without decision on an awaiting-human run is rejected invalid_params", async () => {
  const runId = stateStore.createRun({
    project: "test-project",
    specRef: "main",
    worktreePath: "/tmp/test-project",
    branch: "human-branch",
    specPath: "/tmp/test-project/spec.md",
  });
  stateStore.setRunStatus(runId, "awaiting-human");

  const resumeResponse = await resumeDirect(handlers, { runId });
  expect(resumeResponse.kind).toBe("error");
  if (resumeResponse.kind === "error") {
    expect(resumeResponse.code).toBe("invalid_params");
  }
});

test("resume with decision approve completes the human step run", async () => {
  const runId = stateStore.createRun({
    project: "test-project",
    specRef: "main",
    worktreePath: "/tmp/test-project",
    branch: "human-branch",
    specPath: "/tmp/test-project/spec.md",
  });
  stateStore.setRunStatus(runId, "awaiting-human");

  const resumeResponse = await resumeDirect(handlers, { runId, decision: "approve" });
  expect(resumeResponse.kind).toBe("response");

  const runs = await listRunsDirect(handlers);
  const run = runs?.find((candidate) => candidate.runId === runId);
  expect(run).toBeDefined();
  expect(run?.status).toBe("completed");
});

test("resume with decision abort kills the human step run", async () => {
  const runId = stateStore.createRun({
    project: "test-project",
    specRef: "main",
    worktreePath: "/tmp/test-project",
    branch: "human-branch",
    specPath: "/tmp/test-project/spec.md",
  });
  stateStore.setRunStatus(runId, "awaiting-human");

  const resumeResponse = await resumeDirect(handlers, { runId, decision: "abort" });
  expect(resumeResponse.kind).toBe("response");

  const runs = await listRunsDirect(handlers);
  const run = runs?.find((candidate) => candidate.runId === runId);
  expect(run).toBeDefined();
  expect(run?.status).toBe("killed");
});

test("resume with decision revise on an awaiting-human run is rejected", async () => {
  const runId = stateStore.createRun({
    project: "test-project",
    specRef: "main",
    worktreePath: "/tmp/test-project",
    branch: "human-branch",
    specPath: "/tmp/test-project/spec.md",
  });
  stateStore.setRunStatus(runId, "awaiting-human");

  const resumeResponse = await resumeDirect(handlers, { runId, decision: "revise" });
  expect(resumeResponse.kind).toBe("error");
  if (resumeResponse.kind === "error") {
    expect(resumeResponse.code).toBe("revise_unsupported");
  }
});

test("resume with a decision param on a non-awaiting-human run is rejected", async () => {
  const runId = await startRunDirect(handlers);
  if (!runId) return;

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

  const resumeResponse = await resumeDirect(handlers, { runId: pausedRunId, decision: "approve" });
  expect(resumeResponse.kind).toBe("error");
  if (resumeResponse.kind === "error") {
    expect(resumeResponse.code).toBe("invalid_params");
  }
});

test("resume rejects a paused run while another run is in-flight with not_implemented", async () => {
  await startRunDirect(handlers);

  const pausedRunId = stateStore.createRun({
    project: "test-project",
    specRef: "main",
    worktreePath: "/tmp/other-worktree",
    branch: "other-branch",
    specPath: "/tmp/test-project/spec.md",
  });
  stateStore.setRunStatus(pausedRunId, "paused");

  const resumeResponse = await resumeDirect(handlers, { runId: pausedRunId });
  expect(resumeResponse.kind).toBe("error");
  if (resumeResponse.kind === "error") {
    expect(resumeResponse.code).toBe("not_implemented");
  }
});

test("resume rejects worktree_claimed when the (project, branch) is already live", async () => {
  await startRunDirect(handlers);

  const pausedRunId = stateStore.createRun({
    project: "test-project",
    specRef: "main",
    worktreePath: "/tmp/test-project",
    branch: "test-branch",
    specPath: "/tmp/test-project/spec.md",
  });
  stateStore.setRunStatus(pausedRunId, "paused");

  const resumeResponse = await resumeDirect(handlers, { runId: pausedRunId });
  expect(resumeResponse.kind).toBe("error");
  if (resumeResponse.kind === "error") {
    expect(resumeResponse.code).toBe("worktree_claimed");
  }
});
