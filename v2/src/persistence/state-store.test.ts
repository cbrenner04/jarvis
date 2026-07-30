import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PipelineContext } from "../daemon/pipeline-stage-resolve.ts";
import type { PipelineDefinition } from "../execution/pipeline-definition.ts";
import {
  analyzeFailedPipelineReopenShape,
  isOwnerAlive,
  isStageReconciliationStable,
  openStateStore,
  type OwnerLivenessProbe,
  type StateStore,
} from "./state-store";
import { removeOrchestrationStore } from "./state-store-on-disk";

const TEST_DB_PATH = join(tmpdir(), "jarvis-test-state.sqlite");

const SAMPLE_PIPELINE_DEFINITION: PipelineDefinition = {
  name: "sample-pipeline",
  stages: [
    { stageId: "plan", kind: "workflow", workflow: "plan", review: "none" },
    { stageId: "gate", kind: "approval" },
    { stageId: "implement", kind: "workflow", workflow: "implement", review: "light" },
  ],
};

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

function loadRunOrThrow(store: StateStore, runId: string): NonNullable<ReturnType<StateStore["loadRun"]>> {
  const run = store.loadRun(runId);
  if (!run) throw new Error("Run should exist");
  return run;
}

describe("StateStore", () => {
  let store: StateStore;

  beforeEach(() => {
    removeOrchestrationStore(TEST_DB_PATH);
    store = openStateStore(TEST_DB_PATH);
  });

  afterEach(() => {
    store.close();
    removeOrchestrationStore(TEST_DB_PATH);
  });

  test("creates a run with correct fields", () => {
    const runId = seedRun(store);

    const run = loadRunOrThrow(store, runId);
    expect(run.id).toBe(runId);
    expect(run.project).toBe("test-project");
    expect(run.specRef).toBe("main");
    expect(run.worktreePath).toBe("/tmp/worktree");
    expect(run.branch).toBe("test-branch");
    expect(run.specPath).toBe("spec.md");
    expect(run.status).toBe("in-progress");
    expect(run.attemptCount).toBe(0);
    expect(run.createdAt).toBeGreaterThan(0);
    expect(run.attempts).toEqual([]);
  });

  test("schema bootstrap is idempotent on re-open", () => {
    const runId = seedRun(store);
    store.close();

    store = openStateStore(TEST_DB_PATH);
    expect(loadRunOrThrow(store, runId).project).toBe("test-project");
  });

  test("records attempt start with correct fields", () => {
    const runId = seedRun(store);

    const attemptId = store.recordAttemptStart(runId);

    const run = loadRunOrThrow(store, runId);
    expect(run.attempts).toHaveLength(1);
    const attempt = run.attempts[0];
    expect(attempt?.id).toBe(attemptId);
    expect(attempt?.attemptNumber).toBe(1);
    expect(attempt?.status).toBe("in-progress");
    expect(attempt?.outcomeKind).toBeNull();
    expect(attempt?.startedAt).toBeGreaterThan(0);
  });

  test("commit boundary persists attempt completion and outcome", () => {
    const runId = seedRun(store);
    const attemptId = store.recordAttemptStart(runId);

    store.commitCompletionBoundary({ attemptId, runStatus: "completed", outcomeKind: "done" });

    const run = loadRunOrThrow(store, runId);
    expect(run.attempts[0]?.status).toBe("completed");
    expect(run.attempts[0]?.outcomeKind).toBe("done");
    expect(run.status).toBe("completed");
    expect(run.attemptCount).toBe(1);
  });

  test("commit boundary rolls back attempt, outcome, and run checkpoint on mid-boundary failure", () => {
    const runId = seedRun(store);
    const attemptId = store.recordAttemptStart(runId);

    expect(() =>
      store.commitCompletionBoundary({
        attemptId,
        runStatus: "completed",
        outcomeKind: "done",
        beforeRunUpdate: () => {
          throw new Error("forced mid-boundary failure");
        },
      }),
    ).toThrow("forced mid-boundary failure");

    const run = loadRunOrThrow(store, runId);
    expect(run.attemptCount).toBe(0);
    expect(run.status).toBe("in-progress");
    expect(run.attempts[0]?.status).toBe("in-progress");
    expect(run.attempts[0]?.outcomeKind).toBeNull();
  });

  test("re-committing a finished boundary is idempotent", () => {
    const runId = seedRun(store);
    const attemptId = store.recordAttemptStart(runId);

    store.commitCompletionBoundary({ attemptId, runStatus: "completed", outcomeKind: "done" });
    store.commitCompletionBoundary({ attemptId, runStatus: "completed", outcomeKind: "done" });

    const run = loadRunOrThrow(store, runId);
    expect(run.attemptCount).toBe(1);
    expect(run.attempts[0]?.status).toBe("completed");
    expect(run.attempts[0]?.outcomeKind).toBe("done");
  });

  test("multiple attempts on a run are recorded correctly", () => {
    const runId = seedRun(store);

    const attempt1Id = store.recordAttemptStart(runId);
    store.commitCompletionBoundary({ attemptId: attempt1Id, runStatus: "in-progress", outcomeKind: "no-work" });
    const attempt2Id = store.recordAttemptStart(runId);
    store.commitCompletionBoundary({ attemptId: attempt2Id, runStatus: "completed", outcomeKind: "done" });

    const run = loadRunOrThrow(store, runId);
    expect(run.attempts).toHaveLength(2);
    expect(run.attempts[0]?.attemptNumber).toBe(1);
    expect(run.attempts[1]?.attemptNumber).toBe(2);
    expect(run.attempts[0]?.outcomeKind).toBe("no-work");
    expect(run.attempts[1]?.outcomeKind).toBe("done");
    expect(run.status).toBe("completed");
    expect(run.attemptCount).toBe(2);
  });

  test("commit boundary persists invocation_failure_detail only for binding-chain failures", () => {
    const runId = seedRun(store);
    const withDetail = store.recordAttemptStart(runId);
    store.commitCompletionBoundary({
      attemptId: withDetail,
      runStatus: "failed",
      outcomeKind: "invocation_failure",
      invocationFailureDetail: {
        failureKind: "error",
        bindingAttempts: [{ bindingId: "sim.1", resultKind: "error" }],
      },
    });

    const withoutDetail = store.recordAttemptStart(runId);
    store.commitCompletionBoundary({ attemptId: withoutDetail, runStatus: "failed", outcomeKind: "invalid_token" });

    const run = loadRunOrThrow(store, runId);
    expect(run.attempts[0]?.invocationFailureDetail).toEqual({
      failureKind: "error",
      bindingAttempts: [{ bindingId: "sim.1", resultKind: "error" }],
    });
    expect(run.attempts[1]?.invocationFailureDetail).toBeNull();
  });

  test("schema migration is idempotent on re-open", () => {
    seedRun(store);
    store.close();

    store = openStateStore(TEST_DB_PATH);
    const runId = seedRun(store);
    const attemptId = store.recordAttemptStart(runId);
    store.commitCompletionBoundary({
      attemptId,
      runStatus: "failed",
      outcomeKind: "invocation_failure",
      invocationFailureDetail: { failureKind: "quota", bindingAttempts: [] },
    });
    expect(loadRunOrThrow(store, runId).attempts[0]?.invocationFailureDetail?.failureKind).toBe("quota");
  });

  test("finds the latest run by project and branch even when specRef and worktree differ", () => {
    const olderRunId = seedRun(store, { specRef: "old-ref", worktreePath: "/tmp/worktree-a", specPath: "spec-a.md" });
    const newerRunId = seedRun(store, { specRef: "new-ref", worktreePath: "/tmp/worktree-b", specPath: "spec-b.md" });
    seedRun(store, { specRef: "other-ref", worktreePath: "/tmp/worktree-c", branch: "other-branch" });

    const run = store.findRunByProjectBranch({ project: "test-project", branch: "test-branch", stepId: null });

    expect(run?.id).toBe(newerRunId);
    expect(run?.id).not.toBe(olderRunId);
    expect(run?.specRef).toBe("new-ref");
    expect(run?.worktreePath).toBe("/tmp/worktree-b");
  });

  test("loadRun returns the run's stepId when set", () => {
    const runId = seedRun(store, { stepId: "step-1" });

    const run = loadRunOrThrow(store, runId);
    expect(run.stepId).toBe("step-1");
  });

  test("loadRun returns the run's workflow snapshot when set", () => {
    const workflowSnapshot = {
      invocationId: "workflow-1",
      steps: [
        { stepId: "step-1", role: "implement" },
        { stepId: "step-2", role: "review" },
      ],
    };
    const runId = seedRun(store, { stepId: "step-1", workflowSnapshot });

    const run = loadRunOrThrow(store, runId);
    expect(run.workflowSnapshot).toEqual(workflowSnapshot);
  });

  test("loadRun retains implement reviewPasses on the workflow snapshot", () => {
    const withZero = {
      invocationId: "workflow-implement-0",
      reviewPasses: 0,
      reviewBehavior: "debate" as const,
      steps: [{ stepId: "implement", role: "implement" }],
    };
    const withPositive = {
      invocationId: "workflow-implement-2",
      reviewPasses: 2,
      reviewBehavior: "light" as const,
      steps: [
        { stepId: "implement", role: "implement" },
        { stepId: "implement-review", role: "", behavior: "review-debate" as const },
      ],
    };
    const runZeroId = seedRun(store, { stepId: "implement", workflowSnapshot: withZero });
    const runPositiveId = seedRun(store, {
      stepId: "implement",
      branch: "review-branch",
      workflowSnapshot: withPositive,
    });

    expect(loadRunOrThrow(store, runZeroId).workflowSnapshot).toEqual(withZero);
    expect(loadRunOrThrow(store, runPositiveId).workflowSnapshot).toEqual(withPositive);
  });

  test("loadRun returns undefined/null for stepId when not set", () => {
    const runId = seedRun(store);

    const run = loadRunOrThrow(store, runId);
    expect(run.stepId === null || run.stepId === undefined).toBe(true);
  });

  test("two createRun calls with same (project, branch) but different stepId are independently resolvable", () => {
    const run1Id = seedRun(store, { stepId: "step-1" });
    const run2Id = seedRun(store, { stepId: "step-2" });

    const run1 = store.findRunByProjectBranch({ project: "test-project", branch: "test-branch", stepId: "step-1" });
    const run2 = store.findRunByProjectBranch({ project: "test-project", branch: "test-branch", stepId: "step-2" });

    expect(run1?.id).toBe(run1Id);
    expect(run2?.id).toBe(run2Id);
    expect(run1?.id).not.toBe(run2?.id);
  });

  test("findRunByProjectBranch with stepId does not return a run with different stepId", () => {
    seedRun(store, { stepId: "step-1" });
    seedRun(store, { stepId: "step-2" });

    const run = store.findRunByProjectBranch({ project: "test-project", branch: "test-branch", stepId: "step-1" });

    expect(run?.stepId).toBe("step-1");
  });

  test("findRunByProjectBranch with explicit null stepId returns latest no-step run", () => {
    const runWithStepId = seedRun(store, { stepId: "step-1" });
    const runWithoutStepId1 = seedRun(store);
    const runWithoutStepId2 = seedRun(store);

    const run = store.findRunByProjectBranch({ project: "test-project", branch: "test-branch", stepId: null });

    expect(run?.id).toBe(runWithoutStepId2);
    expect(run?.id).not.toBe(runWithStepId);
    expect(run?.id).not.toBe(runWithoutStepId1);
    expect(run?.stepId === null || run?.stepId === undefined).toBe(true);
  });

  test("a run created before migration (NULL step_id) still resolves with explicit null stepId", () => {
    const runId = seedRun(store);
    store.close();

    store = openStateStore(TEST_DB_PATH);
    const run = store.findRunByProjectBranch({ project: "test-project", branch: "test-branch", stepId: null });

    expect(run?.id).toBe(runId);
    expect(run?.stepId === null || run?.stepId === undefined).toBe(true);
  });

  test("migration adds owner_identity to a pre-migration database without backfilling existing rows", () => {
    const legacyDbPath = join(tmpdir(), "jarvis-test-state-legacy-migration.sqlite");
    removeOrchestrationStore(legacyDbPath);
    try {
      const raw = new Database(legacyDbPath);
      raw.exec(`
        CREATE TABLE runs (
          id TEXT PRIMARY KEY,
          project TEXT NOT NULL,
          spec_ref TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          status TEXT NOT NULL,
          attempt_count INTEGER NOT NULL DEFAULT 0,
          worktree_path TEXT NOT NULL,
          branch TEXT NOT NULL,
          spec_path TEXT NOT NULL,
          step_id TEXT,
          workflow_snapshot TEXT,
          queued_input TEXT,
          creation_title TEXT,
          reconciliation_pending INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE attempts (
          id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL,
          attempt_number INTEGER NOT NULL,
          started_at INTEGER NOT NULL,
          status TEXT NOT NULL,
          outcome_kind TEXT,
          completed_at INTEGER,
          invocation_failure_detail TEXT,
          completion_agent TEXT,
          FOREIGN KEY (run_id) REFERENCES runs(id)
        );
        CREATE TABLE _migrations (
          id TEXT PRIMARY KEY,
          applied_at INTEGER NOT NULL
        );
      `);
      for (const id of [
        "004-invocation-failure-detail",
        "005-run-step-id",
        "006-run-workflow-snapshot",
        "007-run-queued-input",
        "008-attempt-completion-agent",
        "009-run-creation-title",
        "010-run-reconciliation-pending",
      ]) {
        raw.prepare("INSERT INTO _migrations (id, applied_at) VALUES (?, ?)").run(id, Date.now());
      }
      const runId = "legacy-run";
      raw
        .prepare(
          `INSERT INTO runs (id, project, spec_ref, created_at, status, attempt_count, worktree_path, branch, spec_path)
           VALUES (?, 'legacy-project', 'main', ?, 'in-progress', 0, '/tmp/legacy', 'legacy-branch', 'spec.md')`,
        )
        .run(runId, Date.now());
      raw.close();

      const migrated = openStateStore(legacyDbPath);
      expect(loadRunOrThrow(migrated, runId).project).toBe("legacy-project");

      const verify = new Database(legacyDbPath);
      const row = verify.prepare("SELECT owner_identity AS ownerIdentity FROM runs WHERE id = ?").get(runId) as {
        ownerIdentity: string | null;
      };
      expect(row.ownerIdentity).toBeNull();
      verify.close();
      migrated.close();
    } finally {
      removeOrchestrationStore(legacyDbPath);
    }
  });

  test("findRunsByInvocationId returns all runs with matching invocationId", () => {
    const snapshot = { invocationId: "inv-123", steps: [{ stepId: "step-1", role: "implement" }] };
    const run1Id = seedRun(store, { stepId: "step-1", workflowSnapshot: snapshot });
    const run2Id = seedRun(store, { stepId: "step-2", workflowSnapshot: snapshot, branch: "branch-2" });
    seedRun(store, { stepId: "step-3", workflowSnapshot: { invocationId: "inv-456", steps: [] } });

    const runs = store.findRunsByInvocationId("inv-123");

    expect(runs.map((r) => r.id).sort()).toEqual([run1Id, run2Id].sort());
  });

  test("findRunsByInvocationId returns empty when no runs have that invocationId", () => {
    seedRun(store, { stepId: "step-1", workflowSnapshot: { invocationId: "inv-123", steps: [] } });

    const runs = store.findRunsByInvocationId("inv-999");

    expect(runs).toEqual([]);
  });

  test("findRunsByInvocationId excludes runs without a workflowSnapshot", () => {
    const snapshot = { invocationId: "inv-123", steps: [{ stepId: "step-1", role: "implement" }] };
    const run1Id = seedRun(store, { stepId: "step-1", workflowSnapshot: snapshot });
    seedRun(store, { stepId: "step-2", branch: "branch-2" });

    const runs = store.findRunsByInvocationId("inv-123");

    expect(runs.map((r) => r.id)).toEqual([run1Id]);
  });

  test("findRunsByInvocationId returns runs in creation order", () => {
    const snapshot = { invocationId: "inv-123", steps: [] };
    const run1Id = seedRun(store, { stepId: "step-1", workflowSnapshot: snapshot });
    const run2Id = seedRun(store, { stepId: "step-2", workflowSnapshot: snapshot, branch: "branch-2" });
    const run3Id = seedRun(store, { stepId: "step-3", workflowSnapshot: snapshot, branch: "branch-3" });

    const runs = store.findRunsByInvocationId("inv-123");

    expect(runs.map((r) => r.id)).toEqual([run1Id, run2Id, run3Id]);
  });
});

