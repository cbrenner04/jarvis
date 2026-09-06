import { Database } from "bun:sqlite";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStateStore, type StateStore } from "../persistence/state-store.ts";
import { removeOrchestrationStore } from "../persistence/state-store-on-disk.ts";
import { deriveOperatorIncidents, serializeOperatorIncident } from "./operator-incidents.ts";
import { runNotificationSweep } from "./operator-notification-sweep.ts";

const FAN_OUT_DOWNSTREAM = ["ready-intents/alpha.md", "ready-intents/beta.md"] as const;

function instrumentStageAttributedLookups(targetStore: StateStore): {
  read: () => { loadRunsByIdsCount: number; findRunsByInvocationIdsCount: number };
} {
  const metrics = { loadRunsByIdsCount: 0, findRunsByInvocationIdsCount: 0 };
  const loadRunsByIds = targetStore.loadRunsByIds.bind(targetStore);
  const findRunsByInvocationIds = targetStore.findRunsByInvocationIds.bind(targetStore);
  targetStore.loadRunsByIds = (runIds) => {
    metrics.loadRunsByIdsCount += 1;
    return loadRunsByIds(runIds);
  };
  targetStore.findRunsByInvocationIds = (invocationIds) => {
    metrics.findRunsByInvocationIdsCount += 1;
    return findRunsByInvocationIds(invocationIds);
  };
  return { read: () => ({ ...metrics }) };
}

function seedNonTerminalFailedLaneWithoutEntryRuns(): {
  pipelineId: string;
  failedBranchKey: string;
  stageIncidentId: string;
} {
  const failedBranchKey = "alpha";
  const runningBranchKey = "beta";

  const pipelineId = store.createPipeline({
    definition: {
      name: "fan-out-linear",
      stages: [
        { stageId: "intent", kind: "workflow", workflow: "intent", review: "none" },
        { stageId: "plan", kind: "workflow", workflow: "plan", review: "none" },
        { stageId: "implement", kind: "workflow", workflow: "implement", review: "light" },
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
        downstreamInputs: [...FAN_OUT_DOWNSTREAM],
      },
    },
  });

  for (const branchKey of [failedBranchKey, runningBranchKey]) {
    store.createPipelineStageBranch({ pipelineId, stageId: "plan", branchKey });
    store.createPipelineStageBranch({ pipelineId, stageId: "implement", branchKey });
  }
  for (const stageId of ["plan", "implement"] as const) {
    store.updateStage({ pipelineId, stageId, branchKey: "default", patch: { status: "skipped" } });
  }

  store.updateStage({
    pipelineId,
    stageId: "plan",
    branchKey: failedBranchKey,
    patch: { status: "failed", workflowInvocationId: null, failureDetail: { message: "plan failed" } },
  });
  store.updateStage({
    pipelineId,
    stageId: "implement",
    branchKey: failedBranchKey,
    patch: { status: "skipped" },
  });
  store.updateStage({
    pipelineId,
    stageId: "plan",
    branchKey: runningBranchKey,
    patch: { status: "running", workflowInvocationId: null },
  });

  return {
    pipelineId,
    failedBranchKey,
    stageIncidentId: `stage:${pipelineId}:plan:${failedBranchKey}`,
  };
}

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

  const wedgedEntryRunId = seedWorkflowStageEntryRun("wedged-project", "inv-wedged", "plan");
  const wedgedPipelineId = store.createPipeline({
    definition: {
      name: "workflow-wedged",
      stages: [{ stageId: "plan", kind: "workflow", workflow: "plan", review: "none" }],
    },
  });
  store.updateStage({
    pipelineId: wedgedPipelineId,
    stageId: "plan",
    patch: {
      status: "running",
      workflowInvocationId: wedgedEntryRunId,
      failureDetail: {
        code: "settlement_deferred",
        reason: "entry_run_still_live",
        entryRunId: wedgedEntryRunId,
        rollupStatus: "failed",
      },
    },
  });

  const wedgedIncidents = deriveOperatorIncidents(store);
  expect(wedgedIncidents).toEqual([
    expect.objectContaining({
      kind: "stage-settlement-wedged",
      pipelineId: wedgedPipelineId,
      project: "wedged-project",
    }),
  ]);
  const wedgedIncident = wedgedIncidents[0];
  if (wedgedIncident === undefined) throw new Error("expected wedged stage incident");
  expect(JSON.parse(serializeOperatorIncident(wedgedIncident))).toMatchObject({ project: "wedged-project" });

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
    patch: { status: "skipped", workflowInvocationId: entryRunB },
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

test("delivery ledger suppresses delivered stage-failed preview keys on non-terminal pipelines", () => {
  const { pipelineId, failedBranchKey, stageIncidentId } = seedNonTerminalFailedLaneWithoutEntryRuns();

  expect(deriveOperatorIncidents(store)).toEqual([
    expect.objectContaining({
      kind: "stage-failed",
      pipelineId,
      stageId: "plan",
      branchKey: failedBranchKey,
      transition: "failed",
    }),
  ]);

  runNotificationSweep({ store, readSinkCommand: () => undefined });
  expect(
    store.hasNotificationDelivery({
      incidentId: stageIncidentId,
      transition: "failed",
    }),
  ).toBe(true);

  const lookupMetrics = instrumentStageAttributedLookups(store);
  expect(deriveOperatorIncidents(store)).toEqual([]);
  expect(lookupMetrics.read()).toEqual({
    loadRunsByIdsCount: 0,
    findRunsByInvocationIdsCount: 0,
  });
});
