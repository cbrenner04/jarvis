import { afterEach, beforeEach, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentModelConfig } from "../config/agent-model-config.ts";
import type { WriteLoopInput } from "../execution/write-loop.ts";
import { executeWriteLoop } from "../execution/write-loop.ts";
import { openLogReader, openLogSink } from "../persistence/log-stream.ts";
import { openStateStore, type StateStore } from "../persistence/state-store.ts";
import {
  flushBackgroundRuns,
  listRunsDirect,
  loadRunOrThrow,
  mockWriteLoopInput,
  startRunDirect,
  workflowSnapshot,
} from "../testing/run-control.ts";
import { createFakeWriteLoopExecutor, type FakeWriteLoopExecutor } from "../testing/write-loop-executor.ts";
import { createRunControlHandlers } from "./daemon.ts";

type Handlers = ReturnType<typeof createRunControlHandlers>;

async function pauseDirect(h: Handlers, runId: string) {
  return h.pause({ kind: "request", id: "p1", method: "pause", params: { runId } }, new AbortController().signal);
}

async function killDirect(h: Handlers, runId: string) {
  return h.kill({ kind: "request", id: "k1", method: "kill", params: { runId } }, new AbortController().signal);
}

async function waitDirect(h: Handlers, runId: string) {
  return h.wait({ kind: "request", id: "w1", method: "wait", params: { runId } }, new AbortController().signal);
}

let stateStore: StateStore;
let stateStorePath: string;
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

function serialized(input: WriteLoopInput): WriteLoopInput {
  return JSON.parse(JSON.stringify(input)) as WriteLoopInput;
}

