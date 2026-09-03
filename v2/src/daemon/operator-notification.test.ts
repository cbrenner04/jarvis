import { Database } from "bun:sqlite";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IpcServer } from "../ipc/server.ts";
import type { LogReader } from "../persistence/log-stream.ts";
import { openStateStore, type StateStore, type WorkflowSnapshot } from "../persistence/state-store.ts";
import { removeOrchestrationStore } from "../persistence/state-store-on-disk.ts";
import { startDaemonRuntime } from "./daemon.ts";
import { deriveOperatorIncidents } from "./operator-incidents.ts";
import { runNotificationSweep } from "./operator-notification-sweep.ts";

const dbPath = join(tmpdir(), `jarvis-operator-notify-${process.pid}.sqlite`);

const DERIVATION_NOW_MS = 50_000_000;
const DERIVATION_OLD_MS = 100;
const DERIVATION_RECENT_MS = 10_000_000;

const AD_HOC_SNAPSHOT: WorkflowSnapshot = {
  invocationId: "inv-ad-hoc",
  steps: [{ stepId: "plan", role: "plan" }],
};

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

function seedTerminalAdHocRun(status: string, finishedAt: number, invocationId: string): string {
  const runId = store.createRun({
    project: "demo",
    specRef: "main",
    worktreePath: "/tmp/worktree",
    branch: "feature",
    specPath: "spec.md",
    workflowSnapshot: { ...AD_HOC_SNAPSHOT, invocationId },
  });
  patchRunRow(runId, { status, finishedAt, createdAt: DERIVATION_OLD_MS });
  return runId;
}

function seedActionableDerivationFixtures(): { blockedRunId: string; awaitingPipelineId: string } {
  for (let index = 0; index < 40; index += 1) {
    seedTerminalAdHocRun("completed", DERIVATION_OLD_MS, `inv-old-${index}`);
  }

  const blockedRunId = store.createRun({
    project: "demo",
    specRef: "main",
    worktreePath: "/tmp/worktree",
    branch: "feature",
    specPath: "spec.md",
  });
  patchRunRow(blockedRunId, { status: "blocked", finishedAt: DERIVATION_RECENT_MS, createdAt: DERIVATION_RECENT_MS });

  const awaitingPipelineId = store.createPipeline({
    definition: { name: "gate-only", stages: [{ stageId: "gate", kind: "approval" }] },
  });
  store.updateStage({ pipelineId: awaitingPipelineId, stageId: "gate", patch: { status: "awaiting" } });

  return { blockedRunId, awaitingPipelineId };
}

type CandidateQueryMetrics = {
  pipelineQueryCount: number;
  runQueryCount: number;
  pipelineRowsDecoded: number;
  runRowsDecoded: number;
};

type StageAttributedLookupMetrics = {
  loadRunsByIdsCount: number;
  findRunsByInvocationIdsCount: number;
};

