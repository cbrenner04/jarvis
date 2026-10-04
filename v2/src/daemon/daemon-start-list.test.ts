import { Database, type SQLQueryBindings } from "bun:sqlite";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStateStore, type StateStore } from "../persistence/state-store.ts";
import type { OperatorFailureRecord } from "../shared/operator-failure-record.ts";
import { StructuralTestLocatorError } from "../shared/structural-test-locator.ts";
import {
  createHeldWorkflowBindings,
  flushBackgroundRuns,
  type HeldWorkflowBindings,
  listRunsDirect,
  loadRunOrThrow,
  startRunDirect,
  workflowSnapshot,
  workflowWriteStep,
} from "../testing/run-control.ts";
import { createFakeWriteLoopExecutor, type FakeWriteLoopExecutor } from "../testing/write-loop-executor.ts";
import { createRunControlHandlers, runListTerminalFinishAtMs, settleKilledWorkflowOwnership } from "./daemon.ts";
import {
  expectDaemonPermittedInventoryMatches,
  indexOfReconciliationAdmissionSlice,
  listProductionDaemonSources,
  locateReconciliationAdmissionSlice,
  regexPinnedDaemonSettlementGuard,
  scanDaemonTerminalSettlement,
} from "./daemon-terminal-settlement-guard.ts";

type Handlers = ReturnType<typeof createRunControlHandlers>;

async function killDirect(h: Handlers, runId: string, force?: boolean) {
  return h.kill(
    { kind: "request", id: "k1", method: "kill", params: { runId, ...(force !== undefined ? { force } : {}) } },
    new AbortController().signal,
  );
}

async function waitDirect(h: Handlers, runId: string) {
  return h.wait({ kind: "request", id: "w1", method: "wait", params: { runId } }, new AbortController().signal);
}

let stateStore: StateStore;
let stateStorePath: string;
let fakeExecutor: FakeWriteLoopExecutor;
let held: HeldWorkflowBindings;
let memoryHeadroom: boolean;
let handlers: Handlers;

/** Polls until `predicate` holds or `timeoutMs` elapses; the caller's own assertion then reports the failure. */
async function waitFor(predicate: () => Promise<boolean> | boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate()) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 5));
}

async function isLive(h: Handlers, runId: string | undefined): Promise<boolean> {
  return (await listRunsDirect(h))?.find((row) => row.runId === runId)?.isLive === true;
}

/** Write step whose binding stays live until `held` settles or aborts it. */
function heldStep(overrides: Parameters<typeof workflowWriteStep>[0] = {}) {
  return workflowWriteStep({ createBinding: held.createBinding, ...overrides });
}

const OPERATOR_FAILURE_RECORD: OperatorFailureRecord = {
  expectation: "ready gate passes",
  observation: "ready gate exited 1",
  nearMiss: "typecheck passed",
  retryable: true,
  referencedPaths: [
    { path: "v2/src/daemon/daemon.ts", origin: "harness-internal" },
    { path: "spec.md", origin: "operator-repository" },
  ],
};

beforeEach(() => {
  stateStorePath = join(tmpdir(), `jarvis-state-${process.pid}-${Date.now()}.db`);
  stateStore = openStateStore(stateStorePath);
  fakeExecutor = createFakeWriteLoopExecutor();
  held = createHeldWorkflowBindings();
  memoryHeadroom = true;

  handlers = createRunControlHandlers({
    stateStore,
    logReader: { tail: () => [], async *follow() {} },
    writeLoopExecutor: fakeExecutor.executor,
    failureReporter: () => {},
    hasMemoryHeadroom: () => memoryHeadroom,
    settleDelayMs: 0,
  });
});

afterEach(async () => {
  fakeExecutor.abortAll();
  held.abortAll();
  await flushBackgroundRuns(3);
  try {
    stateStore.close();
  } catch {
    // store may be closed
  }
});

test("start admits a second (project, branch) while another run is active", async () => {
  await startRunDirect(handlers, heldStep());

  const second = await startRunDirect(handlers, heldStep({ worktree: { projectName: "other-project" } }));
  expect(typeof second).toBe("string");
});

test("start rejects second start for same (project, branch) while first is active", async () => {
  await startRunDirect(handlers, heldStep());

  const response2 = await handlers.start(
    { kind: "request", id: "s2", method: "start", params: { steps: [heldStep()] } },
    new AbortController().signal,
  );
  expect(response2.kind).toBe("error");
  if (response2.kind === "error") {
    expect(response2.code).toBe("worktree_claimed");
  }
});