beforeEach(() => {
  stateStorePath = join(tmpdir(), `jarvis-state-${process.pid}-${Date.now()}.db`);
  stateStore = openStateStore(stateStorePath);
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

test("direct timeout releases liveness and worktree ownership", async () => {
  const logsPath = join(tmpdir(), `jarvis-timeout-${process.pid}-${Date.now()}.jsonl`);
  const sink = openLogSink(logsPath);
  const localHandlers = createRunControlHandlers({
    stateStore,
    logReader: openLogReader(logsPath),
    writeLoopExecutor: async (input, signal) => {
      await executeWriteLoop({ ...input, stateStore, logSink: sink, signal });
    },
    failureReporter: () => {},
    hasMemoryHeadroom: () => true,
    settleDelayMs: 0,
  });
  const input: WriteLoopInput = {
    ...mockWriteLoopInput({
      projectName: "timeout-direct",
      branchName: "timeout-direct",
      git: false,
      localPath: join(tmpdir(), `jarvis-timeout-worktree-${process.pid}-${Date.now()}`),
    }),
    iterationTimeoutMs: 5,
    bindings: [
      {
        id: "stall",
        invoke: ({ signal }) =>
          new Promise((resolve) =>
            signal?.addEventListener("abort", () => resolve({ kind: "error", exitCode: 1, stderr: "aborted" }), {
              once: true,
            }),
          ),
      },
    ],
  };

  const runId = await startRunDirect(localHandlers, input);
  const deadline = Date.now() + 100;
  while (Date.now() < deadline) {
    const row = (await listRunsDirect(localHandlers))?.find((candidate) => candidate.runId === runId);
    if (row?.status === "failed" && !row?.isLive) break;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  const row = (await listRunsDirect(localHandlers))?.find((candidate) => candidate.runId === runId);
  expect(row).toMatchObject({ status: "failed", isLive: false });
  const waited = await waitDirect(localHandlers, runId as string);
  expect(waited).toMatchObject({
    kind: "response",
    result: { runStatus: "failed", loopOutcomeKind: "iteration_timeout" },
  });

  const restarted = await startRunDirect(localHandlers, input);
  expect(restarted).toBeTruthy();
  const deadline2 = Date.now() + 100;
  while (Date.now() < deadline2) {
    const runs = await listRunsDirect(localHandlers);
    if (runs?.find((r) => r.runId === restarted)) break;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  await new Promise<void>((resolve) => setImmediate(resolve));
  sink.close();
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
      stepId: input.stepId ?? null,
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

  const snapshot = workflowSnapshot("workflow-1", [
    { stepId: "step-1", role: "implement" },
    { stepId: "step-2", role: "review" },
    { stepId: "step-3", role: "verify" },
  ]);

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

  const completeSnapshot = workflowSnapshot("workflow-1", [
    { stepId: "step-a", role: "implement" },
    { stepId: "step-b", role: "review" },
  ]);
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

test("list exposes retained implement reviewPasses and reviewBehavior and omits them for non-implement workflows", async () => {
  const implementZeroSnapshot = workflowSnapshot("workflow-implement-0", [{ stepId: "implement", role: "implement" }], {
    reviewPasses: 0,
    reviewBehavior: "light",
  });
  const implementPositiveSnapshot = workflowSnapshot(
    "workflow-implement-2",
    [
      { stepId: "implement", role: "implement" },
      { stepId: "implement-review", role: "", behavior: "review-debate" },
    ],
    { reviewPasses: 2, reviewBehavior: "debate" },
  );
  const planSnapshot = workflowSnapshot("workflow-plan", [{ stepId: "step-1", role: "plan" }]);

  const implementZeroRunId = stateStore.createRun({
    project: "wf-project",
    specRef: "main",
    worktreePath: "/tmp/wf-project",
    branch: "wf-implement-0",
    specPath: "/tmp/spec.md",
    stepId: "implement",
    workflowSnapshot: implementZeroSnapshot,
  });
  const implementPositiveRunId = stateStore.createRun({
    project: "wf-project",
    specRef: "main",
    worktreePath: "/tmp/wf-project",
    branch: "wf-implement-2",
    specPath: "/tmp/spec.md",
    stepId: "implement",
    workflowSnapshot: implementPositiveSnapshot,
  });
  const planRunId = stateStore.createRun({
    project: "wf-project",
    specRef: "main",
    worktreePath: "/tmp/wf-project",
    branch: "wf-plan",
    specPath: "/tmp/spec.md",
    stepId: "step-1",
    workflowSnapshot: planSnapshot,
  });

  const runs = await listRunsDirect(handlers);
  const implementZeroRow = runs?.find((row) => row.runId === implementZeroRunId);
  const implementPositiveRow = runs?.find((row) => row.runId === implementPositiveRunId);
  const planRow = runs?.find((row) => row.runId === planRunId);

  expect(implementZeroRow?.reviewPasses).toBe(0);
  expect(implementZeroRow?.reviewBehavior).toBe("light");
  expect(implementPositiveRow?.reviewPasses).toBe(2);
  expect(implementPositiveRow?.reviewBehavior).toBe("debate");
  expect(planRow?.reviewPasses).toBeUndefined();
  expect(planRow?.reviewBehavior).toBeUndefined();
});

test("list projects a review behavior entry in authored order and tracks progress to terminal", async () => {
  const snapshot = workflowSnapshot("workflow-review-entry", [
    { stepId: "step-1", role: "plan" },
    { stepId: "review-1", role: "", behavior: "review" },
    { stepId: "step-3", role: "plan" },
  ]);
  const runId = stateStore.createRun({
    project: "wf-project",
    specRef: "main",
    worktreePath: "/tmp/wf-project",
    branch: "wf-review-entry",
    specPath: "/tmp/spec.md",
    stepId: "step-1",
    workflowSnapshot: snapshot,
  });

  let runs = await listRunsDirect(handlers);
  expect(runs?.find((row) => row.runId === runId)?.workflow).toEqual({
    steps: [
      { stepId: "step-1", role: "plan", status: "stopped", attemptCount: 0, terminalOutcome: "invocation_failure" },
      { stepId: "review-1", role: "", status: "pending", attemptCount: 0 },
      { stepId: "step-3", role: "plan", status: "pending", attemptCount: 0 },
    ],
  });

  handlers.reportReviewDebateProgress("workflow-review-entry", "review-1", { status: "in_progress", role: "critic" });
  runs = await listRunsDirect(handlers);
  expect(runs?.find((row) => row.runId === runId)?.workflow?.steps[1]).toEqual({
    stepId: "review-1",
    role: "critic",
    status: "in_progress",
    attemptCount: 0,
  });

  handlers.reportReviewDebateProgress("workflow-review-entry", "review-1", {
    status: "completed",
    role: "actuator",
    terminalOutcome: "complete",
  });
  runs = await listRunsDirect(handlers);
  expect(runs?.find((row) => row.runId === runId)?.workflow?.steps[1]).toEqual({
    stepId: "review-1",
    role: "actuator",
    status: "completed",
    attemptCount: 0,
    terminalOutcome: "complete",
  });
});

test("review-debate progress does not bleed across invocations sharing a stepId", async () => {
  const snapshotA = workflowSnapshot("workflow-debate-a", [
    { stepId: "step-1", role: "implement" },
    { stepId: "step-debate", role: "", behavior: "review-debate" },
  ]);
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

  const snapshotB = workflowSnapshot("workflow-debate-b", [
    { stepId: "step-1", role: "implement" },
    { stepId: "step-debate", role: "", behavior: "review-debate" },
  ]);
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

test("list retains durable plan debate rows across live, terminal, and restart projection", async () => {
  const snapshot = {
    ...workflowSnapshot("workflow-plan-debate", []),
    steps: [
      { stepId: "plan-draft", role: "plan", durable: true },
      { stepId: "authored-plan-review", role: "", behavior: "review-debate" as const, durable: true },
    ],
  };
  const draftRunId = stateStore.createRun({
    project: "plan-project",
    specRef: "main",
    worktreePath: "/tmp/plan-project",
    branch: "plan-debate",
    specPath: "/tmp/plan.md",
    stepId: "plan-draft",
    workflowSnapshot: snapshot,
  });
  const draftAttemptId = stateStore.recordAttemptStart(draftRunId);
  stateStore.commitCompletionBoundary({ attemptId: draftAttemptId, runStatus: "completed", outcomeKind: "done" });
  const debateRunId = stateStore.createRun({
    project: "plan-project",
    specRef: "main",
    worktreePath: "/tmp/plan-project",
    branch: "plan-debate",
    specPath: "/tmp/plan.md",
    stepId: "authored-plan-review",
    workflowSnapshot: snapshot,
  });
  const debateAttemptId = stateStore.recordAttemptStart(debateRunId);

  handlers.reportReviewDebateProgress("workflow-plan-debate", "authored-plan-review", {
    status: "in_progress",
    role: "adjudicator",
  });
  let rows = await listRunsDirect(handlers);
  const liveDebate = rows?.find((row) => row.runId === debateRunId);
  expect(rows?.map((row) => row.runId)).toEqual(expect.arrayContaining([draftRunId, debateRunId]));
  expect(liveDebate?.status).toBe("in-progress");
  expect(liveDebate?.workflow?.steps.find((step) => step.stepId === "authored-plan-review")).toEqual({
    stepId: "authored-plan-review",
    role: "adjudicator",
    status: "in_progress",
    attemptCount: 1,
  });

  stateStore.commitCompletionBoundary({ attemptId: debateAttemptId, runStatus: "completed", outcomeKind: "done" });
  rows = await listRunsDirect(handlers);
  expect(rows?.find((row) => row.runId === debateRunId)?.status).toBe("completed");

  stateStore.setRunStatus(debateRunId, "failed");
  expect((await listRunsDirect(handlers))?.find((row) => row.runId === debateRunId)?.status).toBe("failed");

  stateStore.setRunStatus(debateRunId, "interrupted");
  stateStore.close();
  stateStore = openStateStore(stateStorePath);
  handlers = createRunControlHandlers({
    stateStore,
    writeLoopExecutor: fakeExecutor.executor,
    failureReporter: () => {},
    hasMemoryHeadroom: () => true,
    settleDelayMs: 0,
  });
  const restartedDebate = (await listRunsDirect(handlers))?.find((row) => row.runId === debateRunId);
  expect(restartedDebate).toMatchObject({ status: "interrupted" });
  expect(restartedDebate?.workflow?.steps.find((step) => step.stepId === "authored-plan-review")).toEqual({
    stepId: "authored-plan-review",
    role: "",
    status: "stopped",
    attemptCount: 1,
    terminalOutcome: "interrupted",
  });
});

test("list projects an in-flight durable review step from its live progress, not as a stopped failure", async () => {
  const snapshot = {
    ...workflowSnapshot("workflow-intent-review", []),
    steps: [
      { stepId: "intent-split", role: "intent", durable: true },
      { stepId: "intent-review", role: "", behavior: "review" as const, durable: true },
    ],
  };
  const reviewRunId = stateStore.createRun({
    project: "intent-project",
    specRef: "main",
    worktreePath: "/tmp/intent-project",
    branch: "intent-review",
    specPath: "/tmp/intent.md",
    stepId: "intent-review",
    workflowSnapshot: snapshot,
  });
  stateStore.recordAttemptStart(reviewRunId);

  handlers.reportReviewDebateProgress("workflow-intent-review", "intent-review", {
    status: "in_progress",
    role: "critic",
  });

  // The run is in-progress but absent from liveRunIds; without the progress branch it falls
  // through to stoppedOutcomeForRun and renders "invocation_failure" while still running.
  const row = (await listRunsDirect(handlers))?.find((entry) => entry.runId === reviewRunId);
  expect(row?.status).toBe("in-progress");
  expect(row?.workflow?.steps.find((step) => step.stepId === "intent-review")).toEqual({
    stepId: "intent-review",
    role: "critic",
    status: "in_progress",
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
    reason: "unsupported_resume_context",
    retryable: false,
    nextAction: "stop",
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

test("kill preserves boundary-terminal status on an active run but still aborts", async () => {
  const runId = await startRunDirect(handlers);
  if (!runId) return;

  const attemptId = stateStore.recordAttemptStart(runId);
  stateStore.commitCompletionBoundary({ attemptId, runStatus: "blocked", outcomeKind: "blocked" });

  const killResponse = await killDirect(handlers, runId);
  expect(killResponse.kind).toBe("response");
  expect(fakeExecutor.isAbortSignalTriggered()).toBe(true);
  expect(loadRunOrThrow(stateStore, runId).status).toBe("blocked");

  const runs = await listRunsDirect(handlers);
  expect(runs?.find((row) => row.runId === runId)?.status).toBe("blocked");
});

test("kill still sets killed when the committed boundary is in-progress", async () => {
  const runId = await startRunDirect(handlers);
  if (!runId) return;

  const attemptId = stateStore.recordAttemptStart(runId);
  stateStore.commitCompletionBoundary({ attemptId, runStatus: "in-progress", outcomeKind: "progress" });

  const killResponse = await killDirect(handlers, runId);
  expect(killResponse.kind).toBe("response");
  expect(loadRunOrThrow(stateStore, runId).status).toBe("killed");
});

test("kill still sets killed on a paused run", async () => {
  const runId = await startRunDirect(handlers);
  if (!runId) return;

  const attemptId = stateStore.recordAttemptStart(runId);
  stateStore.commitCompletionBoundary({ attemptId, runStatus: "paused", outcomeKind: "invalid_token" });

  const killResponse = await killDirect(handlers, runId);
  expect(killResponse.kind).toBe("response");
  expect(loadRunOrThrow(stateStore, runId).status).toBe("killed");
});