function instrumentStageAttributedLookups(targetStore: StateStore): {
  read: () => StageAttributedLookupMetrics;
} {
  const metrics: StageAttributedLookupMetrics = {
    loadRunsByIdsCount: 0,
    findRunsByInvocationIdsCount: 0,
  };
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

function seedWorkflowStageEntryRun(invocationId: string, stepId: string): string {
  const runId = store.createRun({
    project: "demo",
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

function instrumentIncidentCandidateQueries(targetStore: StateStore): {
  read: () => CandidateQueryMetrics;
  reset: () => void;
} {
  const metrics: CandidateQueryMetrics = {
    pipelineQueryCount: 0,
    runQueryCount: 0,
    pipelineRowsDecoded: 0,
    runRowsDecoded: 0,
  };
  const listIncidentCandidatePipelines = targetStore.listIncidentCandidatePipelines.bind(targetStore);
  const listIncidentCandidateRuns = targetStore.listIncidentCandidateRuns.bind(targetStore);
  targetStore.listIncidentCandidatePipelines = (args) => {
    metrics.pipelineQueryCount += 1;
    const rows = listIncidentCandidatePipelines(args);
    metrics.pipelineRowsDecoded += rows.length;
    return rows;
  };
  targetStore.listIncidentCandidateRuns = (args) => {
    metrics.runQueryCount += 1;
    const rows = listIncidentCandidateRuns(args);
    metrics.runRowsDecoded += rows.length;
    return rows;
  };
  return {
    read: () => ({ ...metrics }),
    reset: () => {
      metrics.pipelineQueryCount = 0;
      metrics.runQueryCount = 0;
      metrics.pipelineRowsDecoded = 0;
      metrics.runRowsDecoded = 0;
    },
  };
}

function sweepDeps(
  overrides: Partial<Parameters<typeof runNotificationSweep>[0]> = {},
): Parameters<typeof runNotificationSweep>[0] {
  return {
    store,
    readSinkCommand: () => "cat",
    ...overrides,
  };
}

async function startDaemonWithSink(
  targetStore: StateStore,
  spawnSink: NonNullable<Parameters<typeof runNotificationSweep>[0]["spawnSink"]>,
  readSinkCommand: () => string | undefined = () => "cat",
) {
  const reader: LogReader = { tail: () => [], async *follow() {} };
  return startDaemonRuntime("/fake/socket", targetStore, reader, {
    openLogSink: () => ({ append: () => undefined, close: () => undefined }),
    startIpcServer: async () => ({ close: async () => undefined }) as IpcServer,
    readNotificationSinkCommand: readSinkCommand,
    notificationSpawnSink: spawnSink,
  });
}

beforeEach(() => {
  removeOrchestrationStore(dbPath);
  store = openStateStore(dbPath);
});

afterEach(() => {
  store.close();
  removeOrchestrationStore(dbPath);
});

test("pipeline awaiting-approval then terminal fires the sink once per transition", () => {
  const payloads: string[] = [];
  const pipelineId = store.createPipeline({
    definition: { name: "gate-only", stages: [{ stageId: "gate", kind: "approval" }] },
  });
  store.updateStage({ pipelineId, stageId: "gate", patch: { status: "awaiting" } });

  runNotificationSweep(
    sweepDeps({
      spawnSink: (_command, json) => {
        payloads.push(json);
        return { ok: true };
      },
    }),
  );

  store.updateStage({ pipelineId, stageId: "gate", patch: { status: "rejected" } });
  runNotificationSweep(
    sweepDeps({
      spawnSink: (_command, json) => {
        payloads.push(json);
        return { ok: true };
      },
    }),
  );

  expect(payloads).toHaveLength(2);
  const first = JSON.parse(payloads[0] ?? "{}") as { kind: string; pipelineId: string; transition: string };
  const second = JSON.parse(payloads[1] ?? "{}") as {
    kind: string;
    pipelineId: string;
    transition: string;
    cause: string;
  };
  expect(first.kind).toBe("pipeline-awaiting-approval");
  expect(first.pipelineId).toBe(pipelineId);
  expect(first.transition).toBe("awaiting-approval:gate:default");
  expect(second.kind).toBe("pipeline-terminal");
  expect(second.pipelineId).toBe(pipelineId);
  expect(second.transition).toBe("terminal:rejected");
  expect(second.cause).toBe("rejected");
});

test("a single failed stage produces one incident across stage, entry-run, and step-run rows", () => {
  const snapshot: WorkflowSnapshot = {
    invocationId: "inv-failed-stage",
    steps: [{ stepId: "plan", role: "plan" }],
  };
  const entryRunId = store.createRun({
    project: "demo",
    specRef: "HEAD",
    worktreePath: "/tmp/worktree",
    branch: "feature",
    specPath: "spec.md",
    stepId: "plan",
    workflowSnapshot: snapshot,
  });
  const entryAttempt = store.recordAttemptStart(entryRunId);
  store.commitCompletionBoundary({ attemptId: entryAttempt, runStatus: "completed", outcomeKind: "done" });

  const reviewRunId = store.createRun({
    project: "demo",
    specRef: "",
    worktreePath: "/tmp/worktree",
    branch: "feature",
    specPath: ".jarvis-plan-stage",
    stepId: "plan-review",
    workflowSnapshot: snapshot,
  });
  const reviewAttempt = store.recordAttemptStart(reviewRunId);
  store.commitCompletionBoundary({
    attemptId: reviewAttempt,
    runStatus: "failed",
    outcomeKind: "invocation_failure",
  });

  const pipelineId = store.createPipeline({
    definition: {
      name: "workflow-only",
      stages: [{ stageId: "plan", kind: "workflow", workflow: "plan", review: "light" }],
    },
  });
  store.updateStage({
    pipelineId,
    stageId: "plan",
    patch: {
      status: "failed",
      workflowInvocationId: entryRunId,
      failureDetail: { message: "review failed" },
    },
  });

  expect(deriveOperatorIncidents(store)).toEqual([
    expect.objectContaining({
      kind: "pipeline-terminal",
      pipelineId,
      transition: "terminal:failed",
      cause: "failed",
    }),
  ]);
});

test.each([
  { label: "multi-stage pipelines" },
])("stage-attributed resolution uses one batched run lookup and one batched invocation lookup per sweep", () => {
  const stageSpecs = [
    { stageId: "plan", invocationId: "inv-stage-0" },
    { stageId: "implement", invocationId: "inv-stage-1" },
    { stageId: "verify", invocationId: "inv-stage-2" },
    { stageId: "ship", invocationId: "inv-stage-3" },
    { stageId: "publish", invocationId: "inv-stage-4" },
  ] as const;

  for (const { stageId, invocationId } of stageSpecs) {
    const entryRunId = seedWorkflowStageEntryRun(invocationId, stageId);
    const pipelineId = store.createPipeline({
      definition: {
        name: `workflow-${stageId}`,
        stages: [{ stageId, kind: "workflow", workflow: stageId, review: "none" }],
      },
    });
    store.updateStage({
      pipelineId,
      stageId,
      patch: { status: "failed", workflowInvocationId: entryRunId, failureDetail: { message: "failed" } },
    });
  }

  const lookupMetrics = instrumentStageAttributedLookups(store);
  deriveOperatorIncidents(store);
  expect(lookupMetrics.read()).toEqual({
    loadRunsByIdsCount: 1,
    findRunsByInvocationIdsCount: 1,
  });
});

test("boot sweep delivers an incident settled while no daemon was alive", async () => {
  const payloads: string[] = [];
  const pipelineId = store.createPipeline({
    definition: { name: "gate-only", stages: [{ stageId: "gate", kind: "approval" }] },
  });
  store.updateStage({ pipelineId, stageId: "gate", patch: { status: "awaiting" } });
  store.close();

  const bootStore = openStateStore(dbPath);
  const runtime = await startDaemonWithSink(bootStore, (_command, json) => {
    payloads.push(json);
    return { ok: true };
  });
  try {
    expect(payloads).toHaveLength(1);
    expect(JSON.parse(payloads[0] ?? "{}")).toMatchObject({
      kind: "pipeline-awaiting-approval",
      pipelineId,
    });
  } finally {
    await runtime.close();
    bootStore.close();
  }
});

test.each([{ label: "awaiting approval" }])("delivery ledger suppresses incident re-derivation on later sweeps", () => {
  const pipelineId = store.createPipeline({
    definition: { name: "gate-only", stages: [{ stageId: "gate", kind: "approval" }] },
  });
  store.updateStage({ pipelineId, stageId: "gate", patch: { status: "awaiting" } });

  runNotificationSweep(
    sweepDeps({
      spawnSink: () => ({ ok: true }),
    }),
  );

  expect(
    store.hasNotificationDelivery({
      incidentId: `pipeline:${pipelineId}`,
      transition: "awaiting-approval:gate:default",
    }),
  ).toBe(true);

  const lookupMetrics = instrumentStageAttributedLookups(store);
  const incidents = deriveOperatorIncidents(store);
  // @mutate v2/src/daemon/operator-incidents.ts "onlyDeliveredIncidents(delivered, previewPipelineIncidentKeys(store, pipeline))" -> "!onlyDeliveredIncidents(delivered, previewPipelineIncidentKeys(store, pipeline))"
  expect(incidents).toEqual([]);
  expect(lookupMetrics.read()).toEqual({
    loadRunsByIdsCount: 0,
    findRunsByInvocationIdsCount: 0,
  });
});

test("concurrent sweeps deliver an owed incident once", async () => {
  const pipelineId = store.createPipeline({
    definition: { name: "gate-only", stages: [{ stageId: "gate", kind: "approval" }] },
  });
  store.updateStage({ pipelineId, stageId: "gate", patch: { status: "awaiting" } });

  let spawnCount = 0;
  const deps = sweepDeps({
    spawnSink: (_command, _json) => {
      spawnCount += 1;
      return { ok: true };
    },
  });

  await Promise.all([
    Promise.resolve().then(() => runNotificationSweep(deps)),
    Promise.resolve().then(() => runNotificationSweep(deps)),
  ]);

  expect(spawnCount).toBe(1);
  expect(
    store.hasNotificationDelivery({
      incidentId: `pipeline:${pipelineId}`,
      transition: "awaiting-approval:gate:default",
    }),
  ).toBe(true);
});

test("a sink spawn failure leaves the incident owed and the next sweep retries", () => {
  const pipelineId = store.createPipeline({
    definition: { name: "gate-only", stages: [{ stageId: "gate", kind: "approval" }] },
  });
  store.updateStage({ pipelineId, stageId: "gate", patch: { status: "awaiting" } });

  let attempts = 0;
  const deps = sweepDeps({
    spawnSink: () => {
      attempts += 1;
      return attempts === 1 ? { ok: false } : { ok: true };
    },
  });

  runNotificationSweep(deps);
  expect(
    store.hasNotificationDelivery({
      incidentId: `pipeline:${pipelineId}`,
      transition: "awaiting-approval:gate:default",
    }),
  ).toBe(false);

  runNotificationSweep(deps);
  expect(
    store.hasNotificationDelivery({
      incidentId: `pipeline:${pipelineId}`,
      transition: "awaiting-approval:gate:default",
    }),
  ).toBe(true);
  expect(attempts).toBe(2);
});

test("no sink configured advances the ledger without spawning", () => {
  const pipelineId = store.createPipeline({
    definition: { name: "gate-only", stages: [{ stageId: "gate", kind: "approval" }] },
  });
  store.updateStage({ pipelineId, stageId: "gate", patch: { status: "awaiting" } });

  let spawnCount = 0;
  runNotificationSweep(
    sweepDeps({
      readSinkCommand: () => undefined,
      spawnSink: () => {
        spawnCount += 1;
        return { ok: true };
      },
    }),
  );

  expect(spawnCount).toBe(0);
  expect(
    store.hasNotificationDelivery({
      incidentId: `pipeline:${pipelineId}`,
      transition: "awaiting-approval:gate:default",
    }),
  ).toBe(true);
});

test("deriveOperatorIncidents excludes terminal runs outside the recency bound", () => {
  const { blockedRunId, awaitingPipelineId } = seedActionableDerivationFixtures();

  const incidents = deriveOperatorIncidents(store, DERIVATION_NOW_MS);
  // @mutate v2/src/daemon/operator-incidents.ts "const sinceMs = nowMs - ATTENTION_TERMINAL_RECENCY_MS;" -> "const sinceMs = 0;"
  expect(incidents).toEqual([
    expect.objectContaining({
      kind: "pipeline-awaiting-approval",
      pipelineId: awaitingPipelineId,
    }),
    expect.objectContaining({
      kind: "run-blocked",
      runId: blockedRunId,
    }),
  ]);
});

test("deriveOperatorIncidents store work is unchanged when old terminal history is padded", () => {
  const { blockedRunId, awaitingPipelineId } = seedActionableDerivationFixtures();
  const counter = instrumentIncidentCandidateQueries(store);
  const baselineIncidents = deriveOperatorIncidents(store, DERIVATION_NOW_MS);
  const baselineMetrics = counter.read();
  expect(baselineIncidents.map((incident) => incident.incidentId).sort()).toEqual(
    [`pipeline:${awaitingPipelineId}`, `run:${blockedRunId}`].sort(),
  );

  for (let index = 0; index < 40; index += 1) {
    seedTerminalAdHocRun("failed", DERIVATION_OLD_MS, `inv-padding-${index}`);
  }

  counter.reset();
  const paddedIncidents = deriveOperatorIncidents(store, DERIVATION_NOW_MS);
  const paddedMetrics = counter.read();
  expect(paddedIncidents.map((incident) => incident.incidentId).sort()).toEqual(
    baselineIncidents.map((incident) => incident.incidentId).sort(),
  );
  expect(paddedMetrics).toEqual(baselineMetrics);
});