test("settled run is no longer live in list", async () => {
  const runId = await startRunDirect(handlers, heldStep());

  held.settleAll();
  await waitFor(async () => !(await isLive(handlers, runId)));

  const runs = await listRunsDirect(handlers);
  const run = runs?.find((candidate) => candidate.runId === runId);
  expect(run?.isLive).toBe(false);
  expect(run?.status).toBe("completed");
});

test("list returns only stored operator failure records without loading terminal logs", async () => {
  const recordedRunId = stateStore.createRun({
    project: "test-project",
    specRef: "main",
    worktreePath: "/tmp/test-project",
    branch: `recorded-${crypto.randomUUID()}`,
    specPath: "/tmp/test-project/spec.md",
  });
  stateStore.commitTerminalRunSettlement({
    runId: recordedRunId,
    status: "failed",
    terminalCause: "ready_gate_failed",
    operatorFailureRecord: OPERATOR_FAILURE_RECORD,
  });
  const absentRunId = stateStore.createRun({
    project: "test-project",
    specRef: "main",
    worktreePath: "/tmp/test-project",
    branch: `absent-${crypto.randomUUID()}`,
    specPath: "/tmp/test-project/spec.md",
  });
  stateStore.commitTerminalRunSettlement({ runId: absentRunId, status: "failed", terminalCause: "ready_gate_failed" });
  const storeOnlyHandlers = createRunControlHandlers({
    stateStore,
    writeLoopExecutor: fakeExecutor.executor,
    failureReporter: () => {},
    hasMemoryHeadroom: () => true,
    settleDelayMs: 0,
  });

  const rows = await listRunsDirect(storeOnlyHandlers);
  storeOnlyHandlers.close();

  expect(rows?.find((row) => row.runId === recordedRunId)?.failure).toEqual(OPERATOR_FAILURE_RECORD);
  expect(rows?.find((row) => row.runId === absentRunId)).not.toHaveProperty("failure");
});

test("two admitted runs progress concurrently, settling independently", async () => {
  const runId1 = await startRunDirect(
    handlers,
    heldStep({ worktree: { projectName: "project-one", branchName: "branch-one" } }),
  );
  const runId2 = await startRunDirect(
    handlers,
    heldStep({ worktree: { projectName: "project-two", branchName: "branch-two" } }),
  );
  await flushBackgroundRuns();

  expect(held.pendingCount()).toBe(2);

  const runsBothLive = await listRunsDirect(handlers);
  expect(runsBothLive?.find((run) => run.runId === runId1)?.isLive).toBe(true);
  expect(runsBothLive?.find((run) => run.runId === runId2)?.isLive).toBe(true);

  held.settleFirst();
  await waitFor(async () => !(await isLive(handlers, runId1)));

  expect(held.pendingCount()).toBe(1);
  const runsAfterFirstSettles = await listRunsDirect(handlers);
  expect(runsAfterFirstSettles?.find((run) => run.runId === runId1)?.isLive).toBe(false);
  expect(runsAfterFirstSettles?.find((run) => run.runId === runId2)?.isLive).toBe(true);
});

test("list returns workflow step snapshots for live, stopped, and completed workflow-backed runs", async () => {
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

  const liveRunId = stateStore.createRun({
    project: "wf-project",
    specRef: "main",
    worktreePath: "/tmp/wf-project",
    branch: "wf-live",
    specPath: "/tmp/spec.md",
    stepId: "step-2",
    workflowSnapshot: snapshot,
  });
  const liveAttemptId = stateStore.recordAttemptStart(liveRunId);
  handlers.context.activeRuns.set(liveRunId, {
    kind: "workflow",
    runId: liveRunId,
    abortController: new AbortController(),
  });

  let runs = await listRunsDirect(handlers);
  const liveRow = runs?.find((row) => row.runId === liveRunId);
  expect(liveRow?.workflow).toEqual({
    invocationId: snapshot.invocationId,
    steps: [
      { stepId: "step-1", role: "implement", status: "completed", attemptCount: 2, terminalOutcome: "complete" },
      { stepId: "step-2", role: "review", status: "in_progress", attemptCount: 1 },
      { stepId: "step-3", role: "verify", status: "pending", attemptCount: 0 },
    ],
  });

  handlers.context.activeRuns.delete(liveRunId);
  stateStore.commitCompletionBoundary({
    attemptId: liveAttemptId,
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
    invocationId: snapshot.invocationId,
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
    invocationId: completeSnapshot.invocationId,
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
    invocationId: snapshot.invocationId,
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
    attemptCount: 1,
  });
  runs = await listRunsDirect(handlers);
  const terminalReview = runs?.find((row) => row.runId === runId)?.workflow?.steps[1];
  expect(terminalReview).toMatchObject({
    stepId: "review-1",
    role: "actuator",
    status: "completed",
    terminalOutcome: "complete",
  });
  expect(terminalReview?.attemptCount).toBeGreaterThanOrEqual(1);
});

