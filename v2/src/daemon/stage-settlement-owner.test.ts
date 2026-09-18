import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PipelineDefinition } from "../execution/pipeline-definition.ts";
import { openStateStore, type StateStore, type WorkflowSnapshot } from "../persistence/state-store.ts";
import { removeOrchestrationStore } from "../persistence/state-store-on-disk.ts";
import { hasLiveForeignOwnerSibling, settleOrphanedRunningStages } from "./stage-settlement-owner.ts";

const TEST_DB_PATH = join(tmpdir(), "jarvis-test-stage-settlement-owner.sqlite");
const CURRENT_OWNER = "22222:2000000";
const FOREIGN_OWNER = "33333:3000000";
const OTHER_FOREIGN_OWNER = "44444:4000000";

function singlePlanStagePipeline(name: string): PipelineDefinition {
  return { name, stages: [{ stageId: "plan", kind: "workflow", workflow: "plan", review: "none" }] };
}

function implementSnapshot(invocationId: string): WorkflowSnapshot {
  return { invocationId, steps: [{ stepId: "implement", role: "implement", durable: true }] };
}

function seedRun(store: StateStore, overrides: Partial<Parameters<StateStore["createRun"]>[0]> = {}): string {
  return store.createRun({
    project: "test-project",
    specRef: "main",
    worktreePath: "/tmp/worktree",
    branch: "test-branch",
    specPath: "spec.md",
    ...overrides,
  });
}

/** Legacy rows predate `owner_identity`; simulate one by nulling the column directly. */
function clearRunOwner(dbPath: string, runId: string): void {
  const raw = new Database(dbPath);
  raw.prepare("UPDATE runs SET owner_identity = NULL WHERE id = ?").run(runId);
  raw.close();
}

describe("hasLiveForeignOwnerSibling", () => {
  let store: StateStore;

  beforeEach(() => {
    removeOrchestrationStore(TEST_DB_PATH);
    store = openStateStore(TEST_DB_PATH, { currentIdentity: CURRENT_OWNER });
  });

  afterEach(() => {
    store.close();
  });

  test("no workflow snapshot on the entry run is a no-op", async () => {
    const entryRunId = seedRun(store, { status: "completed" });
    const probeCalls: string[] = [];
    const result = await hasLiveForeignOwnerSibling(
      store,
      entryRunId,
      async (identity) => {
        probeCalls.push(identity);
        return true;
      },
      new Map(),
    );
    expect(result).toBe(false);
    expect(probeCalls).toEqual([]);
  });

  test("a terminal sibling row never blocks, even under a live foreign owner", async () => {
    const snapshot = implementSnapshot("hlfos-terminal-sibling");
    const entryRunId = seedRun(store, { status: "completed", stepId: "implement", workflowSnapshot: snapshot });
    const foreignStore = openStateStore(TEST_DB_PATH, { currentIdentity: FOREIGN_OWNER });
    seedRun(foreignStore, { status: "completed", stepId: "implement~shrink", workflowSnapshot: snapshot });
    foreignStore.close();

    const probeCalls: string[] = [];
    const result = await hasLiveForeignOwnerSibling(
      store,
      entryRunId,
      async (identity) => {
        probeCalls.push(identity);
        return true;
      },
      new Map(),
    );
    expect(result).toBe(false);
    expect(probeCalls).toEqual([]);
  });

  test("a non-terminal sibling row with no owner never blocks", async () => {
    const snapshot = implementSnapshot("hlfos-null-owner");
    const entryRunId = seedRun(store, { status: "completed", stepId: "implement", workflowSnapshot: snapshot });
    const shrinkRunId = seedRun(store, { stepId: "implement~shrink", workflowSnapshot: snapshot });
    clearRunOwner(TEST_DB_PATH, shrinkRunId);

    const probeCalls: string[] = [];
    const result = await hasLiveForeignOwnerSibling(
      store,
      entryRunId,
      async (identity) => {
        probeCalls.push(identity);
        return true;
      },
      new Map(),
    );
    expect(result).toBe(false);
    expect(probeCalls).toEqual([]);
  });

  test("a non-terminal sibling row owned by this store's own identity never blocks", async () => {
    const snapshot = implementSnapshot("hlfos-self-owner");
    const entryRunId = seedRun(store, { status: "completed", stepId: "implement", workflowSnapshot: snapshot });
    seedRun(store, { stepId: "implement~shrink", workflowSnapshot: snapshot });

    const probeCalls: string[] = [];
    const result = await hasLiveForeignOwnerSibling(
      store,
      entryRunId,
      async (identity) => {
        probeCalls.push(identity);
        return true;
      },
      new Map(),
    );
    expect(result).toBe(false);
    expect(probeCalls).toEqual([]);
  });

  test("a non-terminal sibling row owned by a dead foreign identity does not block", async () => {
    const snapshot = implementSnapshot("hlfos-dead-foreign");
    const entryRunId = seedRun(store, { status: "completed", stepId: "implement", workflowSnapshot: snapshot });
    const foreignStore = openStateStore(TEST_DB_PATH, { currentIdentity: FOREIGN_OWNER });
    seedRun(foreignStore, { stepId: "implement~shrink", workflowSnapshot: snapshot });
    foreignStore.close();

    const result = await hasLiveForeignOwnerSibling(store, entryRunId, async () => false, new Map());
    expect(result).toBe(false);
  });

  test("a non-terminal sibling row owned by a live foreign identity blocks", async () => {
    const snapshot = implementSnapshot("hlfos-live-foreign");
    const entryRunId = seedRun(store, { status: "completed", stepId: "implement", workflowSnapshot: snapshot });
    const foreignStore = openStateStore(TEST_DB_PATH, { currentIdentity: FOREIGN_OWNER });
    seedRun(foreignStore, { stepId: "implement~shrink", workflowSnapshot: snapshot });
    foreignStore.close();

    const result = await hasLiveForeignOwnerSibling(store, entryRunId, async () => true, new Map());
    expect(result).toBe(true);
  });

  test("memoizes probe results per identity for the caller's map", async () => {
    const invocationId = "hlfos-memoized";
    const snapshot: WorkflowSnapshot = {
      invocationId,
      steps: [
        { stepId: "implement", role: "implement", durable: true },
        { stepId: "review", role: "review", durable: true },
      ],
    };
    const entryRunId = seedRun(store, { status: "completed", stepId: "implement", workflowSnapshot: snapshot });
    const foreignStore = openStateStore(TEST_DB_PATH, { currentIdentity: FOREIGN_OWNER });
    seedRun(foreignStore, { stepId: "implement~shrink", workflowSnapshot: snapshot });
    seedRun(foreignStore, { stepId: "review~shrink", workflowSnapshot: snapshot });
    foreignStore.close();

    const probeCalls: string[] = [];
    const aliveByIdentity = new Map<string, boolean>();
    const result = await hasLiveForeignOwnerSibling(
      store,
      entryRunId,
      async (identity) => {
        probeCalls.push(identity);
        return true;
      },
      aliveByIdentity,
    );
    expect(result).toBe(true);
    expect(probeCalls).toEqual([FOREIGN_OWNER]);
  });
});

