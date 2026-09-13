import { Database } from "bun:sqlite";
import { afterEach, beforeEach, expect, setSystemTime, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStateStore, type StateStore } from "../persistence/state-store.ts";
import { removeOrchestrationStore } from "../persistence/state-store-on-disk.ts";
import { deriveOperatorIncidents, serializeOperatorIncident } from "./operator-incidents.ts";

const dbPath = join(tmpdir(), `jarvis-operator-incidents-${process.pid}.sqlite`);

let store: StateStore;

function patchRunRow(runId: string, patch: { createdAt?: number; finishedAt?: number | null; status?: string }): void {
  const raw = new Database(dbPath);
  try {
    if (patch.createdAt !== undefined) {
      raw.prepare("UPDATE runs SET created_at = ? WHERE id = ?").run(patch.createdAt, runId);
    }
    if (patch.finishedAt !== undefined) {
      raw.prepare("UPDATE runs SET finished_at = ? WHERE id = ?").run(patch.finishedAt, runId);
    }
    if (patch.status !== undefined) {
      raw.prepare("UPDATE runs SET status = ? WHERE id = ?").run(patch.status, runId);
    }
  } finally {
    raw.close();
  }
}

function seedWorkflowStageEntryRun(project: string, invocationId: string, stepId: string): string {
  const runId = store.createRun({
    project,
    specRef: "HEAD",
    worktreePath: "/tmp/worktree",
    branch: `branch-${invocationId}`,
    specPath: "spec.md",
    stepId,
    workflowSnapshot: { invocationId, steps: [{ stepId, role: "plan" }] },
  });
  const attempt = store.recordAttemptStart(runId);
  store.commitCompletionBoundary({ attemptId: attempt, runStatus: "completed", outcomeKind: "done" });
  return runId;
}

function seedActionableDerivationFixtures(): { awaitingPipelineId: string } {
  const awaitingPipelineId = store.createPipeline({
    definition: { name: "gate-only", stages: [{ stageId: "gate", kind: "approval" }] },
  });
  store.updateStage({ pipelineId: awaitingPipelineId, stageId: "gate", patch: { status: "awaiting" } });
  return { awaitingPipelineId };
}

beforeEach(() => {
  removeOrchestrationStore(dbPath);
  store = openStateStore(dbPath);
});

afterEach(() => {
  setSystemTime();
  store.close();
  removeOrchestrationStore(dbPath);
});

test("deriveOperatorIncidents emits project for run-derived incidents", () => {
  const blockedRunId = store.createRun({
    project: "demo",
    specRef: "main",
    worktreePath: "/tmp/worktree",
    branch: "feature",
    specPath: "spec.md",
  });
  patchRunRow(blockedRunId, { status: "blocked", finishedAt: 10_000, createdAt: 10_000 });

  const incidents = deriveOperatorIncidents(store, 50_000);
  expect(incidents).toEqual([
    expect.objectContaining({
      kind: "run-blocked",
      runId: blockedRunId,
      project: "demo",
    }),
  ]);
  const incident = incidents[0];
  if (incident === undefined) throw new Error("expected blocked incident");
  expect(JSON.parse(serializeOperatorIncident(incident))).toMatchObject({ project: "demo" });
});

test("pipeline and stage incidents emit project from entry runs and null when unowned", () => {
  const ownedEntryRunId = seedWorkflowStageEntryRun("owned-project", "inv-owned", "plan");
  const ownedPipelineId = store.createPipeline({
    definition: {
      name: "workflow-owned",
      stages: [{ stageId: "plan", kind: "workflow", workflow: "plan", review: "none" }],
    },
  });
  store.updateStage({
    pipelineId: ownedPipelineId,
    stageId: "plan",
    patch: { status: "failed", workflowInvocationId: ownedEntryRunId, failureDetail: { message: "failed" } },
  });

  const ownedIncidents = deriveOperatorIncidents(store);
  expect(ownedIncidents).toEqual([
    expect.objectContaining({
      kind: "pipeline-terminal",
      pipelineId: ownedPipelineId,
      project: "owned-project",
    }),
  ]);
  const ownedIncident = ownedIncidents[0];
  if (ownedIncident === undefined) throw new Error("expected owned pipeline incident");
  expect(JSON.parse(serializeOperatorIncident(ownedIncident))).toMatchObject({ project: "owned-project" });

  removeOrchestrationStore(dbPath);
  store.close();
  store = openStateStore(dbPath);

  removeOrchestrationStore(dbPath);
  store.close();
  store = openStateStore(dbPath);

  const unownedPipelineId = store.createPipeline({
    definition: {
      name: "workflow-unowned",
      stages: [{ stageId: "plan", kind: "workflow", workflow: "plan", review: "none" }],
    },
  });
  store.updateStage({
    pipelineId: unownedPipelineId,
    stageId: "plan",
    patch: { status: "failed", workflowInvocationId: null, failureDetail: { message: "failed" } },
  });

  const unownedIncidents = deriveOperatorIncidents(store);
  expect(unownedIncidents).toEqual([
    expect.objectContaining({
      kind: "pipeline-terminal",
      pipelineId: unownedPipelineId,
      project: null,
    }),
  ]);

  removeOrchestrationStore(dbPath);
  store.close();
  store = openStateStore(dbPath);

  const entryRunA = seedWorkflowStageEntryRun("project-a", "inv-a", "plan");
  const entryRunB = seedWorkflowStageEntryRun("project-b", "inv-b", "implement");
  const conflictingPipelineId = store.createPipeline({
    definition: {
      name: "workflow-conflict",
      stages: [
        { stageId: "plan", kind: "workflow", workflow: "plan", review: "none" },
        { stageId: "implement", kind: "workflow", workflow: "implement", review: "none" },
      ],
    },
  });
  store.updateStage({
    pipelineId: conflictingPipelineId,
    stageId: "plan",
    patch: { status: "failed", workflowInvocationId: entryRunA, failureDetail: { message: "failed" } },
  });
  store.updateStage({
    pipelineId: conflictingPipelineId,
    stageId: "implement",
    patch: { status: "skipped", skipProvenance: "provisional", workflowInvocationId: entryRunB },
  });

  const conflictingIncidents = deriveOperatorIncidents(store);
  expect(conflictingIncidents).toEqual([
    expect.objectContaining({
      kind: "pipeline-terminal",
      pipelineId: conflictingPipelineId,
      project: null,
    }),
  ]);

  removeOrchestrationStore(dbPath);
  store.close();
  store = openStateStore(dbPath);

  const { awaitingPipelineId } = seedActionableDerivationFixtures();
  const awaitingIncidents = deriveOperatorIncidents(store);
  expect(awaitingIncidents).toEqual([
    expect.objectContaining({
      kind: "pipeline-awaiting-approval",
      pipelineId: awaitingPipelineId,
      project: null,
    }),
  ]);
  const awaitingIncident = awaitingIncidents[0];
  if (awaitingIncident === undefined) throw new Error("expected awaiting approval incident");
  expect(JSON.parse(serializeOperatorIncident(awaitingIncident))).toMatchObject({ project: null });
});