test("list retains frozen review snapshot when completed entry rollup survives live-map cleanup", async () => {
  const snapshot = workflowSnapshot("workflow-completed-freeze", [
    { stepId: "step-1", role: "plan", durable: false },
    { stepId: "review-1", role: "", behavior: "review", durable: false },
    { stepId: "step-3", role: "plan", durable: false },
  ]);
  const runId = stateStore.createRun({
    project: "wf-completed-freeze",
    specRef: "main",
    worktreePath: "/tmp/wf-completed-freeze",
    branch: "wf-completed-freeze",
    specPath: "/tmp/spec.md",
    stepId: "step-1",
    workflowSnapshot: snapshot,
  });
  stateStore.setRunStatus(runId, "completed");

  handlers.reportReviewDebateProgress("workflow-completed-freeze", "review-1", {
    status: "in_progress",
    role: "critic",
  });
  handlers.reportReviewDebateProgress("workflow-completed-freeze", "review-1", {
    status: "completed",
    role: "actuator",
    terminalOutcome: "complete",
    attemptCount: 1,
  });
  handlers.clearLiveReviewDebateProgress("workflow-completed-freeze");

  const row = (await listRunsDirect(handlers))?.find((entry) => entry.runId === runId);
  expect(row?.status).toBe("completed");
  expect(row?.workflow?.steps.every((step) => step.status !== "pending")).toBe(true);
  const reviewStep = row?.workflow?.steps.find((step) => step.stepId === "review-1");
  expect(reviewStep).toMatchObject({
    role: "actuator",
    status: "completed",
    terminalOutcome: "complete",
  });
  expect(reviewStep?.attemptCount).toBeGreaterThanOrEqual(1);
});

test("list retains frozen review snapshot when early-stop entry rollup survives live-map cleanup", async () => {
  const snapshot = workflowSnapshot("workflow-early-stop-freeze", [
    { stepId: "step-1", role: "implement" },
    { stepId: "review-1", role: "", behavior: "review", durable: false },
    { stepId: "step-3", role: "verify" },
  ]);
  const entryRunId = stateStore.createRun({
    project: "wf-early-stop-freeze",
    specRef: "main",
    worktreePath: "/tmp/wf-early-stop-freeze",
    branch: "wf-early-stop-freeze",
    specPath: "/tmp/spec.md",
    stepId: "step-1",
    workflowSnapshot: snapshot,
  });
  const step1AttemptId = stateStore.recordAttemptStart(entryRunId);
  stateStore.commitCompletionBoundary({ attemptId: step1AttemptId, runStatus: "completed", outcomeKind: "done" });

  handlers.reportReviewDebateProgress("workflow-early-stop-freeze", "review-1", {
    status: "in_progress",
    role: "critic",
  });
  handlers.reportReviewDebateProgress("workflow-early-stop-freeze", "review-1", {
    status: "stopped",
    role: "critic",
    terminalOutcome: "invocation_failure",
    attemptCount: 1,
  });
  handlers.clearLiveReviewDebateProgress("workflow-early-stop-freeze");
  stateStore.setRunStatus(entryRunId, "killed");

  const row = (await listRunsDirect(handlers))?.find((entry) => entry.runId === entryRunId);
  expect(row?.status).toBe("killed");
  const reviewStep = row?.workflow?.steps.find((step) => step.stepId === "review-1");
  expect(reviewStep).toMatchObject({
    role: "critic",
    status: "stopped",
    terminalOutcome: "invocation_failure",
  });
  expect(reviewStep?.attemptCount).toBeGreaterThanOrEqual(1);
  expect(reviewStep?.status).not.toBe("pending");
  expect(row?.workflow?.steps.find((step) => step.stepId === "step-3")?.status).toBe("pending");
});