describe("commitGuardedKill", () => {
  let store: StateStore;

  beforeEach(() => {
    removeOrchestrationStore(TEST_DB_PATH);
    store = openStateStore(TEST_DB_PATH);
  });

  afterEach(() => {
    store.close();
    removeOrchestrationStore(TEST_DB_PATH);
  });

  test("sets killed for non-boundary-terminal statuses", () => {
    for (const status of ["in-progress", "paused", "queued"] as const) {
      const runId = seedRun(store, { status, branch: `branch-${status}` });
      store.commitGuardedKill(runId);
      expect(loadRunOrThrow(store, runId).status).toBe("killed");
    }
  });

  test("preserves boundary-terminal statuses", () => {
    for (const status of ["completed", "blocked", "failed"] as const) {
      const runId = seedRun(store, { status, branch: `branch-${status}` });
      store.commitGuardedKill(runId);
      expect(loadRunOrThrow(store, runId).status).toBe(status);
    }
  });

  test("a completion boundary committed after kill wins over the kill write", () => {
    const runId = seedRun(store);
    const attemptId = store.recordAttemptStart(runId);
    store.commitGuardedKill(runId);
    expect(loadRunOrThrow(store, runId).status).toBe("killed");

    store.commitCompletionBoundary({ attemptId, runStatus: "blocked", outcomeKind: "blocked" });
    expect(loadRunOrThrow(store, runId).status).toBe("blocked");
  });
});

function insertStageRow(
  raw: Database,
  args: { id: string; pipelineId: string; stageId: string; position: number },
): void {
  raw
    .prepare(
      `INSERT INTO pipeline_stages (id, pipeline_id, stage_id, position, status, workflow_invocation_id, started_at, ended_at, artifact, failure_detail)
       VALUES (?, ?, ?, ?, 'pending', NULL, NULL, NULL, NULL, NULL)`,
    )
    .run(args.id, args.pipelineId, args.stageId, args.position);
}