/** Entry run, hidden shrink sibling, and a `running` stage linked to it, all owned by `FOREIGN_OWNER`. */
function seedForeignLiveStage(invocationId: string, pipelineName: string): { entryRunId: string; pipelineId: string } {
  const snapshot = implementSnapshot(invocationId);
  const foreignStore = openStateStore(TEST_DB_PATH, { currentIdentity: FOREIGN_OWNER });
  const entryRunId = seedRun(foreignStore, { status: "completed", stepId: "implement", workflowSnapshot: snapshot });
  seedRun(foreignStore, { stepId: "implement~shrink", workflowSnapshot: snapshot });
  const pipelineId = foreignStore.createPipeline({ definition: singlePlanStagePipeline(pipelineName) });
  foreignStore.updateStage({
    pipelineId,
    stageId: "plan",
    patch: { status: "running", workflowInvocationId: entryRunId, startedAt: 100 },
  });
  foreignStore.close();
  return { entryRunId, pipelineId };
}

describe("settleOrphanedRunningStages foreign-owner liveness gate", () => {
  beforeEach(() => {
    removeOrchestrationStore(TEST_DB_PATH);
  });

  test("leaves a stage running while its hidden shrink sibling is live under a foreign owner", async () => {
    const { pipelineId } = seedForeignLiveStage("sows-foreign-live", "foreign-live");

    const store = openStateStore(TEST_DB_PATH, { currentIdentity: CURRENT_OWNER });
    try {
      const settled = await settleOrphanedRunningStages(
        { store, isEntryRunLive: () => false },
        undefined,
        async () => true,
      );
      expect(settled).toEqual([]);
      const stage = store.loadPipeline(pipelineId)?.stages.find((s) => s.stageId === "plan");
      expect(stage?.status).toBe("running");
    } finally {
      store.close();
    }
  });

  test("settles the stage once the foreign owner identity is dead", async () => {
    const { entryRunId, pipelineId } = seedForeignLiveStage("sows-foreign-dead", "foreign-dead");

    const store = openStateStore(TEST_DB_PATH, { currentIdentity: CURRENT_OWNER });
    try {
      const settled = await settleOrphanedRunningStages(
        { store, isEntryRunLive: () => false },
        undefined,
        async () => false,
      );
      expect(settled).toEqual([entryRunId]);
      const stage = store.loadPipeline(pipelineId)?.stages.find((s) => s.stageId === "plan");
      expect(stage?.status).toBe("succeeded");
    } finally {
      store.close();
    }
  });

  test("a non-terminal sibling row owned by this daemon's own identity does not block settlement", async () => {
    const snapshot = implementSnapshot("sows-self-owner");
    const store = openStateStore(TEST_DB_PATH, { currentIdentity: CURRENT_OWNER });
    try {
      const entryRunId = seedRun(store, { status: "completed", stepId: "implement", workflowSnapshot: snapshot });
      seedRun(store, { stepId: "implement~shrink", workflowSnapshot: snapshot });
      const pipelineId = store.createPipeline({ definition: singlePlanStagePipeline("self-owner") });
      store.updateStage({
        pipelineId,
        stageId: "plan",
        patch: { status: "running", workflowInvocationId: entryRunId, startedAt: 100 },
      });

      const settled = await settleOrphanedRunningStages({ store, isEntryRunLive: () => false }, undefined, async () => {
        throw new Error("probe must not be called for a self-owned sibling");
      });
      expect(settled).toEqual([entryRunId]);
      const stage = store.loadPipeline(pipelineId)?.stages.find((s) => s.stageId === "plan");
      expect(stage?.status).toBe("succeeded");
    } finally {
      store.close();
    }
  });

  test("re-reads a stage's row immediately before settling, so a status change mid-sweep is not double-processed", async () => {
    const store = openStateStore(TEST_DB_PATH, { currentIdentity: CURRENT_OWNER });
    const foreignStoreA = openStateStore(TEST_DB_PATH, { currentIdentity: FOREIGN_OWNER });
    const foreignStoreB = openStateStore(TEST_DB_PATH, { currentIdentity: OTHER_FOREIGN_OWNER });
    try {
      const snapshotA = implementSnapshot("sows-reread-a");
      const snapshotB = implementSnapshot("sows-reread-b");
      const entryRunA = seedRun(store, { status: "completed", stepId: "implement", workflowSnapshot: snapshotA });
      seedRun(foreignStoreA, { stepId: "implement~shrink", workflowSnapshot: snapshotA });
      const entryRunB = seedRun(store, { status: "completed", stepId: "implement", workflowSnapshot: snapshotB });
      seedRun(foreignStoreB, { stepId: "implement~shrink", workflowSnapshot: snapshotB });

      const pipelineA = store.createPipeline({ definition: singlePlanStagePipeline("reread-a") });
      store.updateStage({
        pipelineId: pipelineA,
        stageId: "plan",
        patch: { status: "running", workflowInvocationId: entryRunA, startedAt: 100 },
      });
      const pipelineB = store.createPipeline({ definition: singlePlanStagePipeline("reread-b") });
      store.updateStage({
        pipelineId: pipelineB,
        stageId: "plan",
        patch: { status: "running", workflowInvocationId: entryRunB, startedAt: 100 },
      });

      const probeCalls: string[] = [];
      // Simulates a concurrent writer changing pipeline B's stage mid-sweep, during the await for
      // pipeline A's foreign-owner probe call.
      const settled = await settleOrphanedRunningStages(
        { store, isEntryRunLive: () => false },
        undefined,
        async (identity) => {
          probeCalls.push(identity);
          store.updateStage({
            pipelineId: pipelineB,
            stageId: "plan",
            patch: { status: "failed", endedAt: Date.now(), failureDetail: { message: "concurrent externally" } },
          });
          return false;
        },
      );

      expect(settled).toEqual([entryRunA]);
      // Pipeline B's stage was already moved off `running` by the time the sweep reached it, so its
      // own foreign-owner gate check (and thus its probe call) never runs.
      expect(probeCalls).toEqual([FOREIGN_OWNER]);
      const stageB = store.loadPipeline(pipelineB)?.stages.find((s) => s.stageId === "plan");
      expect(stageB?.status).toBe("failed");
      expect(stageB?.failureDetail).toEqual({ message: "concurrent externally" });
    } finally {
      store.close();
      foreignStoreA.close();
      foreignStoreB.close();
    }
  });
});