function seedPausedRun(
  branch: string,
  workflowSnapshot?: { invocationId: string; steps: { stepId: string; role: "plan" }[] },
): string {
  const runId = store.createRun({
    project: "demo",
    specRef: "HEAD",
    worktreePath: "/tmp/worktree",
    branch,
    specPath: "spec.md",
    ...(workflowSnapshot !== undefined ? { stepId: "plan", workflowSnapshot } : {}),
  });
  store.commitCompletionBoundary({
    attemptId: store.recordAttemptStart(runId),
    runStatus: "paused",
    outcomeKind: "missing_blocker",
  });
  return runId;
}

function linkRunningStage(entryRunId: string, status: "running" | "failed"): string {
  const pipelineId = store.createPipeline({
    definition: { name: "linked", stages: [{ stageId: "plan", kind: "workflow", workflow: "plan", review: "none" }] },
  });
  store.updateStage({
    pipelineId,
    stageId: "plan",
    patch: {
      status,
      workflowInvocationId: entryRunId,
      ...(status === "failed" ? { failureDetail: { message: "failed" } } : {}),
    },
  });
  return pipelineId;
}

test("ad-hoc paused run emits run-paused", () => {
  const runId = seedPausedRun("ad-hoc");
  expect(deriveOperatorIncidents(store)).toEqual([
    expect.objectContaining({ kind: "run-paused", runId, cause: "paused", project: "demo" }),
  ]);
});

test("pipeline-attributed paused run emits run-paused while its stage stays running", () => {
  const snapshot = { invocationId: "inv-paused", steps: [{ stepId: "plan", role: "plan" as const }] };
  const runId = seedPausedRun("attributed", snapshot);
  linkRunningStage(runId, "running");
  expect(deriveOperatorIncidents(store)).toEqual([expect.objectContaining({ kind: "run-paused", runId })]);
});

function expectResumableStopNotifiesTwice(status: "paused" | "budget-soft-stopped", kind: string): void {
  setSystemTime(new Date(1_000_000));
  const runId = store.createRun({
    project: "demo",
    specRef: "HEAD",
    worktreePath: "/tmp/w",
    branch: status,
    specPath: "spec.md",
  });
  store.setRunStatus(runId, status);
  const [first] = deriveOperatorIncidents(store);
  if (first === undefined) throw new Error("expected first stop incident");
  expect(first).toMatchObject({ kind, runId, transition: `${status}:1000000` });
  store.tryRecordNotificationDelivery({ incidentId: first.incidentId, transition: first.transition, deliveredAt: 1 });
  expect(deriveOperatorIncidents(store)).toEqual([]);

  setSystemTime(new Date(1_000_500));
  store.setRunStatus(runId, "in-progress");
  expect(deriveOperatorIncidents(store)).toEqual([]);
  setSystemTime(new Date(1_001_000));
  store.setRunStatus(runId, status);

  expect(store.loadRun(runId)?.attemptCount).toBe(0);
  expect(deriveOperatorIncidents(store)).toEqual([
    expect.objectContaining({ kind, runId, transition: `${status}:1001000` }),
  ]);
}

test("pause, resume, pause without a new attempt notifies twice", () => {
  expectResumableStopNotifiesTwice("paused", "run-paused");
});

test("soft-stop, resume, soft-stop notifies twice", () => {
  expectResumableStopNotifiesTwice("budget-soft-stopped", "run-budget-soft-stopped");
});

test("queued and in-progress runs emit nothing", () => {
  const queuedRunId = store.createRun({
    project: "demo",
    specRef: "HEAD",
    worktreePath: "/tmp/w",
    branch: "q",
    specPath: "spec.md",
  });
  patchRunRow(queuedRunId, { status: "queued" });
  store.createRun({ project: "demo", specRef: "HEAD", worktreePath: "/tmp/w", branch: "p", specPath: "spec.md" });
  expect(deriveOperatorIncidents(store)).toEqual([]);
});

test("paused run under a failed stage's invocation is suppressed", () => {
  const entryRunId = seedWorkflowStageEntryRun("demo", "inv-failed", "plan");
  seedPausedRun("sibling", { invocationId: "inv-failed", steps: [{ stepId: "plan", role: "plan" }] });
  const pipelineId = linkRunningStage(entryRunId, "failed");
  expect(deriveOperatorIncidents(store)).toEqual([expect.objectContaining({ kind: "pipeline-terminal", pipelineId })]);
});