describe("pipelines", () => {
  let store: StateStore;

  beforeEach(() => {
    removeOrchestrationStore(TEST_DB_PATH);
    store = openStateStore(TEST_DB_PATH);
  });

  afterEach(() => {
    store.close();
    removeOrchestrationStore(TEST_DB_PATH);
  });

  test("admits a validated multi-stage definition and reads one pending stage per authored stage in order", () => {
    const pipelineId = store.createPipeline({ definition: SAMPLE_PIPELINE_DEFINITION });

    const pipeline = store.loadPipeline(pipelineId);
    if (!pipeline) throw new Error("Pipeline should exist");

    expect(pipeline.id).toBe(pipelineId);
    expect(pipeline.name).toBe("sample-pipeline");
    expect(pipeline.createdAt).toBeGreaterThan(0);
    expect(pipeline.stages).toHaveLength(3);
    expect(pipeline.stages.map((stage) => stage.stageId)).toEqual(["plan", "gate", "implement"]);
    for (const stage of pipeline.stages) {
      expect(stage.pipelineId).toBe(pipelineId);
      expect(stage.status).toBe("pending");
      expect(stage.workflowInvocationId).toBeNull();
      expect(stage.startedAt).toBeNull();
      expect(stage.endedAt).toBeNull();
      expect(stage.artifact).toBeNull();
      expect(stage.failureDetail).toBeNull();
    }
    expect(pipeline.stages.map((stage) => stage.position)).toEqual([0, 1, 2]);
  });

  test("retains the admitted definition name and snapshot after the live source definition is mutated, and stamps owner/status at admission", () => {
    const definition: PipelineDefinition = {
      name: "mutable-source",
      stages: [{ stageId: "plan", kind: "workflow", workflow: "plan", review: "none" }],
    };
    const pipelineId = store.createPipeline({ definition });

    // Mutate the caller's definition object after admission.
    definition.name = "changed-name";
    definition.stages.push({ stageId: "extra", kind: "approval" });

    const pipeline = store.loadPipeline(pipelineId);
    if (!pipeline) throw new Error("Pipeline should exist");

    expect(pipeline.name).toBe("mutable-source");
    expect(pipeline.definition).toEqual({
      name: "mutable-source",
      stages: [{ stageId: "plan", kind: "workflow", workflow: "plan", review: "none" }],
    });
    expect(pipeline.stages).toHaveLength(1);
    expect(pipeline.status).toBe("active");
    expect(pipeline.ownerIdentity).not.toBeNull();
  });

  test("preserves an immutable admitted context snapshot across close and reopen", () => {
    const context: PipelineContext = {
      cwd: "/repo",
      configPath: "/repo/jarvis.json",
      targetDir: "v2/spec",
      projectRegistry: {
        jarvis: { root: "/repo", origin: "git@github.com:owner/jarvis.git" },
      },
      seed: "ship durable pipelines",
    };
    const pipelineId = store.createPipeline({ definition: SAMPLE_PIPELINE_DEFINITION, context });

    context.cwd = "/mutated";
    context.seed = "changed";
    context.projectRegistry!.jarvis!.root = "/mutated";
    context.projectRegistry!.extra = { root: "/extra" };
    store.close();

    store = openStateStore(TEST_DB_PATH);
    expect(store.loadPipeline(pipelineId)?.context).toEqual({
      cwd: "/repo",
      configPath: "/repo/jarvis.json",
      targetDir: "v2/spec",
      projectRegistry: {
        jarvis: { root: "/repo", origin: "git@github.com:owner/jarvis.git" },
      },
      seed: "ship durable pipelines",
    });
  });

  test("a deterministic fault after a prior stage insert rolls back the pipeline and all its stages", () => {
    expect(() =>
      store.createPipeline({
        definition: SAMPLE_PIPELINE_DEFINITION,
        beforeStageInsert: (stageIndex) => {
          if (stageIndex === 1) throw new Error("forced mid-admission failure");
        },
      }),
    ).toThrow("forced mid-admission failure");

    const raw = new Database(TEST_DB_PATH);
    try {
      const pipelineCount = raw.prepare("SELECT COUNT(*) AS total FROM pipelines").get() as { total: number };
      const stageCount = raw.prepare("SELECT COUNT(*) AS total FROM pipeline_stages").get() as { total: number };
      expect(pipelineCount.total).toBe(0);
      expect(stageCount.total).toBe(0);
    } finally {
      raw.close();
    }
  });

  test("rejects a stage row whose parent pipeline is absent, via the store's own connection", () => {
    expect(() =>
      store.createPipeline({
        definition: SAMPLE_PIPELINE_DEFINITION,
        beforeStageInsert: () => {
          throw new Error("forced abort to leave no admitted pipeline");
        },
      }),
    ).toThrow();

    // Drive the orphan insert through the store's own handle so a store that stops
    // enabling `PRAGMA foreign_keys` would fail this assertion.
    expect(() =>
      (store as unknown as { db: Database }).db
        .prepare(
          `INSERT INTO pipeline_stages (id, pipeline_id, stage_id, position, status, workflow_invocation_id, started_at, ended_at, artifact, failure_detail)
           VALUES (?, ?, ?, ?, 'pending', NULL, NULL, NULL, NULL, NULL)`,
        )
        .run("stage-orphan", "missing-pipeline", "plan", 0),
    ).toThrow();
  });

  test("rejects duplicate stage IDs and duplicate authored positions within one pipeline", () => {
    const pipelineId = store.createPipeline({
      definition: {
        name: "dup-check",
        stages: [{ stageId: "plan", kind: "workflow", workflow: "plan", review: "none" }],
      },
    });

    const raw = new Database(TEST_DB_PATH);
    try {
      expect(() => insertStageRow(raw, { id: "stage-dup-id", pipelineId, stageId: "plan", position: 1 })).toThrow();

      expect(() =>
        insertStageRow(raw, { id: "stage-dup-position", pipelineId, stageId: "other", position: 0 }),
      ).toThrow();
    } finally {
      raw.close();
    }
  });

  test("preserves ordering by stored position rather than insertion order", () => {
    const pipelineId = store.createPipeline({ definition: SAMPLE_PIPELINE_DEFINITION });

    const raw = new Database(TEST_DB_PATH);
    try {
      raw
        .prepare("UPDATE pipeline_stages SET position = 99 WHERE pipeline_id = ? AND stage_id = 'plan'")
        .run(pipelineId);
      raw
        .prepare("UPDATE pipeline_stages SET position = -1 WHERE pipeline_id = ? AND stage_id = 'implement'")
        .run(pipelineId);
    } finally {
      raw.close();
    }

    const pipeline = store.loadPipeline(pipelineId);
    if (!pipeline) throw new Error("Pipeline should exist");
    expect(pipeline.stages.map((stage) => stage.stageId)).toEqual(["implement", "gate", "plan"]);
  });

  test("loadPipeline returns null for an unknown pipeline ID", () => {
    expect(store.loadPipeline("unknown-pipeline")).toBeNull();
  });

  test("approval awaiting and decisions survive reopen under the same durable and authored identities", () => {
    const awaitingPipelineId = store.createPipeline({ definition: SAMPLE_PIPELINE_DEFINITION });
    const approvedPipelineId = store.createPipeline({ definition: SAMPLE_PIPELINE_DEFINITION });
    const rejectedPipelineId = store.createPipeline({ definition: SAMPLE_PIPELINE_DEFINITION });
    const targets = [awaitingPipelineId, approvedPipelineId, rejectedPipelineId].map((pipelineId) => {
      const stage = store.loadPipeline(pipelineId)?.stages.find((candidate) => candidate.stageId === "gate");
      if (!stage) throw new Error("gate stage should exist");
      expect(store.markApprovalAwaiting({ stageRecordId: stage.id, stageId: stage.stageId })).toEqual({
        outcome: "applied",
        stageRecordId: stage.id,
        reason: "marked-awaiting",
        status: "awaiting",
      });
      return { pipelineId, stageRecordId: stage.id, authoredStageId: stage.stageId };
    });

    const approved = targets[1];
    const rejected = targets[2];
    if (!approved || !rejected) throw new Error("decision targets should exist");
    expect(
      store.decideApproval({
        stageRecordId: approved.stageRecordId,
        stageId: approved.authoredStageId,
        decision: "approved",
      }),
    ).toMatchObject({ outcome: "applied", status: "approved" });
    expect(
      store.decideApproval({
        stageRecordId: rejected.stageRecordId,
        stageId: rejected.authoredStageId,
        decision: "rejected",
      }),
    ).toMatchObject({ outcome: "applied", status: "rejected" });
    store.close();

    store = openStateStore(TEST_DB_PATH);
    for (const [index, expectedStatus] of ["awaiting", "approved", "rejected"].entries()) {
      const target = targets[index];
      if (!target) throw new Error("approval target should exist");
      const reopened = store
        .loadPipeline(target.pipelineId)
        ?.stages.find((candidate) => candidate.id === target.stageRecordId);
      expect(reopened?.id).toBe(target.stageRecordId);
      expect(reopened?.stageId).toBe(target.authoredStageId);
      expect(reopened?.status).toBe(expectedStatus);
    }
  });

  test("approval boundary applies only to its matching pending approval row", () => {
    const pipelineId = store.createPipeline({ definition: SAMPLE_PIPELINE_DEFINITION });
    const pipeline = store.loadPipeline(pipelineId);
    if (!pipeline) throw new Error("pipeline should exist");
    const plan = pipeline.stages.find((stage) => stage.stageId === "plan");
    const gate = pipeline.stages.find((stage) => stage.stageId === "gate");
    if (!plan || !gate) throw new Error("pipeline stages should exist");

    const refusedCases = [
      {
        args: { stageRecordId: "missing-stage", stageId: "gate" },
        reason: "stage-not-found",
      },
      {
        args: { stageRecordId: gate.id, stageId: "other-gate" },
        reason: "stage-id-mismatch",
      },
      {
        args: { stageRecordId: plan.id, stageId: plan.stageId },
        reason: "stage-not-approval",
      },
    ] as const;
    for (const refusedCase of refusedCases) {
      const before = store.loadPipeline(pipelineId);
      expect(store.markApprovalAwaiting(refusedCase.args)).toEqual({
        outcome: "refused",
        stageRecordId: refusedCase.args.stageRecordId,
        reason: refusedCase.reason,
      });
      expect(store.loadPipeline(pipelineId)).toEqual(before);
    }

    expect(store.markApprovalAwaiting({ stageRecordId: gate.id, stageId: gate.stageId })).toEqual({
      outcome: "applied",
      stageRecordId: gate.id,
      reason: "marked-awaiting",
      status: "awaiting",
    });
    const afterApplied = store.loadPipeline(pipelineId);
    expect(store.markApprovalAwaiting({ stageRecordId: gate.id, stageId: gate.stageId })).toEqual({
      outcome: "refused",
      stageRecordId: gate.id,
      reason: "stage-not-pending",
    });
    expect(store.loadPipeline(pipelineId)).toEqual(afterApplied);
  });

  test("approval decisions are stage-scoped, guarded, and first-writer-wins across store handles", () => {
    const pipelineId = store.createPipeline({ definition: SAMPLE_PIPELINE_DEFINITION });
    const pipeline = store.loadPipeline(pipelineId);
    if (!pipeline) throw new Error("pipeline should exist");
    const gate = pipeline.stages.find((stage) => stage.stageId === "gate");
    if (!gate) throw new Error("gate stage should exist");

    const pendingSnapshot = store.loadPipeline(pipelineId);
    expect(
      store.decideApproval({ stageRecordId: gate.id, stageId: gate.stageId, decision: "approved" }),
    ).toEqual({
      outcome: "refused",
      stageRecordId: gate.id,
      reason: "stage-not-awaiting",
    });
    expect(store.loadPipeline(pipelineId)).toEqual(pendingSnapshot);

    store.markApprovalAwaiting({ stageRecordId: gate.id, stageId: gate.stageId });
    const awaitingSnapshot = store.loadPipeline(pipelineId);
    expect(store.decideApproval({ stageRecordId: gate.id, stageId: gate.stageId, decision: "maybe" })).toEqual({
      outcome: "refused",
      stageRecordId: gate.id,
      reason: "invalid-decision",
    });
    expect(store.loadPipeline(pipelineId)).toEqual(awaitingSnapshot);
    expect(store.decideApproval({ stageRecordId: gate.id, stageId: "wrong-gate", decision: "rejected" })).toEqual({
      outcome: "refused",
      stageRecordId: gate.id,
      reason: "stage-id-mismatch",
    });
    expect(store.loadPipeline(pipelineId)).toEqual(awaitingSnapshot);

    const competingStore = openStateStore(TEST_DB_PATH);
    try {
      const outcomes = [
        store.decideApproval({ stageRecordId: gate.id, stageId: gate.stageId, decision: "approved" }),
        competingStore.decideApproval({ stageRecordId: gate.id, stageId: gate.stageId, decision: "rejected" }),
      ];
      expect(outcomes.filter((outcome) => outcome.outcome === "applied")).toHaveLength(1);
      expect(outcomes.filter((outcome) => outcome.outcome === "refused")).toEqual([
        {
          outcome: "refused",
          stageRecordId: gate.id,
          reason: "stage-not-awaiting",
        },
      ]);

      const decidedSnapshot = store.loadPipeline(pipelineId);
      expect(decidedSnapshot?.stages.find((stage) => stage.id === gate.id)?.status).toBe("approved");
      expect(
        competingStore.decideApproval({ stageRecordId: gate.id, stageId: gate.stageId, decision: "approved" }),
      ).toEqual({
        outcome: "refused",
        stageRecordId: gate.id,
        reason: "stage-not-awaiting",
      });
      expect(store.loadPipeline(pipelineId)).toEqual(decidedSnapshot);
    } finally {
      competingStore.close();
    }
  });

  test("updateStage patches the target stage in place, preserving identity and leaving siblings untouched", () => {
    const pipelineId = store.createPipeline({ definition: SAMPLE_PIPELINE_DEFINITION });
    const before = store.loadPipeline(pipelineId);
    if (!before) throw new Error("Pipeline should exist");
    const beforeStages = new Map(before.stages.map((stage) => [stage.stageId, stage]));

    store.updateStage({
      pipelineId,
      stageId: "gate",
      patch: {
        status: "in-progress",
        workflowInvocationId: "wf-1",
        startedAt: 1000,
        artifact: { note: "in flight" },
      },
    });

    const after = store.loadPipeline(pipelineId);
    if (!after) throw new Error("Pipeline should exist");
    const gate = after.stages.find((stage) => stage.stageId === "gate");
    if (!gate) throw new Error("gate stage should exist");

    const beforeGate = beforeStages.get("gate");
    if (!beforeGate) throw new Error("gate stage should exist before update");
    expect(gate.id).toBe(beforeGate.id);
    expect(gate.pipelineId).toBe(pipelineId);
    expect(gate.stageId).toBe("gate");
    expect(gate.position).toBe(beforeGate.position);
    expect(gate.status).toBe("in-progress");
    expect(gate.workflowInvocationId).toBe("wf-1");
    expect(gate.startedAt).toBe(1000);
    expect(gate.artifact).toEqual({ note: "in flight" });
    // omitted fields are unchanged
    expect(gate.endedAt).toBeNull();
    expect(gate.failureDetail).toBeNull();

    for (const stage of after.stages) {
      if (stage.stageId === "gate") continue;
      const beforeStage = beforeStages.get(stage.stageId);
      if (!beforeStage) throw new Error(`${stage.stageId} stage should exist before update`);
      expect(stage).toEqual(beforeStage);
    }
  });

  test("updateStage clears a nullable field only when passed explicit null, not when omitted", () => {
    const pipelineId = store.createPipeline({ definition: SAMPLE_PIPELINE_DEFINITION });
    store.updateStage({
      pipelineId,
      stageId: "plan",
      patch: {
        status: "completed",
        workflowInvocationId: "wf-plan",
        startedAt: 10,
        endedAt: 20,
        artifact: { path: "PR#1" },
        failureDetail: { failureKind: "error" },
      },
    });

    store.updateStage({ pipelineId, stageId: "plan", patch: { status: "completed" } });
    let plan = store.loadPipeline(pipelineId)?.stages.find((stage) => stage.stageId === "plan");
    if (!plan) throw new Error("plan stage should exist");
    expect(plan.workflowInvocationId).toBe("wf-plan");
    expect(plan.startedAt).toBe(10);
    expect(plan.endedAt).toBe(20);
    expect(plan.artifact).toEqual({ path: "PR#1" });
    expect(plan.failureDetail).toEqual({ failureKind: "error" });

    store.updateStage({
      pipelineId,
      stageId: "plan",
      patch: { workflowInvocationId: null, endedAt: null, artifact: null, failureDetail: null },
    });
    plan = store.loadPipeline(pipelineId)?.stages.find((stage) => stage.stageId === "plan");
    if (!plan) throw new Error("plan stage should exist");
    expect(plan.workflowInvocationId).toBeNull();
    expect(plan.startedAt).toBe(10);
    expect(plan.endedAt).toBeNull();
    expect(plan.artifact).toBeNull();
    expect(plan.failureDetail).toBeNull();
  });

  test("updateStage rejects an empty patch", () => {
    const pipelineId = store.createPipeline({ definition: SAMPLE_PIPELINE_DEFINITION });
    expect(() => store.updateStage({ pipelineId, stageId: "plan", patch: {} })).toThrow();
  });

  test("updateStage rejects a patch whose only fields are undefined", () => {
    const pipelineId = store.createPipeline({ definition: SAMPLE_PIPELINE_DEFINITION });
    expect(() =>
      store.updateStage({ pipelineId, stageId: "plan", patch: { artifact: undefined, failureDetail: undefined } }),
    ).toThrow();
  });

  test("updateStage ignores undefined fields alongside a real field, treating undefined as absent", () => {
    const pipelineId = store.createPipeline({ definition: SAMPLE_PIPELINE_DEFINITION });
    store.updateStage({
      pipelineId,
      stageId: "plan",
      patch: { status: "in-progress", artifact: undefined },
    });

    const plan = store.loadPipeline(pipelineId)?.stages.find((stage) => stage.stageId === "plan");
    if (!plan) throw new Error("plan stage should exist");
    expect(plan.status).toBe("in-progress");
    expect(plan.artifact).toBeNull();
  });

  test("updateStage rejects an unknown pipeline or stage target", () => {
    const pipelineId = store.createPipeline({ definition: SAMPLE_PIPELINE_DEFINITION });
    expect(() =>
      store.updateStage({ pipelineId: "unknown-pipeline", stageId: "plan", patch: { status: "x" } }),
    ).toThrow();
    expect(() => store.updateStage({ pipelineId, stageId: "unknown-stage", patch: { status: "x" } })).toThrow();
  });

  test("updateStage round-trips millisecond timestamps and a non-null status string across close and reopen", () => {
    const pipelineId = store.createPipeline({ definition: SAMPLE_PIPELINE_DEFINITION });
    store.updateStage({
      pipelineId,
      stageId: "implement",
      patch: {
        status: "completed",
        workflowInvocationId: "wf-implement",
        startedAt: 1_700_000_000_000,
        endedAt: 1_700_000_060_000,
        artifact: { path: "PR#123" },
        failureDetail: null,
      },
    });
    store.close();

    store = openStateStore(TEST_DB_PATH);
    const reopened = store.loadPipeline(pipelineId);
    if (!reopened) throw new Error("Pipeline should exist");
    expect(reopened.id).toBe(pipelineId);
    expect(reopened.name).toBe(SAMPLE_PIPELINE_DEFINITION.name);
    expect(reopened.definition).toEqual(SAMPLE_PIPELINE_DEFINITION);
    expect(reopened.stages.map((stage) => stage.stageId)).toEqual(["plan", "gate", "implement"]);

    const implement = reopened.stages.find((stage) => stage.stageId === "implement");
    if (!implement) throw new Error("implement stage should exist");
    expect(implement.status).toBe("completed");
    expect(implement.workflowInvocationId).toBe("wf-implement");
    expect(implement.startedAt).toBe(1_700_000_000_000);
    expect(implement.endedAt).toBe(1_700_000_060_000);
    expect(implement.artifact).toEqual({ path: "PR#123" });
    expect(implement.failureDetail).toBeNull();
  });

  test("createPipeline stamps owner_identity and status='active'; loadPipeline reads both back across close and reopen", () => {
    const identity = "admitter:1234";
    store.close();
    store = openStateStore(TEST_DB_PATH, { currentIdentity: identity });
    const pipelineId = store.createPipeline({ definition: SAMPLE_PIPELINE_DEFINITION });
    store.close();

    store = openStateStore(TEST_DB_PATH);
    const pipeline = store.loadPipeline(pipelineId);
    if (!pipeline) throw new Error("Pipeline should exist");
    expect(pipeline.ownerIdentity).toBe(identity);
    expect(pipeline.status).toBe("active");
  });

  test("a fixture created with the pre-change migrations upgrades and can then admit and load a pipeline", () => {
    const legacyDbPath = join(tmpdir(), "jarvis-test-state-legacy-pipelines.sqlite");
    removeOrchestrationStore(legacyDbPath);
    try {
      const raw = new Database(legacyDbPath);
      raw.exec(`
        CREATE TABLE runs (
          id TEXT PRIMARY KEY,
          project TEXT NOT NULL,
          spec_ref TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          status TEXT NOT NULL,
          attempt_count INTEGER NOT NULL DEFAULT 0,
          worktree_path TEXT NOT NULL,
          branch TEXT NOT NULL,
          spec_path TEXT NOT NULL,
          step_id TEXT,
          workflow_snapshot TEXT,
          queued_input TEXT,
          creation_title TEXT,
          reconciliation_pending INTEGER NOT NULL DEFAULT 0,
          owner_identity TEXT,
          pr_number INTEGER,
          pr_url TEXT
        );
        CREATE TABLE attempts (
          id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL,
          attempt_number INTEGER NOT NULL,
          started_at INTEGER NOT NULL,
          status TEXT NOT NULL,
          outcome_kind TEXT,
          completed_at INTEGER,
          invocation_failure_detail TEXT,
          completion_agent TEXT,
          FOREIGN KEY (run_id) REFERENCES runs(id)
        );
        CREATE TABLE _migrations (
          id TEXT PRIMARY KEY,
          applied_at INTEGER NOT NULL
        );
      `);
      for (const id of [
        "004-invocation-failure-detail",
        "005-run-step-id",
        "006-run-workflow-snapshot",
        "007-run-queued-input",
        "008-attempt-completion-agent",
        "009-run-creation-title",
        "010-run-reconciliation-pending",
        "011-run-owner-identity",
        "012-run-pr-evidence",
      ]) {
        raw.prepare("INSERT INTO _migrations (id, applied_at) VALUES (?, ?)").run(id, Date.now());
      }
      const runId = "legacy-run";
      raw
        .prepare(
          `INSERT INTO runs (id, project, spec_ref, created_at, status, attempt_count, worktree_path, branch, spec_path)
           VALUES (?, 'legacy-project', 'main', ?, 'in-progress', 0, '/tmp/legacy', 'legacy-branch', 'spec.md')`,
        )
        .run(runId, Date.now());
      const attemptId = "legacy-attempt";
      raw
        .prepare(
          "INSERT INTO attempts (id, run_id, attempt_number, started_at, status) VALUES (?, ?, 1, ?, 'completed')",
        )
        .run(attemptId, runId, Date.now());
      raw.close();

      let migrated = openStateStore(legacyDbPath);
      const legacyRun = loadRunOrThrow(migrated, runId);
      expect(legacyRun.project).toBe("legacy-project");
      expect(legacyRun.attempts).toHaveLength(1);

      const verify = new Database(legacyDbPath);
      const migrationCount = verify.prepare("SELECT COUNT(*) AS total FROM _migrations").get() as { total: number };
      expect(migrationCount.total).toBe(12);
      verify.close();

      const pipelineId = migrated.createPipeline({ definition: SAMPLE_PIPELINE_DEFINITION });
      const pipeline = migrated.loadPipeline(pipelineId);
      expect(pipeline?.stages.map((stage) => stage.stageId)).toEqual(["plan", "gate", "implement"]);
      migrated.close();

      migrated = openStateStore(legacyDbPath);
      const reopened = migrated.loadPipeline(pipelineId);
      expect(reopened?.stages.map((stage) => stage.stageId)).toEqual(["plan", "gate", "implement"]);
      expect(loadRunOrThrow(migrated, runId).project).toBe("legacy-project");
      migrated.close();
    } finally {
      removeOrchestrationStore(legacyDbPath);
    }
  });

  test("opens a pre-context pipeline row with absent context instead of synthesizing admission input", () => {
    const legacyDbPath = join(tmpdir(), "jarvis-test-state-legacy-pipeline-context.sqlite");
    removeOrchestrationStore(legacyDbPath);
    try {
      const raw = new Database(legacyDbPath);
      raw.exec(`
        CREATE TABLE runs (
          id TEXT PRIMARY KEY,
          project TEXT NOT NULL,
          spec_ref TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          status TEXT NOT NULL,
          attempt_count INTEGER NOT NULL DEFAULT 0,
          worktree_path TEXT NOT NULL,
          branch TEXT NOT NULL,
          spec_path TEXT NOT NULL,
          step_id TEXT,
          workflow_snapshot TEXT,
          queued_input TEXT,
          creation_title TEXT,
          reconciliation_pending INTEGER NOT NULL DEFAULT 0,
          owner_identity TEXT,
          pr_number INTEGER,
          pr_url TEXT
        );
        CREATE TABLE attempts (
          id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL,
          attempt_number INTEGER NOT NULL,
          started_at INTEGER NOT NULL,
          status TEXT NOT NULL,
          outcome_kind TEXT,
          completed_at INTEGER,
          invocation_failure_detail TEXT,
          completion_agent TEXT,
          FOREIGN KEY (run_id) REFERENCES runs(id)
        );
        CREATE TABLE pipelines (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          definition TEXT NOT NULL,
          owner_identity TEXT,
          status TEXT NOT NULL DEFAULT 'active'
        );
        CREATE TABLE pipeline_stages (
          id TEXT PRIMARY KEY,
          pipeline_id TEXT NOT NULL REFERENCES pipelines(id),
          stage_id TEXT NOT NULL,
          position INTEGER NOT NULL,
          status TEXT NOT NULL,
          workflow_invocation_id TEXT,
          started_at INTEGER,
          ended_at INTEGER,
          artifact TEXT,
          failure_detail TEXT,
          UNIQUE (pipeline_id, stage_id),
          UNIQUE (pipeline_id, position)
        );
        CREATE TABLE _migrations (
          id TEXT PRIMARY KEY,
          applied_at INTEGER NOT NULL
        );
      `);
      for (const id of [
        "004-invocation-failure-detail",
        "005-run-step-id",
        "006-run-workflow-snapshot",
        "007-run-queued-input",
        "008-attempt-completion-agent",
        "009-run-creation-title",
        "010-run-reconciliation-pending",
        "011-run-owner-identity",
        "012-run-pr-evidence",
        "013-pipelines-and-stages",
        "014-pipeline-owner-identity-and-status",
      ]) {
        raw.prepare("INSERT INTO _migrations (id, applied_at) VALUES (?, ?)").run(id, Date.now());
      }
      raw
        .prepare(
          "INSERT INTO pipelines (id, name, created_at, owner_identity, status, definition) VALUES ('legacy-pipeline', 'legacy', ?, NULL, 'active', ?)",
        )
        .run(Date.now(), JSON.stringify(SAMPLE_PIPELINE_DEFINITION));
      raw
        .prepare(
          "INSERT INTO pipeline_stages (id, pipeline_id, stage_id, position, status) VALUES ('legacy-stage', 'legacy-pipeline', 'plan', 0, 'pending')",
        )
        .run();
      raw.close();

      const migrated = openStateStore(legacyDbPath);
      try {
        const pipeline = migrated.loadPipeline("legacy-pipeline");
        expect(pipeline?.context).toBeNull();
        expect(pipeline?.definition).toEqual(SAMPLE_PIPELINE_DEFINITION);
        expect(pipeline?.stages.map((stage) => stage.stageId)).toEqual(["plan"]);

        const verify = new Database(legacyDbPath);
        try {
          const row = verify.prepare("SELECT context FROM pipelines WHERE id = 'legacy-pipeline'").get() as {
            context: string | null;
          };
          expect(row.context).toBeNull();
        } finally {
          verify.close();
        }
      } finally {
        migrated.close();
      }
    } finally {
      removeOrchestrationStore(legacyDbPath);
    }
  });
});