test("terminal review progress floors attemptCount at one while in_progress is stored unchanged", async () => {
  const snapshot = workflowSnapshot("workflow-review-attempt-floor", [
    { stepId: "step-1", role: "plan" },
    { stepId: "review-1", role: "", behavior: "review", durable: false },
  ]);
  const runId = stateStore.createRun({
    project: "wf-review-attempt-floor",
    specRef: "main",
    worktreePath: "/tmp/wf-review-attempt-floor",
    branch: "wf-review-attempt-floor",
    specPath: "/tmp/spec.md",
    stepId: "step-1",
    workflowSnapshot: snapshot,
  });

  handlers.reportReviewDebateProgress("workflow-review-attempt-floor", "review-1", {
    status: "in_progress",
    role: "critic",
  });
  let runs = await listRunsDirect(handlers);
  expect(runs?.find((row) => row.runId === runId)?.workflow?.steps[1]?.attemptCount).toBe(0);

  handlers.reportReviewDebateProgress("workflow-review-attempt-floor", "review-1", {
    status: "completed",
    role: "actuator",
    terminalOutcome: "complete",
    attemptCount: 0,
  });
  runs = await listRunsDirect(handlers);
  expect(runs?.find((row) => row.runId === runId)?.workflow?.steps[1]?.attemptCount).toBe(1);
});

