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

function expectResumableStopNotifiesTwice(status: "paused" | "budget-soft-stopped" | "blocked", kind: string): void {
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

test("block, resume, block notifies twice", () => {
  expectResumableStopNotifiesTwice("blocked", "run-blocked");
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

function seedFanOutPipeline(stages: { stageId: string; kind: "workflow" | "approval" }[]): string {
  const pipelineId = store.createPipeline({
    definition: {
      name: "fan-out",
      stages: [
        { stageId: "intent", kind: "workflow", workflow: "intent", review: "none" },
        ...stages.map((stage) =>
          stage.kind === "approval"
            ? { stageId: stage.stageId, kind: "approval" as const }
            : { stageId: stage.stageId, kind: "workflow" as const, workflow: "plan" as const, review: "none" as const },
        ),
      ],
    },
  });
  store.updateStage({
    pipelineId,
    stageId: "intent",
    patch: {
      status: "succeeded",
      workflowInvocationId: "run-intent",
      artifact: {
        entryRunId: "run-intent",
        specPath: "ready-intents",
        downstreamInputs: ["ready-intents/a.md", "ready-intents/b.md"],
      },
    },
  });
  for (const { stageId } of stages) {
    for (const branchKey of ["a", "b"]) store.createPipelineStageBranch({ pipelineId, stageId, branchKey });
    store.updateStage({
      pipelineId,
      stageId,
      branchKey: "default",
      patch: { status: "skipped", skipProvenance: "terminal" },
    });
  }
  return pipelineId;
}

function deliverAll(): void {
  for (const incident of deriveOperatorIncidents(store)) {
    store.tryRecordNotificationDelivery({
      incidentId: incident.incidentId,
      transition: incident.transition,
      deliveredAt: 1,
    });
  }
}

test("fan-out lane that fails, resumes, and fails again notifies each failure", () => {
  setSystemTime(new Date(1_000_000));
  const pipelineId = seedFanOutPipeline([{ stageId: "plan", kind: "workflow" }]);
  store.updateStage({ pipelineId, stageId: "plan", branchKey: "b", patch: { status: "running" } });
  store.updateStage({ pipelineId, stageId: "plan", branchKey: "a", patch: { status: "failed" } });
  expect(deriveOperatorIncidents(store)).toEqual([expect.objectContaining({ kind: "stage-failed", branchKey: "a" })]);
  deliverAll();
  expect(deriveOperatorIncidents(store)).toEqual([]);

  store.updateStage({ pipelineId, stageId: "plan", branchKey: "a", patch: { status: "running", endedAt: null } });
  setSystemTime(new Date(1_001_000));
  store.updateStage({ pipelineId, stageId: "plan", branchKey: "a", patch: { status: "failed" } });
  expect(deriveOperatorIncidents(store)).toEqual([
    expect.objectContaining({ kind: "stage-failed", branchKey: "a", transition: "failed:1001000" }),
  ]);
});

test("each newly reached fan-out gate notifies once while an earlier gate stays awaiting", () => {
  setSystemTime(new Date(1_000_000));
  const pipelineId = seedFanOutPipeline([
    { stageId: "plan", kind: "workflow" },
    { stageId: "approve-plan", kind: "approval" },
  ]);
  store.updateStage({ pipelineId, stageId: "plan", branchKey: "a", patch: { status: "succeeded" } });
  store.updateStage({ pipelineId, stageId: "approve-plan", branchKey: "a", patch: { status: "awaiting" } });
  store.updateStage({ pipelineId, stageId: "plan", branchKey: "b", patch: { status: "running" } });
  expect(deriveOperatorIncidents(store)).toEqual([
    expect.objectContaining({ kind: "pipeline-awaiting-approval", stageId: "approve-plan", branchKey: "a" }),
  ]);
  deliverAll();

  setSystemTime(new Date(1_002_000));
  store.updateStage({ pipelineId, stageId: "plan", branchKey: "b", patch: { status: "succeeded" } });
  store.updateStage({ pipelineId, stageId: "approve-plan", branchKey: "b", patch: { status: "awaiting" } });
  expect(deriveOperatorIncidents(store)).toEqual([
    expect.objectContaining({ kind: "pipeline-awaiting-approval", stageId: "approve-plan", branchKey: "b" }),
  ]);
  deliverAll();
  expect(deriveOperatorIncidents(store)).toEqual([]);
});

test("plain run without a workflow snapshot notifies on every terminal settlement", () => {
  setSystemTime(new Date(1_000_000));
  const runId = store.createRun({
    project: "demo",
    specRef: "HEAD",
    worktreePath: "/tmp/w",
    branch: "plain",
    specPath: "s.md",
  });
  store.setRunStatus(runId, "failed");
  expect(deriveOperatorIncidents(store)).toEqual([
    expect.objectContaining({
      kind: "run-ad-hoc-terminal",
      runId,
      project: "demo",
      transition: "terminal:failed:1000000",
    }),
  ]);
  deliverAll();

  setSystemTime(new Date(1_001_000));
  store.setRunStatus(runId, "in-progress");
  expect(deriveOperatorIncidents(store)).toEqual([]);
  setSystemTime(new Date(1_002_000));
  store.setRunStatus(runId, "killed");
  expect(deriveOperatorIncidents(store)).toEqual([
    expect.objectContaining({ kind: "run-ad-hoc-terminal", runId, transition: "terminal:killed:1002000" }),
  ]);
});

test("a reachable gate still pending notifies on the predecessor fallback; the boundary commit re-keys it", () => {
  setSystemTime(new Date(1_000_000));
  const pipelineId = store.createPipeline({
    definition: { name: "gate-only", stages: [{ stageId: "gate", kind: "approval" }] },
  });
  const gate = store.loadPipeline(pipelineId)?.stages[0];
  if (gate === undefined) throw new Error("expected gate row");
  expect(deriveOperatorIncidents(store)).toEqual([
    expect.objectContaining({
      kind: "pipeline-awaiting-approval",
      pipelineId,
      transition: "awaiting-approval:gate:default:1000000",
      sinceMs: 1_000_000,
    }),
  ]);

  setSystemTime(new Date(1_003_000));
  expect(store.commitApprovalBoundary({ stageRecordId: gate.id }).kind).toBe("applied");
  expect(deriveOperatorIncidents(store)).toEqual([
    expect.objectContaining({
      kind: "pipeline-awaiting-approval",
      pipelineId,
      transition: "awaiting-approval:gate:default:1003000",
      sinceMs: 1_003_000,
    }),
  ]);
});

test("a gate re-reached with no predecessor re-run notifies again", () => {
  setSystemTime(new Date(1_000_000));
  const pipelineId = store.createPipeline({
    definition: { name: "gate-only", stages: [{ stageId: "gate", kind: "approval" }] },
  });
  store.updateStage({ pipelineId, stageId: "gate", patch: { status: "awaiting" } });
  expect(deriveOperatorIncidents(store)).toEqual([
    expect.objectContaining({
      kind: "pipeline-awaiting-approval",
      transition: "awaiting-approval:gate:default:1000000",
    }),
  ]);
  deliverAll();
  expect(deriveOperatorIncidents(store)).toEqual([]);

  store.updateStage({ pipelineId, stageId: "gate", patch: { status: "pending" } });
  expect(deriveOperatorIncidents(store)).toEqual([]);
  expect(store.loadPipeline(pipelineId)?.stages[0]?.awaitingSince).toBe(1_000_000);
  setSystemTime(new Date(1_005_000));
  store.updateStage({ pipelineId, stageId: "gate", patch: { status: "awaiting" } });
  expect(deriveOperatorIncidents(store)).toEqual([
    expect.objectContaining({
      kind: "pipeline-awaiting-approval",
      transition: "awaiting-approval:gate:default:1005000",
    }),
  ]);
});

test("a legacy awaiting row without awaiting_since keys on predecessor settlement", () => {
  const pipelineId = store.createPipeline({
    definition: { name: "gate-only", stages: [{ stageId: "gate", kind: "approval" }] },
  });
  store.updateStage({ pipelineId, stageId: "gate", patch: { status: "awaiting" } });
  const raw = new Database(dbPath);
  try {
    raw.prepare("UPDATE pipeline_stages SET awaiting_since = NULL WHERE pipeline_id = ?").run(pipelineId);
  } finally {
    raw.close();
  }
  const createdAt = store.loadPipeline(pipelineId)?.createdAt;
  expect(deriveOperatorIncidents(store)).toEqual([
    expect.objectContaining({ transition: `awaiting-approval:gate:default:${createdAt}`, sinceMs: createdAt }),
  ]);
});

const TWO_STEP_SNAPSHOT = {
  invocationId: "inv-two-step",
  steps: [
    { stepId: "plan", role: "plan" as const },
    { stepId: "review", role: "review" as const },
  ],
};

function seedInvocationRow(stepId: string, status: "completed" | "in-progress" | "killed" | "failed"): string {
  const runId = store.createRun({
    project: "demo",
    specRef: "HEAD",
    worktreePath: "/tmp/w",
    branch: "two-step",
    specPath: "s.md",
    stepId,
    workflowSnapshot: TWO_STEP_SNAPSHOT,
  });
  if (status !== "in-progress") store.setRunStatus(runId, status);
  return runId;
}

test("multi-row workflow invocation emits one terminal incident", () => {
  setSystemTime(new Date(1_000_000));
  const entryRunId = seedInvocationRow("plan", "completed");
  setSystemTime(new Date(1_005_000));
  seedInvocationRow("review", "completed");
  store.writeWorkflowInvocationSettledMarker(entryRunId, "completed", 1_005_000);
  expect(deriveOperatorIncidents(store)).toEqual([
    expect.objectContaining({
      kind: "run-ad-hoc-terminal",
      runId: entryRunId,
      cause: "completed",
      transition: "terminal:completed",
      sinceMs: 1_005_000,
      project: "demo",
    }),
  ]);
  deliverAll();
  expect(deriveOperatorIncidents(store)).toEqual([]);
});

test("entry row terminal does not emit while successors are live", () => {
  seedInvocationRow("plan", "completed");
  seedInvocationRow("review", "in-progress");
  expect(deriveOperatorIncidents(store)).toEqual([]);
});

test("a durable step with no row yet and no marker derives nothing", () => {
  seedInvocationRow("plan", "completed");
  expect(deriveOperatorIncidents(store)).toEqual([]);
});

test("a successor row killed by reconciliation settles the invocation once", () => {
  setSystemTime(new Date(1_000_000));
  const entryRunId = seedInvocationRow("plan", "completed");
  setSystemTime(new Date(1_002_000));
  seedInvocationRow("review", "killed");
  store.writeWorkflowInvocationSettledMarker(entryRunId, "killed", 1_002_000);
  expect(deriveOperatorIncidents(store)).toEqual([
    expect.objectContaining({ runId: entryRunId, cause: "killed", transition: "terminal:killed", sinceMs: 1_002_000 }),
  ]);
});

test("ad-hoc run without an invocation still emits its terminal incident", () => {
  setSystemTime(new Date(1_000_000));
  const runId = store.createRun({
    project: "demo",
    specRef: "HEAD",
    worktreePath: "/tmp/w",
    branch: "p",
    specPath: "s.md",
  });
  store.setRunStatus(runId, "completed");
  expect(deriveOperatorIncidents(store)).toEqual([
    expect.objectContaining({ kind: "run-ad-hoc-terminal", runId, transition: "terminal:completed:1000000" }),
  ]);
});

test("a completed review row with a running publication row and no marker derives nothing", () => {
  const THREE_STEP = {
    invocationId: "inv-three-step",
    steps: [
      { stepId: "plan", role: "plan" as const },
      { stepId: "review", role: "review" as const },
      { stepId: "publication", role: "publication" as const },
    ],
  };
  const seed = (stepId: string, status: "completed" | "in-progress"): string => {
    const runId = store.createRun({
      project: "demo",
      specRef: "HEAD",
      worktreePath: "/tmp/w",
      branch: "three-step",
      specPath: "s.md",
      stepId,
      workflowSnapshot: THREE_STEP,
    });
    if (status === "completed") store.setRunStatus(runId, status);
    return runId;
  };
  const entryRunId = seed("plan", "completed");
  seed("review", "completed");
  seed("publication", "in-progress");
  expect(deriveOperatorIncidents(store)).toEqual([]);

  store.writeWorkflowInvocationSettledMarker(entryRunId, "completed", Date.now());
  expect(deriveOperatorIncidents(store)).toEqual([expect.objectContaining({ runId: entryRunId, cause: "completed" })]);
});

test("a second row settling after a sweep does not re-fire the delivered marker cause", () => {
  setSystemTime(new Date(1_000_000));
  const entryRunId = seedInvocationRow("plan", "completed");
  store.writeWorkflowInvocationSettledMarker(entryRunId, "completed", 1_000_000);
  expect(deriveOperatorIncidents(store)).toHaveLength(1);
  deliverAll();

  setSystemTime(new Date(1_023_000));
  seedInvocationRow("review", "completed");
  expect(deriveOperatorIncidents(store)).toEqual([]);
});

test("rewriting a row's status_changed_at after delivery does not re-fire", () => {
  setSystemTime(new Date(1_000_000));
  const entryRunId = seedInvocationRow("plan", "completed");
  store.writeWorkflowInvocationSettledMarker(entryRunId, "completed", 1_000_000);
  deliverAll();

  setSystemTime(new Date(1_050_000));
  store.setRunStatus(entryRunId, "completed");
  expect(deriveOperatorIncidents(store)).toEqual([]);
});

test("a marker rewritten from completed to failed delivers a second incident with the failed cause", () => {
  setSystemTime(new Date(1_000_000));
  const entryRunId = seedInvocationRow("plan", "completed");
  store.writeWorkflowInvocationSettledMarker(entryRunId, "completed", 1_000_000);
  deliverAll();

  store.writeWorkflowInvocationSettledMarker(entryRunId, "failed", 1_010_000);
  expect(deriveOperatorIncidents(store)).toEqual([
    expect.objectContaining({ runId: entryRunId, cause: "failed", transition: "terminal:failed", sinceMs: 1_010_000 }),
  ]);
  deliverAll();
  expect(deriveOperatorIncidents(store)).toEqual([]);
});

test("a marker cause that returns to an earlier value is deduplicated", () => {
  const entryRunId = seedInvocationRow("plan", "completed");
  store.writeWorkflowInvocationSettledMarker(entryRunId, "completed", 1_000_000);
  deliverAll();
  store.writeWorkflowInvocationSettledMarker(entryRunId, "failed", 1_010_000);
  deliverAll();
  store.writeWorkflowInvocationSettledMarker(entryRunId, "completed", 1_020_000);
  expect(deriveOperatorIncidents(store)).toEqual([]);
});

test("an invocation with a run_timeout row and a failed marker derives no ad-hoc terminal", () => {
  const entryRunId = seedInvocationRow("plan", "completed");
  const reviewRunId = seedInvocationRow("review", "in-progress");
  store.commitTerminalRunSettlement({ runId: reviewRunId, status: "killed", terminalCause: "run_timeout" });
  store.writeWorkflowInvocationSettledMarker(entryRunId, "failed", Date.now());
  expect(deriveOperatorIncidents(store).map((incident) => incident.kind)).toEqual(["run-timeout"]);
});

test.each([
  "completed",
  "failed",
] as const)("an invocation with a blocked row and a %s marker derives no ad-hoc terminal", (cause) => {
  const entryRunId = seedInvocationRow("plan", "completed");
  const reviewRunId = seedInvocationRow("review", "in-progress");
  store.setRunStatus(reviewRunId, "blocked");
  store.writeWorkflowInvocationSettledMarker(entryRunId, cause, Date.now());
  expect(deriveOperatorIncidents(store).map((incident) => incident.kind)).toEqual(["run-blocked"]);
});

test("an invocation whose entry row is outside the recency window still derives from its marker", () => {
  setSystemTime(new Date(1_000_000));
  const entryRunId = seedInvocationRow("plan", "completed");
  const outsideWindowMs = 1_000_000 + 30 * 24 * 60 * 60 * 1000;
  setSystemTime(new Date(outsideWindowMs));
  seedInvocationRow("review", "completed");
  patchRunRow(entryRunId, { finishedAt: 1_000_000, createdAt: 1_000_000 });
  store.writeWorkflowInvocationSettledMarker(entryRunId, "completed", outsideWindowMs);
  expect(deriveOperatorIncidents(store, outsideWindowMs)).toEqual([
    expect.objectContaining({ runId: entryRunId, transition: "terminal:completed" }),
  ]);
});

function seedImplementLanePipeline(): string {
  const pipelineId = store.createPipeline({
    definition: {
      name: "fan-out-implement",
      stages: [
        { stageId: "intent", kind: "workflow", workflow: "intent", review: "none" },
        { stageId: "plan", kind: "workflow", workflow: "plan", review: "none" },
        { stageId: "approve-plan", kind: "approval" },
        { stageId: "implement", kind: "workflow", workflow: "implement", review: "none" },
      ],
    },
  });
  store.updateStage({
    pipelineId,
    stageId: "intent",
    patch: {
      status: "succeeded",
      workflowInvocationId: "run-intent",
      artifact: {
        entryRunId: "run-intent",
        specPath: "ready-intents",
        downstreamInputs: ["ready-intents/a.md", "ready-intents/b.md"],
      },
    },
  });
  for (const stageId of ["plan", "approve-plan", "implement"]) {
    for (const branchKey of ["a", "b"]) store.createPipelineStageBranch({ pipelineId, stageId, branchKey });
    store.updateStage({
      pipelineId,
      stageId,
      branchKey: "default",
      patch: { status: "skipped", skipProvenance: "terminal" },
    });
  }
  return pipelineId;
}

function landBranchAAtImplement(pipelineId: string, artifact: Record<string, unknown>): void {
  store.updateStage({ pipelineId, stageId: "plan", branchKey: "a", patch: { status: "succeeded" } });
  store.updateStage({ pipelineId, stageId: "approve-plan", branchKey: "a", patch: { status: "approved" } });
  store.updateStage({ pipelineId, stageId: "implement", branchKey: "a", patch: { status: "succeeded", artifact } });
}

function implementArtifact(prNumber: number, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { entryRunId: "run-a", specPath: "spec.md", prNumber, ...extra };
}

test("a fan-out lane's succeeded implement stage notifies while a sibling gate stays awaiting", () => {
  setSystemTime(new Date(1_000_000));
  const pipelineId = seedImplementLanePipeline();
  store.updateStage({ pipelineId, stageId: "plan", branchKey: "b", patch: { status: "succeeded" } });
  store.updateStage({ pipelineId, stageId: "approve-plan", branchKey: "b", patch: { status: "awaiting" } });

  landBranchAAtImplement(pipelineId, implementArtifact(42, { prUrl: "https://github.com/x/y/pull/42" }));

  const succeeded = deriveOperatorIncidents(store).filter((incident) => incident.kind === "stage-succeeded");
  expect(succeeded).toEqual([
    expect.objectContaining({
      pipelineId,
      stageId: "implement",
      branchKey: "a",
      prNumber: 42,
      prUrl: "https://github.com/x/y/pull/42",
    }),
  ]);
});

test("a succeeded stage named 'implement' whose definition workflow is not 'implement' derives no stage-succeeded incident", () => {
  const pipelineId = store.createPipeline({
    definition: {
      name: "misnamed-stage",
      stages: [
        { stageId: "plan", kind: "workflow", workflow: "plan", review: "none" },
        { stageId: "implement", kind: "workflow", workflow: "plan", review: "none" },
        { stageId: "gate", kind: "approval" },
      ],
    },
  });
  store.updateStage({ pipelineId, stageId: "plan", patch: { status: "succeeded" } });
  store.updateStage({ pipelineId, stageId: "implement", patch: { status: "succeeded" } });
  store.updateStage({ pipelineId, stageId: "gate", patch: { status: "awaiting" } });
  expect(deriveOperatorIncidents(store).some((incident) => incident.kind === "stage-succeeded")).toBe(false);
});

test("a lane's re-settled succeeded implement stage yields a transition distinct from its first settlement", () => {
  setSystemTime(new Date(1_000_000));
  const pipelineId = seedImplementLanePipeline();
  landBranchAAtImplement(pipelineId, implementArtifact(1));
  const [first] = deriveOperatorIncidents(store).filter((incident) => incident.kind === "stage-succeeded");
  if (first === undefined) throw new Error("expected first stage-succeeded incident");
  expect(first.transition).toBe("succeeded:1000000");
  deliverAll();

  setSystemTime(new Date(1_005_000));
  store.updateStage({ pipelineId, stageId: "implement", branchKey: "a", patch: { status: "running", endedAt: null } });
  store.updateStage({
    pipelineId,
    stageId: "implement",
    branchKey: "a",
    patch: { status: "succeeded", artifact: implementArtifact(2) },
  });
  const succeeded = deriveOperatorIncidents(store).filter((incident) => incident.kind === "stage-succeeded");
  expect(succeeded).toEqual([expect.objectContaining({ transition: "succeeded:1005000", prNumber: 2 })]);
});

test("preview key derivation keeps a pipeline active for an undelivered stage-succeeded incident", () => {
  setSystemTime(new Date(1_000_000));
  const pipelineId = seedImplementLanePipeline();
  store.updateStage({ pipelineId, stageId: "plan", branchKey: "b", patch: { status: "succeeded" } });
  store.updateStage({ pipelineId, stageId: "approve-plan", branchKey: "b", patch: { status: "awaiting" } });
  deliverAll();
  expect(deriveOperatorIncidents(store)).toEqual([]);

  landBranchAAtImplement(pipelineId, implementArtifact(7));
  expect(deriveOperatorIncidents(store)).toEqual([
    expect.objectContaining({ kind: "stage-succeeded", pipelineId, stageId: "implement", branchKey: "a", prNumber: 7 }),
  ]);
});

test("a lane whose implement stage fails then later succeeds derives both a stage-failed and a stage-succeeded incident", () => {
  setSystemTime(new Date(1_000_000));
  const pipelineId = seedImplementLanePipeline();
  store.updateStage({ pipelineId, stageId: "plan", branchKey: "a", patch: { status: "succeeded" } });
  store.updateStage({ pipelineId, stageId: "approve-plan", branchKey: "a", patch: { status: "approved" } });
  store.updateStage({ pipelineId, stageId: "implement", branchKey: "a", patch: { status: "failed" } });

  const incidentsAfterFailure = deriveOperatorIncidents(store);
  const failedIncident = incidentsAfterFailure.find((incident) => incident.kind === "stage-failed");
  if (failedIncident === undefined) throw new Error("expected stage-failed incident");
  expect(failedIncident).toMatchObject({ pipelineId, stageId: "implement", branchKey: "a" });
  expect(incidentsAfterFailure.some((incident) => incident.kind === "stage-succeeded")).toBe(false);
  deliverAll();

  setSystemTime(new Date(1_002_000));
  store.updateStage({ pipelineId, stageId: "implement", branchKey: "a", patch: { status: "running", endedAt: null } });
  store.updateStage({
    pipelineId,
    stageId: "implement",
    branchKey: "a",
    patch: { status: "succeeded", artifact: implementArtifact(3) },
  });
  const succeededIncident = deriveOperatorIncidents(store).find((incident) => incident.kind === "stage-succeeded");
  if (succeededIncident === undefined) throw new Error("expected stage-succeeded incident");
  expect(succeededIncident).toMatchObject({ pipelineId, stageId: "implement", branchKey: "a" });
  expect(succeededIncident.incidentId).toBe(failedIncident.incidentId);
  expect(succeededIncident.transition).not.toBe(failedIncident.transition);
});

test("a succeeded implement stage row with a null endedAt derives no stage-succeeded incident", () => {
  const pipelineId = seedImplementLanePipeline();
  landBranchAAtImplement(pipelineId, implementArtifact(5));
  const raw = new Database(dbPath);
  try {
    raw
      .prepare("UPDATE pipeline_stages SET ended_at = NULL WHERE pipeline_id = ? AND stage_id = ? AND branch_key = ?")
      .run(pipelineId, "implement", "a");
  } finally {
    raw.close();
  }
  expect(deriveOperatorIncidents(store).some((incident) => incident.kind === "stage-succeeded")).toBe(false);
});

test("an undelivered stage-succeeded incident is not masked by an already-delivered gate incident", () => {
  setSystemTime(new Date(1_000_000));
  const pipelineId = store.createPipeline({
    definition: {
      name: "linear-implement",
      stages: [
        { stageId: "intent", kind: "workflow", workflow: "intent", review: "none" },
        { stageId: "approve", kind: "approval" },
        { stageId: "implement", kind: "workflow", workflow: "implement", review: "none" },
      ],
    },
  });
  store.updateStage({ pipelineId, stageId: "intent", patch: { status: "succeeded" } });
  store.updateStage({ pipelineId, stageId: "approve", patch: { status: "awaiting" } });
  deliverAll();
  expect(deriveOperatorIncidents(store)).toEqual([]);

  store.updateStage({
    pipelineId,
    stageId: "implement",
    patch: {
      status: "succeeded",
      artifact: implementArtifact(11, { prUrl: "https://github.com/x/y/pull/11" }),
    },
  });
  expect(deriveOperatorIncidents(store)).toEqual([
    expect.objectContaining({ kind: "stage-succeeded", pipelineId, stageId: "implement", prNumber: 11 }),
  ]);
});

test("a single-lane pipeline whose implement stage succeeded and is terminal emits only pipeline-terminal", () => {
  const pipelineId = store.createPipeline({
    definition: {
      name: "single-lane-implement",
      stages: [{ stageId: "implement", kind: "workflow", workflow: "implement", review: "none" }],
    },
  });
  store.updateStage({
    pipelineId,
    stageId: "implement",
    patch: {
      status: "succeeded",
      artifact: implementArtifact(9, { prUrl: "https://github.com/x/y/pull/9" }),
    },
  });
  expect(deriveOperatorIncidents(store)).toEqual([expect.objectContaining({ kind: "pipeline-terminal", pipelineId })]);
});

test("a resumed linked row's failure settles once per marker cause", () => {
  setSystemTime(new Date(1_000_000));
  const runId = seedInvocationRow("plan~link-0", "in-progress");
  store.commitTerminalRunSettlement({ runId, status: "failed", terminalCause: "gate_invocation_refused" });
  store.writeWorkflowInvocationSettledMarker(runId, "failed", 1_000_000);
  expect(deriveOperatorIncidents(store)).toEqual([
    expect.objectContaining({ runId, cause: "failed", transition: "terminal:failed", sinceMs: 1_000_000 }),
  ]);
  deliverAll();

  setSystemTime(new Date(2_000_000));
  store.setRunStatus(runId, "in-progress");
  store.commitTerminalRunSettlement({ runId, status: "completed", terminalCause: "completion_commit_failed" });
  expect(deriveOperatorIncidents(store)).toEqual([]);
});