describe("pipeline continuation claim", () => {
  const CURRENT_IDENTITY = "daemon:claim-test";

  let store: StateStore;

  beforeEach(() => {
    removeOrchestrationStore(TEST_DB_PATH);
    store = openStateStore(TEST_DB_PATH, { currentIdentity: CURRENT_IDENTITY });
  });

  afterEach(() => {
    store.close();
    removeOrchestrationStore(TEST_DB_PATH);
  });

  test("admits an active pipeline already owned by this process without changing status", () => {
    const context = { cwd: "/repo", seed: "seed" };
    const pipelineId = store.createPipeline({ definition: SAMPLE_PIPELINE_DEFINITION, context });
    expect(store.claimPipelineContinuation(pipelineId)).toEqual({ outcome: "applied" });
    expect(store.loadPipeline(pipelineId)?.status).toBe("active");
    expect(store.loadPipeline(pipelineId)?.ownerIdentity).toBe(CURRENT_IDENTITY);
  });

  test("restores an interrupted pipeline to active under this process", () => {
    const context = { cwd: "/repo", seed: "seed" };
    const pipelineId = store.createPipeline({ definition: SAMPLE_PIPELINE_DEFINITION, context });
    const raw = new Database(TEST_DB_PATH);
    try {
      raw.prepare("UPDATE pipelines SET status = 'interrupted', owner_identity = ? WHERE id = ?").run(
        "prior:1",
        pipelineId,
      );
    } finally {
      raw.close();
    }

    expect(store.claimPipelineContinuation(pipelineId)).toEqual({ outcome: "applied" });
    expect(store.loadPipeline(pipelineId)?.status).toBe("active");
    expect(store.loadPipeline(pipelineId)?.ownerIdentity).toBe(CURRENT_IDENTITY);
  });

  test("refuses a competing interrupted claim after another process already claimed the pipeline", () => {
    const context = { cwd: "/repo", seed: "seed" };
    const pipelineId = store.createPipeline({ definition: SAMPLE_PIPELINE_DEFINITION, context });
    const raw = new Database(TEST_DB_PATH);
    try {
      raw.prepare("UPDATE pipelines SET status = 'interrupted', owner_identity = ? WHERE id = ?").run(
        "prior:1",
        pipelineId,
      );
    } finally {
      raw.close();
    }

    expect(store.claimPipelineContinuation(pipelineId)).toEqual({ outcome: "applied" });

    const competingStore = openStateStore(TEST_DB_PATH, { currentIdentity: "daemon:other" });
    try {
      expect(competingStore.claimPipelineContinuation(pipelineId)).toEqual({
        outcome: "refused",
        reason: "claim-refused",
      });
    } finally {
      competingStore.close();
    }
  });
});