test("list uses entry rollup not sibling status for completed-guard on step rows", async () => {
  const snapshot = workflowSnapshot("workflow-sibling-guard", [
    { stepId: "step-1", role: "implement" },
    { stepId: "step-2", role: "review" },
    { stepId: "step-3", role: "verify" },
  ]);
  const entryRunId = stateStore.createRun({
    project: "wf-sibling-guard",
    specRef: "main",
    worktreePath: "/tmp/wf-sibling-guard",
    branch: "wf-sibling-guard",
    specPath: "/tmp/spec.md",
    stepId: "step-1",
    workflowSnapshot: snapshot,
  });
  const step1AttemptId = stateStore.recordAttemptStart(entryRunId);
  stateStore.commitCompletionBoundary({ attemptId: step1AttemptId, runStatus: "completed", outcomeKind: "done" });

  const step2RunId = stateStore.createRun({
    project: "wf-sibling-guard",
    specRef: "main",
    worktreePath: "/tmp/wf-sibling-guard",
    branch: "wf-sibling-guard",
    specPath: "/tmp/spec.md",
    stepId: "step-2",
    workflowSnapshot: snapshot,
  });
  const step2AttemptId = stateStore.recordAttemptStart(step2RunId);
  stateStore.commitCompletionBoundary({ attemptId: step2AttemptId, runStatus: "completed", outcomeKind: "done" });

  stateStore.setRunStatus(entryRunId, "killed");

  const runs = await listRunsDirect(handlers);
  const step2Row = runs?.find((row) => row.runId === step2RunId);
  expect(step2Row?.status).toBe("completed");
  expect(step2Row?.workflow?.steps.find((step) => step.stepId === "step-3")?.status).toBe("pending");
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

const RECONCILED_AT = 1_700_000_100_000;
const STALE_COMPLETED_AT = 1_700_000_000_000;
const SEEDED_CREATED_AT = 1_700_000_050_000;

function seedRun(overrides: Partial<Parameters<StateStore["createRun"]>[0]> = {}): string {
  return stateStore.createRun({
    project: "test-project",
    specRef: "main",
    worktreePath: "/tmp/worktree",
    branch: `branch-${crypto.randomUUID()}`,
    specPath: "spec.md",
    status: "in-progress",
    ...overrides,
  });
}

function seedTerminalRun(overrides: Partial<Parameters<StateStore["createRun"]>[0]> = {}): string {
  return seedRun({ status: "killed", ...overrides });
}

function patchStore(sql: string, ...params: SQLQueryBindings[]): void {
  const raw = new Database(stateStorePath);
  try {
    raw.prepare(sql).run(...params);
  } finally {
    raw.close();
  }
}

function setRunReconciledAt(runId: string, reconciledAt: number): void {
  patchStore("UPDATE runs SET reconciled_at = ? WHERE id = ?", reconciledAt, runId);
}

function setAttemptCompletedAt(attemptId: string, completedAt: number): void {
  patchStore("UPDATE attempts SET completed_at = ? WHERE id = ?", completedAt, attemptId);
}

function setRunCreatedAt(runId: string, createdAt: number): void {
  patchStore("UPDATE runs SET created_at = ? WHERE id = ?", createdAt, runId);
}

test("list projects durable createdAt on every run row", async () => {
  const runId = seedTerminalRun();
  setRunCreatedAt(runId, SEEDED_CREATED_AT);

  const runs = await listRunsDirect(handlers);
  const row = runs?.find((candidate) => candidate.runId === runId);
  // Mutation checkpoint: omitting createdAt from buildRunListRow must turn this test RED.
  expect(row?.createdAt).toBe(SEEDED_CREATED_AT);
  expect(loadRunOrThrow(stateStore, runId).createdAt).toBe(SEEDED_CREATED_AT);
});

test("list sets finishedAtMs from reconciledAt when terminal row has no attempt completed_at", async () => {
  const runId = seedTerminalRun();
  setRunReconciledAt(runId, RECONCILED_AT);

  const runs = await listRunsDirect(handlers);
  const row = runs?.find((candidate) => candidate.runId === runId);
  expect(row?.finishedAtMs).toBe(RECONCILED_AT);
  expect(loadRunOrThrow(stateStore, runId).reconciledAt).toBe(RECONCILED_AT);
});

test("a failed run with no completion boundary still reports finishedAtMs", async () => {
  const runId = seedRun();
  stateStore.setRunStatus(runId, "failed");

  const loaded = loadRunOrThrow(stateStore, runId);
  const row = (await listRunsDirect(handlers))?.find((candidate) => candidate.runId === runId);
  expect(loaded.attempts).toEqual([]);
  expect(loaded.reconciledAt).toBeNull();
  expect(loaded.finishedAt).toBeNumber();
  expect(row?.finishedAtMs).toBe(loaded.finishedAt ?? undefined);
});

test("every current terminal run transition reports finishedAtMs and non-terminal status omits it", async () => {
  const completedRunId = seedRun();
  const completedAttemptId = stateStore.recordAttemptStart(completedRunId);
  stateStore.commitCompletionBoundary({ attemptId: completedAttemptId, runStatus: "completed", outcomeKind: "done" });

  const failedRunId = seedRun();
  stateStore.setRunStatus(failedRunId, "failed");

  const blockedRunId = seedRun();
  const blockedAttemptId = stateStore.recordAttemptStart(blockedRunId);
  stateStore.commitCompletionBoundary({ attemptId: blockedAttemptId, runStatus: "blocked", outcomeKind: "blocked" });

  const killedRunId = seedRun();
  stateStore.commitGuardedKill(killedRunId);

  const interruptedRunId = seedRun();
  stateStore.setRunStatus(interruptedRunId, "interrupted");

  const nonTerminalRunId = seedRun();
  const nonTerminalAttemptId = stateStore.recordAttemptStart(nonTerminalRunId);
  stateStore.commitCompletionBoundary({
    attemptId: nonTerminalAttemptId,
    runStatus: "in-progress",
    outcomeKind: "progress",
  });

  const rows = await listRunsDirect(handlers);
  for (const [runId, status] of [
    [completedRunId, "completed"],
    [failedRunId, "failed"],
    [blockedRunId, "blocked"],
    [killedRunId, "killed"],
    [interruptedRunId, "interrupted"],
  ] as const) {
    const row = rows?.find((candidate) => candidate.runId === runId);
    expect(row?.status).toBe(status);
    expect(row?.finishedAtMs).toBeNumber();
  }
  const nonTerminalRow = rows?.find((candidate) => candidate.runId === nonTerminalRunId);
  expect(nonTerminalRow?.status).toBe("in-progress");
  expect(nonTerminalRow?.finishedAtMs).toBeUndefined();
});

test("runListTerminalFinishAtMs selects the latest durable finish source", () => {
  expect(runListTerminalFinishAtMs([{ completedAt: 200 }], 100, 300)).toBe(300);
  expect(runListTerminalFinishAtMs([{ completedAt: 300 }], 100, 200)).toBe(300);
  expect(runListTerminalFinishAtMs([{ completedAt: 100 }], 300, 200)).toBe(300);
});

test("reconciledAt-only finish-time maximum guard inversion", () => {
  const attemptOnlyMax = (
    attempts: Array<{ completedAt: number | null }>,
    _reconciledAt: number | null | undefined,
  ): number | undefined => {
    let finishedAtMs: number | undefined;
    for (const attempt of attempts) {
      if (attempt.completedAt === null) continue;
      if (finishedAtMs === undefined || attempt.completedAt > finishedAtMs) {
        finishedAtMs = attempt.completedAt;
      }
    }
    return finishedAtMs;
  };

  expect(attemptOnlyMax([], RECONCILED_AT)).toBeUndefined();
  expect(runListTerminalFinishAtMs([], RECONCILED_AT, undefined)).toBe(RECONCILED_AT);
});

test("list sets finishedAtMs to later reconciledAt when attempt completed_at is stale", async () => {
  const runId = seedTerminalRun();
  const attemptId = stateStore.recordAttemptStart(runId);
  setAttemptCompletedAt(attemptId, STALE_COMPLETED_AT);
  setRunReconciledAt(runId, RECONCILED_AT);

  const runs = await listRunsDirect(handlers);
  const row = runs?.find((candidate) => candidate.runId === runId);
  expect(row?.finishedAtMs).toBe(RECONCILED_AT);
  expect(loadRunOrThrow(stateStore, runId).reconciledAt).toBe(RECONCILED_AT);
});

test("list includes error on terminal rows and omits it on in-progress and completed", async () => {
  const runId = await startRunDirect(handlers, heldStep());
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

  held.settleAll();
  await flushBackgroundRuns();
  stateStore.setRunStatus(runId, "completed");

  runs = await listRunsDirect(handlers);
  const completed = runs?.find((candidate) => candidate.runId === runId);
  expect(completed?.error).toBeUndefined();
});

test("kill aborts an active run and records killed status", async () => {
  const runId = await startRunDirect(handlers, heldStep());
  if (!runId) return;

  const killResponse = await killDirect(handlers, runId);
  expect(killResponse.kind).toBe("response");
  if (killResponse.kind === "response") {
    expect((killResponse.result as { ok?: boolean } | undefined)?.ok).toBe(true);
  }
  expect(held.isAbortSignalTriggered()).toBe(true);

  const runs = await listRunsDirect(handlers);
  const run = runs?.find((candidate) => candidate.runId === runId);
  expect(run).toBeDefined();
  expect(run?.status).toBe("killed");
});

test("active deferred and forced kill use terminal settlement after admission", async () => {
  const settlementCalls: Array<{ runId: string; status: string }> = [];
  const commitTerminalRunSettlement = stateStore.commitTerminalRunSettlement.bind(stateStore);
  stateStore.commitTerminalRunSettlement = (args) => {
    settlementCalls.push({ runId: args.runId, status: args.status });
    return commitTerminalRunSettlement(args);
  };
  stateStore.commitGuardedKill = () => {
    throw new Error("legacy guarded kill called");
  };

  const activeRunId = await startRunDirect(handlers, heldStep());
  if (!activeRunId) return;
  const forcedRunId = seedRun({ status: "paused" });
  const deferredRunId = seedRun();

  await expect(killDirect(handlers, activeRunId)).resolves.toMatchObject({ kind: "response" });
  await expect(killDirect(handlers, forcedRunId, true)).resolves.toMatchObject({ kind: "response" });
  let released = false;
  settleKilledWorkflowOwnership({
    killedRunIds: [deferredRunId],
    stateStore,
    releaseRegistry: () => {
      released = true;
    },
  });

  expect(released).toBe(true);
  expect(settlementCalls).toEqual([
    { runId: activeRunId, status: "killed" },
    { runId: forcedRunId, status: "killed" },
    { runId: deferredRunId, status: "killed" },
  ]);
  const rows = await listRunsDirect(handlers);
  for (const runId of [activeRunId, forcedRunId, deferredRunId]) {
    const run = loadRunOrThrow(stateStore, runId);
    expect(run).toMatchObject({ status: "killed", terminalCause: null, terminalFailureDetail: null });
    expect(run.finishedAt).toBeNumber();
    expect(rows?.find((row) => row.runId === runId)).toMatchObject({ status: "killed", finishedAtMs: run.finishedAt });
    const waited = await waitDirect(handlers, runId);
    expect(waited).toMatchObject({ kind: "response", result: { runStatus: "killed" } });
  }
});

test("daemon production terminal writers are restricted to atomic settlement", () => {
  const sources = listProductionDaemonSources();
  const result = scanDaemonTerminalSettlement(sources);
  expect(result.violations).toEqual([]);
  expectDaemonPermittedInventoryMatches(result);

  const stateStoreSource = readFileSync(join(import.meta.dir, "../persistence/state-store.ts"), "utf8");
  expect(locateReconciliationAdmissionSlice(stateStoreSource)).not.toContain("UPDATE runs SET status");

  const concatenated = Object.values(sources).join("\n");
  const regexPinnedSlice = indexOfReconciliationAdmissionSlice(stateStoreSource);
  expect(regexPinnedDaemonSettlementGuard(concatenated, regexPinnedSlice)).toBe(true);

  const reformattedPause = (sources["daemon-workflow-admission-handlers.ts"] ?? "").replace(
    'store.setRunStatus(runId, "paused")',
    'store.setRunStatus(\n        runId,\n        "paused",\n      )',
  );
  const reformattedSources = { ...sources, "daemon-workflow-admission-handlers.ts": reformattedPause };
  const reformattedConcatenated = Object.values(reformattedSources).join("\n");
  expect(regexPinnedDaemonSettlementGuard(reformattedConcatenated, regexPinnedSlice)).toBe(false);
  const reformattedResult = scanDaemonTerminalSettlement(reformattedSources);
  expect(reformattedResult.violations).toEqual([]);
  expectDaemonPermittedInventoryMatches(reformattedResult);

  const noBeginSource = stateStoreSource.replace("async beginRunReconciliation", "async orphanRunReconciliation");
  expect(indexOfReconciliationAdmissionSlice(noBeginSource)).toBe("");
  expect(() => locateReconciliationAdmissionSlice(noBeginSource)).toThrow(StructuralTestLocatorError);
});

test("kill rejects unknown run ID", async () => {
  const killResponse = await killDirect(handlers, "unknown-id");
  expect(killResponse.kind).toBe("error");
  if (killResponse.kind === "error") {
    expect(killResponse.code).toBe("unknown_run");
  }
});

test("kill preserves boundary-terminal status on an active run but still aborts", async () => {
  const runId = await startRunDirect(handlers, heldStep());
  if (!runId) return;

  const attemptId = stateStore.recordAttemptStart(runId);
  stateStore.commitCompletionBoundary({ attemptId, runStatus: "blocked", outcomeKind: "blocked" });

  const killResponse = await killDirect(handlers, runId);
  expect(killResponse.kind).toBe("response");
  expect(held.isAbortSignalTriggered()).toBe(true);
  await waitFor(() => !handlers.hasActiveRuns());
  expect(loadRunOrThrow(stateStore, runId).status).toBe("blocked");

  const runs = await listRunsDirect(handlers);
  expect(runs?.find((row) => row.runId === runId)?.status).toBe("blocked");
});

test("kill still sets killed when the committed boundary is in-progress", async () => {
  const runId = await startRunDirect(handlers, heldStep());
  if (!runId) return;

  const attemptId = stateStore.recordAttemptStart(runId);
  stateStore.commitCompletionBoundary({ attemptId, runStatus: "in-progress", outcomeKind: "progress" });

  const killResponse = await killDirect(handlers, runId);
  expect(killResponse.kind).toBe("response");
  expect(loadRunOrThrow(stateStore, runId).status).toBe("killed");
});

test("kill still sets killed on a paused run", async () => {
  const runId = await startRunDirect(handlers, heldStep());
  if (!runId) return;

  const attemptId = stateStore.recordAttemptStart(runId);
  stateStore.commitCompletionBoundary({ attemptId, runStatus: "paused", outcomeKind: "invalid_token" });

  const killResponse = await killDirect(handlers, runId);
  expect(killResponse.kind).toBe("response");
  expect(loadRunOrThrow(stateStore, runId).status).toBe("killed");
});

test("kill with force settles a non-active paused run", async () => {
  const runId = seedRun({ status: "paused" });

  const killResponse = await killDirect(handlers, runId, true);
  expect(killResponse.kind).toBe("response");
  if (killResponse.kind === "response") {
    expect((killResponse.result as { ok?: boolean } | undefined)?.ok).toBe(true);
  }

  const run = loadRunOrThrow(stateStore, runId);
  expect(run.status).toBe("killed");
  expect(run.finishedAt).not.toBeNull();
});

test("kill without force still rejects a non-active paused run", async () => {
  const runId = seedRun({ status: "paused" });

  const killResponse = await killDirect(handlers, runId);
  expect(killResponse.kind).toBe("error");
  if (killResponse.kind === "error") {
    expect(killResponse.code).toBe("run_not_active");
  }

  const run = loadRunOrThrow(stateStore, runId);
  expect(run.status).toBe("paused");
  expect(run.finishedAt).toBeFalsy();
});

test("kill with force on an active run still takes the abort path", async () => {
  const runId = await startRunDirect(handlers, heldStep());
  if (!runId) return;

  const killResponse = await killDirect(handlers, runId, true);
  expect(killResponse.kind).toBe("response");
  expect(held.isAbortSignalTriggered()).toBe(true);
  expect(loadRunOrThrow(stateStore, runId).status).toBe("killed");
});

test("kill with force leaves terminal rows unchanged", async () => {
  for (const status of ["completed", "blocked", "failed"] as const) {
    const runId = seedRun({ status: "in-progress" });
    stateStore.setRunStatus(runId, status);
    const finishedAtBefore = loadRunOrThrow(stateStore, runId).finishedAt;

    const killResponse = await killDirect(handlers, runId, true);
    expect(killResponse.kind).toBe("error");
    if (killResponse.kind === "error") {
      expect(killResponse.code).toBe("run_not_active");
    }

    const run = loadRunOrThrow(stateStore, runId);
    expect(run.status).toBe(status);
    expect(run.finishedAt).toBe(finishedAtBefore);
  }

  const killedRunId = seedRun({ status: "in-progress" });
  stateStore.commitGuardedKill(killedRunId);
  const finishedAtBefore = loadRunOrThrow(stateStore, killedRunId).finishedAt;
  await new Promise((resolve) => setTimeout(resolve, 5));

  const killResponse = await killDirect(handlers, killedRunId, true);
  expect(killResponse.kind).toBe("error");
  if (killResponse.kind === "error") {
    expect(killResponse.code).toBe("run_not_active");
  }

  const killedRun = loadRunOrThrow(stateStore, killedRunId);
  expect(killedRun.status).toBe("killed");
  expect(killedRun.finishedAt).toBe(finishedAtBefore);
});

test("kill with force settles a row owned by a dead foreign process", async () => {
  const foreignIdentity = "77777:1000000";
  const seedStore = openStateStore(stateStorePath, { currentIdentity: foreignIdentity });
  const runId = seedStore.createRun({
    project: "test-project",
    specRef: "main",
    worktreePath: "/tmp/worktree",
    branch: `branch-${crypto.randomUUID()}`,
    specPath: "spec.md",
    status: "paused",
  });
  seedStore.close();

  const localStore = openStateStore(stateStorePath, { isOwnerAlive: async () => false });
  const localHandlers = createRunControlHandlers({
    stateStore: localStore,
    writeLoopExecutor: fakeExecutor.executor,
    failureReporter: () => {},
    hasMemoryHeadroom: () => memoryHeadroom,
    settleDelayMs: 0,
  });

  const killResponse = await killDirect(localHandlers, runId, true);
  expect(killResponse.kind).toBe("response");
  const run = loadRunOrThrow(localStore, runId);
  expect(run.status).toBe("killed");
  expect(run.finishedAt).not.toBeNull();
  localStore.close();
});

test("kill with force refuses a row owned by a live foreign process", async () => {
  const foreignIdentity = "88888:1000000";
  const seedStore = openStateStore(stateStorePath, { currentIdentity: foreignIdentity });
  const runId = seedStore.createRun({
    project: "test-project",
    specRef: "main",
    worktreePath: "/tmp/worktree",
    branch: `branch-${crypto.randomUUID()}`,
    specPath: "spec.md",
    status: "paused",
  });
  seedStore.close();

  const localStore = openStateStore(stateStorePath, { isOwnerAlive: async () => true });
  const localHandlers = createRunControlHandlers({
    stateStore: localStore,
    writeLoopExecutor: fakeExecutor.executor,
    failureReporter: () => {},
    hasMemoryHeadroom: () => memoryHeadroom,
    settleDelayMs: 0,
  });

  const killResponse = await killDirect(localHandlers, runId, true);
  expect(killResponse.kind).toBe("error");
  if (killResponse.kind === "error") {
    expect(killResponse.code).toBe("run_not_active");
  }

  const run = loadRunOrThrow(localStore, runId);
  expect(run.status).toBe("paused");
  expect(run.finishedAt).toBeFalsy();
  localStore.close();
});