describe("failed pipeline reopen", () => {
  const PRIOR_IDENTITY = "11111:1000000";
  const CURRENT_IDENTITY = "22222:2000000";

  let store: StateStore;

  beforeEach(() => {
    removeOrchestrationStore(TEST_DB_PATH);
    store = openStateStore(TEST_DB_PATH, { currentIdentity: PRIOR_IDENTITY });
  });

  afterEach(() => {
    store.close();
    removeOrchestrationStore(TEST_DB_PATH);
  });

  function seedFailedPipeline(stageStatuses: string[]): string {
    const pipelineId = store.createPipeline({
      definition: {
        name: "reopen-pipeline",
        stages: stageStatuses.map((_, index) => ({
          stageId: `stage-${index}`,
          kind: "workflow",
          workflow: "plan",
          review: "none",
        })),
      },
    });
    const raw = new Database(TEST_DB_PATH);
    try {
      stageStatuses.forEach((status, index) => {
        raw
          .prepare(
            `UPDATE pipeline_stages
             SET status = ?,
                 workflow_invocation_id = ?,
                 started_at = ?,
                 ended_at = ?,
                 artifact = ?,
                 failure_detail = ?
             WHERE pipeline_id = ? AND stage_id = ?`,
          )
          .run(
            status,
            `wf-${index}`,
            1000 + index,
            2000 + index,
            JSON.stringify({ entryRunId: `run-${index}` }),
            JSON.stringify({ message: `detail-${index}` }),
            pipelineId,
            `stage-${index}`,
          );
      });
    } finally {
      raw.close();
    }
    return pipelineId;
  }

  test("reopens a valid failed-plus-skipped-suffix pipeline in place and returns the failed row's durable id", () => {
    const pipelineId = seedFailedPipeline(["succeeded", "failed", "skipped", "skipped", "pending"]);
    const before = store.loadPipeline(pipelineId);
    if (!before) throw new Error("Pipeline should exist");
    const failedBefore = before.stages.find((stage) => stage.stageId === "stage-1");
    if (!failedBefore) throw new Error("Failed stage should exist");

    const outcome = store.reopenFailedPipeline(pipelineId);
    expect(outcome).toEqual({ outcome: "applied", stageRecordId: failedBefore.id });

    const after = store.loadPipeline(pipelineId);
    if (!after) throw new Error("Pipeline should exist");
    const failedAfter = after.stages.find((stage) => stage.id === failedBefore.id);
    expect(failedAfter?.stageId).toBe("stage-1");
    expect(failedAfter?.status).toBe("pending");
    expect(after.stages.find((stage) => stage.stageId === "stage-2")?.status).toBe("pending");
    expect(after.stages.find((stage) => stage.stageId === "stage-3")?.status).toBe("pending");
    expect(after.stages.find((stage) => stage.stageId === "stage-4")?.status).toBe("pending");
  });

  test("retains succeeded predecessor evidence while clearing only failed and skipped lifecycle payloads", () => {
    const pipelineId = seedFailedPipeline(["succeeded", "failed", "skipped", "pending"]);
    const before = store.loadPipeline(pipelineId);
    if (!before) throw new Error("Pipeline should exist");
    const succeededBefore = before.stages.find((stage) => stage.stageId === "stage-0");
    const failedBefore = before.stages.find((stage) => stage.stageId === "stage-1");
    const skippedBefore = before.stages.find((stage) => stage.stageId === "stage-2");
    const pendingBefore = before.stages.find((stage) => stage.stageId === "stage-3");
    if (!succeededBefore || !failedBefore || !skippedBefore || !pendingBefore) {
      throw new Error("Pipeline stages should exist");
    }

    store.reopenFailedPipeline(pipelineId);

    const after = store.loadPipeline(pipelineId);
    if (!after) throw new Error("Pipeline should exist");
    expect(after.stages.find((stage) => stage.id === succeededBefore.id)).toEqual(succeededBefore);
    expect(after.stages.find((stage) => stage.id === pendingBefore.id)).toEqual(pendingBefore);

    const failedAfter = after.stages.find((stage) => stage.id === failedBefore.id);
    expect(failedAfter?.id).toBe(failedBefore.id);
    expect(failedAfter?.stageId).toBe(failedBefore.stageId);
    expect(failedAfter?.position).toBe(failedBefore.position);
    expect(failedAfter?.status).toBe("pending");
    expect(failedAfter?.workflowInvocationId).toBeNull();
    expect(failedAfter?.startedAt).toBeNull();
    expect(failedAfter?.endedAt).toBeNull();
    expect(failedAfter?.artifact).toBeNull();
    expect(failedAfter?.failureDetail).toBeNull();

    const skippedAfter = after.stages.find((stage) => stage.id === skippedBefore.id);
    expect(skippedAfter?.id).toBe(skippedBefore.id);
    expect(skippedAfter?.stageId).toBe(skippedBefore.stageId);
    expect(skippedAfter?.status).toBe("pending");
    expect(skippedAfter?.workflowInvocationId).toBeNull();
    expect(skippedAfter?.artifact).toBeNull();
    expect(skippedAfter?.failureDetail).toBeNull();
  });

  test("survives close and reopen of the store, including after restart reconciliation", async () => {
    const pipelineId = seedFailedPipeline(["succeeded", "failed", "skipped", "pending"]);
    const before = store.loadPipeline(pipelineId);
    if (!before) throw new Error("Pipeline should exist");
    const failedBefore = before.stages.find((stage) => stage.stageId === "stage-1");
    if (!failedBefore) throw new Error("Failed stage should exist");

    const sweepStore = openStateStore(TEST_DB_PATH, {
      currentIdentity: CURRENT_IDENTITY,
      isOwnerAlive: async (identity) => identity !== PRIOR_IDENTITY,
    });
    const settled = await sweepStore.reconcilePipelines();
    expect(settled).toEqual([pipelineId]);
    sweepStore.close();

    store.close();
    store = openStateStore(TEST_DB_PATH);

    const outcome = store.reopenFailedPipeline(pipelineId);
    expect(outcome).toEqual({ outcome: "applied", stageRecordId: failedBefore.id });
    expect(store.loadPipeline(pipelineId)?.stages.find((stage) => stage.id === failedBefore.id)?.status).toBe(
      "pending",
    );
  });

  test("refuses no-failure, multiple-failure, and malformed-suffix shapes without mutation", () => {
    const refusalCases = [
      {
        stageStatuses: ["succeeded", "pending", "pending"],
        reason: "no-failure",
      },
      {
        stageStatuses: ["failed", "failed", "pending"],
        reason: "multiple-failures",
      },
      {
        stageStatuses: ["pending", "failed", "pending"],
        reason: "malformed-suffix",
      },
      {
        stageStatuses: ["succeeded", "failed", "skipped", "running"],
        reason: "malformed-suffix",
      },
    ] as const;

    for (const refusalCase of refusalCases) {
      const pipelineId = seedFailedPipeline([...refusalCase.stageStatuses]);
      const before = store.loadPipeline(pipelineId);
      expect(store.reopenFailedPipeline(pipelineId)).toEqual({
        outcome: "refused",
        reason: refusalCase.reason,
      });
      expect(store.loadPipeline(pipelineId)).toEqual(before);
    }
  });

  test("refuses unknown pipelines without mutation", () => {
    expect(store.reopenFailedPipeline("missing-pipeline")).toEqual({
      outcome: "refused",
      reason: "pipeline-not-found",
    });
  });

  test("failed pipeline reopen is first-writer-wins across store handles", () => {
    const pipelineId = seedFailedPipeline(["succeeded", "failed", "skipped", "pending"]);
    const failed = store.loadPipeline(pipelineId)?.stages.find((stage) => stage.stageId === "stage-1");
    if (!failed) throw new Error("Failed stage should exist");

    const competingStore = openStateStore(TEST_DB_PATH);
    try {
      const outcomes = [store.reopenFailedPipeline(pipelineId), competingStore.reopenFailedPipeline(pipelineId)];
      expect(outcomes.filter((outcome) => outcome.outcome === "applied")).toEqual([
        { outcome: "applied", stageRecordId: failed.id },
      ]);
      const refused = outcomes.filter((outcome) => outcome.outcome === "refused");
      expect(refused).toHaveLength(1);
      expect(refused[0]?.outcome).toBe("refused");
      if (refused[0]?.outcome === "refused") {
        expect(["reopen-refused", "no-failure"]).toContain(refused[0].reason);
      }
    } finally {
      competingStore.close();
    }
  });

  test("valid-failed-boundary guard inversion would accept a non-succeeded predecessor", () => {
    const pipelineId = seedFailedPipeline(["pending", "failed", "pending"]);
    const before = store.loadPipeline(pipelineId);
    if (!before) throw new Error("Pipeline should exist");

    const shape = analyzeFailedPipelineReopenShape(before.stages);
    expect(shape.valid).toBe(false);
    if (shape.valid) throw new Error("Shape should be invalid");
    expect(shape.reason).toBe("malformed-suffix");

    const preFixShape = { valid: true as const, failedStageRecordId: "x", failedIndex: 1, suffixEndIndex: 1 };
    expect(preFixShape.valid).toBe(true);

    expect(store.reopenFailedPipeline(pipelineId)).toEqual({
      outcome: "refused",
      reason: "malformed-suffix",
    });
    expect(store.loadPipeline(pipelineId)).toEqual(before);
  });

  test("suffix-scope guard inversion would reopen only the failed row and leave skipped rows blocked", () => {
    const pipelineId = seedFailedPipeline(["succeeded", "failed", "skipped", "pending"]);
    const before = store.loadPipeline(pipelineId);
    if (!before) throw new Error("Pipeline should exist");
    const skippedBefore = before.stages.find((stage) => stage.stageId === "stage-2");
    if (!skippedBefore) throw new Error("Skipped stage should exist");

    const shape = analyzeFailedPipelineReopenShape(before.stages);
    if (!shape.valid) throw new Error("Shape should be valid");
    expect(shape.suffixEndIndex).toBe(2);

    const preFixSuffixEndIndex = shape.failedIndex;
    expect(preFixSuffixEndIndex).not.toBe(shape.suffixEndIndex);

    store.reopenFailedPipeline(pipelineId);
    const after = store.loadPipeline(pipelineId);
    if (!after) throw new Error("Pipeline should exist");
    expect(after.stages.find((stage) => stage.stageId === "stage-2")?.status).toBe("pending");
    expect(preFixSuffixEndIndex === shape.suffixEndIndex).toBe(false);
  });

  test("lifecycle-clear guard inversion would retain prior attempt payloads on the failed row", () => {
    const pipelineId = seedFailedPipeline(["succeeded", "failed", "pending"]);
    const before = store.loadPipeline(pipelineId);
    if (!before) throw new Error("Pipeline should exist");
    const failedBefore = before.stages.find((stage) => stage.stageId === "stage-1");
    if (!failedBefore) throw new Error("Failed stage should exist");
    expect(failedBefore.workflowInvocationId).not.toBeNull();
    expect(failedBefore.failureDetail).not.toBeNull();

    store.reopenFailedPipeline(pipelineId);
    const failedAfter = store.loadPipeline(pipelineId)?.stages.find((stage) => stage.id === failedBefore.id);
    expect(failedAfter?.workflowInvocationId).toBeNull();
    expect(failedAfter?.failureDetail).toBeNull();
    expect(failedAfter?.workflowInvocationId).not.toBe(failedBefore.workflowInvocationId);
  });

  test("atomic-claim guard inversion would let a losing concurrent reopen mutate the failed row", () => {
    const pipelineId = seedFailedPipeline(["succeeded", "failed", "pending"]);
    const before = store.loadPipeline(pipelineId);
    if (!before) throw new Error("Pipeline should exist");

    const competingStore = openStateStore(TEST_DB_PATH);
    try {
      const outcomes = [store.reopenFailedPipeline(pipelineId), competingStore.reopenFailedPipeline(pipelineId)];
      expect(outcomes.filter((outcome) => outcome.outcome === "applied")).toHaveLength(1);
      const refused = outcomes.filter((outcome) => outcome.outcome === "refused");
      expect(refused).toHaveLength(1);
      expect(refused[0]?.outcome).toBe("refused");
      if (refused[0]?.outcome === "refused") {
        expect(["reopen-refused", "no-failure"]).toContain(refused[0].reason);
      }
      expect(store.loadPipeline(pipelineId)?.stages.find((stage) => stage.stageId === "stage-1")?.status).toBe(
        "pending",
      );
    } finally {
      competingStore.close();
    }
    expect(store.loadPipeline(pipelineId)).not.toEqual(before);
  });
});

describe("pipeline reconciliation", () => {
  const PRIOR_IDENTITY = "11111:1000000";
  const CURRENT_IDENTITY = "22222:2000000";

  let seedStore: StateStore;

  beforeEach(() => {
    removeOrchestrationStore(TEST_DB_PATH);
    seedStore = openStateStore(TEST_DB_PATH, { currentIdentity: PRIOR_IDENTITY });
  });

  afterEach(() => {
    seedStore.close();
    removeOrchestrationStore(TEST_DB_PATH);
  });

  function openSweepStore(isOwnerAliveProbe: OwnerLivenessProbe): StateStore {
    return openStateStore(TEST_DB_PATH, { currentIdentity: CURRENT_IDENTITY, isOwnerAlive: isOwnerAliveProbe });
  }

  /** Admit a pipeline via `seedStore` (owner = PRIOR_IDENTITY), then overwrite owner and per-stage statuses directly. */
  function seedPipeline(ownerIdentity: string | null, stageStatuses: string[]): string {
    const pipelineId = seedStore.createPipeline({
      definition: {
        name: "sweep-pipeline",
        stages: stageStatuses.map((_, index) => ({ stageId: `stage-${index}`, kind: "approval" })),
      },
    });
    const raw = new Database(TEST_DB_PATH);
    try {
      raw.prepare("UPDATE pipelines SET owner_identity = ? WHERE id = ?").run(ownerIdentity, pipelineId);
      stageStatuses.forEach((status, index) => {
        raw
          .prepare("UPDATE pipeline_stages SET status = ? WHERE pipeline_id = ? AND stage_id = ?")
          .run(status, pipelineId, `stage-${index}`);
      });
    } finally {
      raw.close();
    }
    return pipelineId;
  }

  test("settles a dead-owner pipeline with a mid-stage active stage: pipeline and active stage interrupted, terminal stages untouched byte-for-byte, pending stages remain pending", async () => {
    const pipelineId = seedPipeline(PRIOR_IDENTITY, ["succeeded", "in-progress", "pending"]);
    const before = seedStore.loadPipeline(pipelineId);
    if (!before) throw new Error("Pipeline should exist");
    const succeededBefore = before.stages.find((stage) => stage.stageId === "stage-0");
    const pendingBefore = before.stages.find((stage) => stage.stageId === "stage-2");

    const sweepStore = openSweepStore(async (identity) => identity !== PRIOR_IDENTITY);
    const settled = await sweepStore.reconcilePipelines();

    expect(settled).toEqual([pipelineId]);
    const after = sweepStore.loadPipeline(pipelineId);
    if (!after) throw new Error("Pipeline should exist");
    expect(after.status).toBe("interrupted");
    expect(after.stages.find((stage) => stage.stageId === "stage-0")).toEqual(succeededBefore);
    const active = after.stages.find((stage) => stage.stageId === "stage-1");
    expect(active?.status).toBe("interrupted");
    expect(active?.endedAt).not.toBeNull();
    expect(after.stages.find((stage) => stage.stageId === "stage-2")).toEqual(pendingBefore);
    sweepStore.close();
  });

  test("leaves a pipeline owned by a still-live different process unsettled and unchanged", async () => {
    const pipelineId = seedPipeline(PRIOR_IDENTITY, ["in-progress"]);
    const before = seedStore.loadPipeline(pipelineId);

    const sweepStore = openSweepStore(async (identity) => identity === PRIOR_IDENTITY);
    const settled = await sweepStore.reconcilePipelines();

    expect(settled).toEqual([]);
    expect(sweepStore.loadPipeline(pipelineId)).toEqual(before);
    sweepStore.close();
  });

  test("never settles a pipeline owned by the current process's own sweep", async () => {
    const ownStore = openStateStore(TEST_DB_PATH, { currentIdentity: CURRENT_IDENTITY });
    const pipelineId = ownStore.createPipeline({ definition: SAMPLE_PIPELINE_DEFINITION });
    ownStore.close();

    const sweepStore = openSweepStore(async () => false);
    const settled = await sweepStore.reconcilePipelines();

    expect(settled).toEqual([]);
    expect(sweepStore.loadPipeline(pipelineId)?.status).toBe("active");
    sweepStore.close();
  });

  test("re-running the sweep against an already-interrupted pipeline changes nothing and does not re-return its ID", async () => {
    const pipelineId = seedPipeline(PRIOR_IDENTITY, ["in-progress"]);
    const sweepStore = openSweepStore(async () => false);
    const first = await sweepStore.reconcilePipelines();
    expect(first).toEqual([pipelineId]);
    const afterFirst = sweepStore.loadPipeline(pipelineId);

    const second = await sweepStore.reconcilePipelines();

    expect(second).toEqual([]);
    expect(sweepStore.loadPipeline(pipelineId)).toEqual(afterFirst);
    sweepStore.close();
  });

  test("settles a dead-owner pipeline with no active stage: every stage already terminal", async () => {
    const pipelineId = seedPipeline(PRIOR_IDENTITY, ["succeeded", "failed"]);
    const before = seedStore.loadPipeline(pipelineId);
    if (!before) throw new Error("Pipeline should exist");

    const sweepStore = openSweepStore(async () => false);
    const settled = await sweepStore.reconcilePipelines();

    expect(settled).toEqual([pipelineId]);
    const after = sweepStore.loadPipeline(pipelineId);
    expect(after?.status).toBe("interrupted");
    expect(after?.stages).toEqual(before.stages);
    sweepStore.close();
  });

  test("settles a dead-owner pipeline with no active stage: later stages pending, none active", async () => {
    const pipelineId = seedPipeline(PRIOR_IDENTITY, ["succeeded", "pending"]);
    const before = seedStore.loadPipeline(pipelineId);
    if (!before) throw new Error("Pipeline should exist");

    const sweepStore = openSweepStore(async () => false);
    const settled = await sweepStore.reconcilePipelines();

    expect(settled).toEqual([pipelineId]);
    const after = sweepStore.loadPipeline(pipelineId);
    expect(after?.status).toBe("interrupted");
    expect(after?.stages).toEqual(before.stages);
    sweepStore.close();
  });

  test("a NULL owner_identity (pre-migration row) is treated as orphaned with no liveness probe", async () => {
    const pipelineId = seedPipeline(null, ["in-progress"]);

    const sweepStore = openSweepStore(async () => {
      throw new Error("liveness probe should not be called for a NULL owner");
    });
    const settled = await sweepStore.reconcilePipelines();

    expect(settled).toEqual([pipelineId]);
    expect(sweepStore.loadPipeline(pipelineId)?.status).toBe("interrupted");
    sweepStore.close();
  });

  test("settling a dead-owner pipeline leaves an already-interrupted stage byte-for-byte unchanged, including its ended_at", async () => {
    const pipelineId = seedPipeline(PRIOR_IDENTITY, ["interrupted", "in-progress"]);
    const priorEndedAt = 12345;
    const raw = new Database(TEST_DB_PATH);
    try {
      raw
        .prepare("UPDATE pipeline_stages SET ended_at = ? WHERE pipeline_id = ? AND stage_id = ?")
        .run(priorEndedAt, pipelineId, "stage-0");
    } finally {
      raw.close();
    }
    const before = seedStore.loadPipeline(pipelineId);
    if (!before) throw new Error("Pipeline should exist");
    const alreadyInterruptedBefore = before.stages.find((stage) => stage.stageId === "stage-0");
    expect(alreadyInterruptedBefore?.endedAt).toBe(priorEndedAt);

    const sweepStore = openSweepStore(async () => false);
    const settled = await sweepStore.reconcilePipelines();

    expect(settled).toEqual([pipelineId]);
    const after = sweepStore.loadPipeline(pipelineId);
    if (!after) throw new Error("Pipeline should exist");
    expect(after.status).toBe("interrupted");
    expect(after.stages.find((stage) => stage.stageId === "stage-0")).toEqual(alreadyInterruptedBefore);
    const active = after.stages.find((stage) => stage.stageId === "stage-1");
    expect(active?.status).toBe("interrupted");
    sweepStore.close();
  });

  test("sweeps every dead-owner pipeline in one pass, leaving a live-owner pipeline untouched", async () => {
    const firstOrphanId = seedPipeline(PRIOR_IDENTITY, ["in-progress"]);
    const secondOrphanId = seedPipeline(PRIOR_IDENTITY, ["succeeded", "in-progress"]);
    const liveOwnerId = seedPipeline(PRIOR_IDENTITY, ["in-progress"]);
    const raw = new Database(TEST_DB_PATH);
    try {
      raw.prepare("UPDATE pipelines SET owner_identity = ? WHERE id = ?").run("33333:3000000", liveOwnerId);
    } finally {
      raw.close();
    }
    const liveBefore = seedStore.loadPipeline(liveOwnerId);

    const sweepStore = openSweepStore(async (identity) => identity === "33333:3000000");
    const settled = await sweepStore.reconcilePipelines();

    expect(new Set(settled)).toEqual(new Set([firstOrphanId, secondOrphanId]));
    expect(sweepStore.loadPipeline(firstOrphanId)?.status).toBe("interrupted");
    expect(sweepStore.loadPipeline(secondOrphanId)?.status).toBe("interrupted");
    expect(sweepStore.loadPipeline(liveOwnerId)).toEqual(liveBefore);
    sweepStore.close();
  });

  test("leaves awaiting, approved, and rejected approval rows unchanged alongside succeeded predecessors and later pending siblings", async () => {
    for (const status of ["awaiting", "approved", "rejected"]) {
      const pipelineId = seedPipeline(PRIOR_IDENTITY, ["succeeded", status, "pending"]);
      const before = seedStore.loadPipeline(pipelineId);
      if (!before) throw new Error("Pipeline should exist");

      const sweepStore = openSweepStore(async () => false);
      const settled = await sweepStore.reconcilePipelines();

      expect(settled).toEqual([pipelineId]);
      const after = sweepStore.loadPipeline(pipelineId);
      if (!after) throw new Error("Pipeline should exist");
      expect(after.status).toBe("interrupted");
      expect(after.stages.find((stage) => stage.stageId === "stage-0")).toEqual(
        before.stages.find((stage) => stage.stageId === "stage-0"),
      );
      expect(after.stages.find((stage) => stage.stageId === "stage-1")).toEqual(
        before.stages.find((stage) => stage.stageId === "stage-1"),
      );
      expect(after.stages.find((stage) => stage.stageId === "stage-2")).toEqual(
        before.stages.find((stage) => stage.stageId === "stage-2"),
      );
      sweepStore.close();
    }
  });

  test("leaves a failed stage and its blocked skipped suffix unchanged, including durable row IDs and authored stageIds", async () => {
    const pipelineId = seedPipeline(PRIOR_IDENTITY, ["succeeded", "failed", "skipped", "skipped", "pending"]);
    const before = seedStore.loadPipeline(pipelineId);
    if (!before) throw new Error("Pipeline should exist");
    const failedBefore = before.stages.find((stage) => stage.stageId === "stage-1");
    const skippedBefore = before.stages.filter((stage) => stage.status === "skipped");
    const pendingBefore = before.stages.find((stage) => stage.stageId === "stage-4");

    const sweepStore = openSweepStore(async () => false);
    const settled = await sweepStore.reconcilePipelines();

    expect(settled).toEqual([pipelineId]);
    const after = sweepStore.loadPipeline(pipelineId);
    if (!after) throw new Error("Pipeline should exist");
    expect(after.status).toBe("interrupted");
    expect(after.stages.find((stage) => stage.stageId === "stage-0")).toEqual(
      before.stages.find((stage) => stage.stageId === "stage-0"),
    );
    expect(after.stages.find((stage) => stage.stageId === "stage-1")).toEqual(failedBefore);
    for (const skipped of skippedBefore) {
      expect(after.stages.find((stage) => stage.id === skipped.id)).toEqual(skipped);
    }
    expect(after.stages.find((stage) => stage.stageId === "stage-4")).toEqual(pendingBefore);
    sweepStore.close();
  });

  test("skipped-stability guard inversion would rewrite blocked suffix as interrupted", async () => {
    const pipelineId = seedPipeline(PRIOR_IDENTITY, ["failed", "skipped"]);
    const before = seedStore.loadPipeline(pipelineId);
    if (!before) throw new Error("Pipeline should exist");
    const skippedBefore = before.stages.find((stage) => stage.stageId === "stage-1");
    if (!skippedBefore) throw new Error("Skipped stage should exist");

    expect(isStageReconciliationStable("skipped")).toBe(true);
    const preFixStableStatuses = [
      "pending",
      "succeeded",
      "failed",
      "interrupted",
      "awaiting",
      "approved",
      "rejected",
    ];
    expect(preFixStableStatuses.includes("skipped")).toBe(false);

    const sweepStore = openSweepStore(async () => false);
    await sweepStore.reconcilePipelines();
    const after = sweepStore.loadPipeline(pipelineId);
    if (!after) throw new Error("Pipeline should exist");
    expect(after.stages.find((stage) => stage.stageId === "stage-1")).toEqual(skippedBefore);
    expect(after.stages.find((stage) => stage.stageId === "stage-1")?.status).toBe("skipped");
    expect(!isStageReconciliationStable("skipped")).toBe(false);
    sweepStore.close();
  });
});

describe("isOwnerAlive", () => {
  test("same pid with a matching start epoch is alive", async () => {
    expect(await isOwnerAlive(`${process.pid}:1000`, async () => 1000)).toBe(true);
  });

  test("same pid with a different start epoch is dead", async () => {
    expect(await isOwnerAlive(`${process.pid}:1000`, async () => 2000)).toBe(false);
  });

  test("a live pid whose start epoch cannot be read is treated as alive", async () => {
    expect(await isOwnerAlive(`${process.pid}:1000`, async () => null)).toBe(true);
  });

  test("a dead pid is dead regardless of epoch readability", async () => {
    expect(await isOwnerAlive("999999999:1000", async () => 1000)).toBe(false);
  });
});
