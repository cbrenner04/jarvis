import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PipelineDefinition } from "../execution/pipeline-definition.ts";
import {
  analyzeFailedPipelineReopenShape,
  approvalBoundaryAllowsStatus,
  approvalDecisionAllowsStatus,
  CURRENT_OWNER_IDENTITY,
  isApprovalAuthoredStage,
  isOwnerAlive,
  type OwnerLivenessProbe,
  openStateStore,
  orphanSettlementReconciledAt,
  orphanSettlementShouldStampAttempt,
  PIPELINE_STAGE_BRANCH_KEY_TIE_ORDER_SQL,
  type Pipeline,
  type PipelineContext,
  type PipelineStageRecord,
  reconciliationStableStageStatus,
  reopenPredecessorAllowsStatus,
  reopenSuffixAllowsStatus,
  type StateStore,
  TERMINAL_RUN_STATUSES,
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

const SAMPLE_PIPELINE_CONTEXT: PipelineContext = {
  cwd: "/repo",
  configPath: "/repo/.jarvis/config.json",
  targetDir: "v2/spec",
  projectRegistry: { jarvis: { root: "/repo", origin: "git@github.com:cbrenner04/jarvis.git" } },
  seed: "ship durable context",
};

function singlePlanStagePipeline(name: string): PipelineDefinition {
  return { name, stages: [{ stageId: "plan", kind: "workflow", workflow: "plan", review: "none" }] };
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

function loadRunOrThrow(store: StateStore, runId: string): NonNullable<ReturnType<StateStore["loadRun"]>> {
  const run = store.loadRun(runId);
  if (!run) throw new Error("Run should exist");
  return run;
}

function loadPipelineOrThrow(
  store: StateStore,
  pipelineId: string,
): NonNullable<ReturnType<StateStore["loadPipeline"]>> {
  const pipeline = store.loadPipeline(pipelineId);
  if (!pipeline) throw new Error("Pipeline should exist");
  return pipeline;
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
    expect(run.readyGatePgid ?? null).toBeNull();
  });

  test("records and replaces the in-flight ready-gate group id", () => {
    const runId = seedRun(store);
    // Keystone checkpoint: baseline read semantics must turn this test RED.
    // @mutate v2/src/persistence/state-store.ts "    ...run," -> "    ...run, readyGatePgid: null,"

    store.setReadyGatePgid(runId, 4242);
    expect(loadRunOrThrow(store, runId).readyGatePgid).toBe(4242);

    store.setReadyGatePgid(runId, 5353);
    expect(loadRunOrThrow(store, runId).readyGatePgid).toBe(5353);
  });

  test("clears the in-flight ready-gate group id on settlement", () => {
    const runId = seedRun(store);
    store.setReadyGatePgid(runId, 4242);
    // Mutation checkpoint: setReadyGatePgid's pgid === null branch (its own UPDATE ... SET ready_gate_pgid = NULL)
    // @mutate v2/src/persistence/state-store.ts "if (pgid === null) {" -> "if (false) {"

    store.setReadyGatePgid(runId, null);
    expect(loadRunOrThrow(store, runId).readyGatePgid ?? null).toBeNull();
  });

  test("clearRunDownstreamInputs removes a persisted multi-file handoff from the run row", () => {
    const runId = seedRun(store, { specPath: "ready-intents/one.md" });
    store.setRunDownstreamInputs(runId, ["ready-intents/one.md", "ready-intents/two.md"]);
    expect(loadRunOrThrow(store, runId).downstreamInputs).toEqual(["ready-intents/one.md", "ready-intents/two.md"]);

    store.clearRunDownstreamInputs(runId);
    // Mutation checkpoint: state-store.test.ts clearRunDownstreamInputs
    expect(loadRunOrThrow(store, runId).downstreamInputs).toBeUndefined();
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

  test("a pre-migration database migrates dismissed_at onto existing runs as null", () => {
    const legacyDbPath = join(tmpdir(), "jarvis-test-state-legacy-dismissed-at.sqlite");
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
      const runId = "legacy-run-dismissed-at";
      raw
        .prepare(
          `INSERT INTO runs (id, project, spec_ref, created_at, status, attempt_count, worktree_path, branch, spec_path)
           VALUES (?, 'legacy-project', 'main', ?, 'in-progress', 0, '/tmp/legacy', 'legacy-branch', 'spec.md')`,
        )
        .run(runId, Date.now());
      raw.close();

      const migrated = openStateStore(legacyDbPath);
      expect(loadRunOrThrow(migrated, runId).dismissedAt).toBeNull();

      const verify = new Database(legacyDbPath);
      const row = verify.prepare("SELECT dismissed_at AS dismissedAt FROM runs WHERE id = ?").get(runId) as {
        dismissedAt: number | null;
      };
      expect(row.dismissedAt).toBeNull();
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

  test("setRunStatus stamps a finish timestamp on a terminal status", () => {
    for (const status of TERMINAL_RUN_STATUSES) {
      const runId = seedRun(store, { branch: `branch-${status}` });
      const before = Date.now();
      store.setRunStatus(runId, status);

      const run = loadRunOrThrow(store, runId);
      // @mutate v2/src/persistence/state-store.ts "isTerminalRunStatus(status) ? Date.now() : null" -> "null"
      expect(run.finishedAt).not.toBeNull();
      expect(run.finishedAt).toBeGreaterThanOrEqual(before);
      expect(run.attempts).toEqual([]);
      expect(run.reconciledAt).toBeNull();
    }
  });

  test("setRunStatus clears the finish timestamp when a run leaves a terminal status", () => {
    const runId = seedRun(store);
    store.setRunStatus(runId, "failed");
    expect(loadRunOrThrow(store, runId).finishedAt).not.toBeNull();

    store.setRunStatus(runId, "in-progress");
    // @mutate v2/src/persistence/state-store.ts "isTerminalRunStatus(status) ? Date.now() : null" -> "Date.now()"
    expect(loadRunOrThrow(store, runId).finishedAt).toBeNull();
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

  test("commitGuardedKill stamps a finish timestamp on the killed row", () => {
    const killedRunId = seedRun(store);
    store.commitGuardedKill(killedRunId);
    const killedRun = loadRunOrThrow(store, killedRunId);
    // @mutate v2/src/persistence/state-store.ts ".run(finishedAt, runId);" -> ".run(null, runId);"
    expect(killedRun.status).toBe("killed");
    expect(killedRun.finishedAt).not.toBeNull();

    const completedRunId = seedRun(store, { status: "completed", branch: "branch-completed" });
    store.commitGuardedKill(completedRunId);
    const completedRun = loadRunOrThrow(store, completedRunId);
    expect(completedRun.status).toBe("completed");
    expect(completedRun.finishedAt).toBeNull();
  });

  test("commitTerminalRunSettlement persists terminal status finish metadata cause PR evidence and failure detail", () => {
    const runId = seedRun(store);
    const failureDetail = { failureKind: "quota" as const, bindingAttempts: [] };
    const before = Date.now();

    store.commitTerminalRunSettlement({
      runId,
      status: "completed",
      terminalCause: "complete",
      prNumber: 42,
      prUrl: "https://github.com/example/pr/42",
      terminalFailureDetail: failureDetail,
    });

    const loaded = loadRunOrThrow(store, runId);
    expect(loaded.status).toBe("completed");
    expect(loaded.finishedAt).not.toBeNull();
    expect(loaded.finishedAt).toBeGreaterThanOrEqual(before);
    expect(loaded.terminalCause).toBe("complete");
    expect(loaded.prNumber).toBe(42);
    expect(loaded.prUrl).toBe("https://github.com/example/pr/42");
    expect(loaded.terminalFailureDetail).toEqual(failureDetail);

    const listed = store.listRuns().find((run) => run.id === runId);
    expect(listed?.status).toBe("completed");
    expect(listed?.finishedAt).toBe(loaded.finishedAt);
    expect(listed?.terminalCause).toBe("complete");
    expect(listed?.prNumber).toBe(42);
    expect(listed?.prUrl).toBe("https://github.com/example/pr/42");
    expect(listed?.terminalFailureDetail).toEqual(failureDetail);
  });

  test("commitTerminalRunSettlement rolls back every field on mid-settlement failure", () => {
    const runId = seedRun(store);
    store.setPrEvidence(runId, 7, "https://github.com/example/pr/7");
    store.commitTerminalRunSettlement({
      runId,
      status: "failed",
      terminalCause: "invocation_failure",
      terminalFailureDetail: { failureKind: "timeout", bindingAttempts: [], exhaustedRoleTimeout: true },
    });
    const before = loadRunOrThrow(store, runId);

    expect(() =>
      store.commitTerminalRunSettlement({
        runId,
        status: "killed",
        terminalCause: "blocked",
        prNumber: 99,
        prUrl: "https://github.com/example/pr/99",
        terminalFailureDetail: { failureKind: "quota", bindingAttempts: [] },
        beforeSecondWrite: () => {
          throw new Error("forced mid-settlement failure");
        },
      }),
    ).toThrow("forced mid-settlement failure");
    // @mutate v2/src/persistence/state-store.ts "this.db.transaction(applySettlement)();" -> "applySettlement();"

    const after = loadRunOrThrow(store, runId);
    expect(after.status).toBe(before.status);
    expect(after.finishedAt).toBe(before.finishedAt);
    expect(after.prNumber).toBe(before.prNumber);
    expect(after.prUrl).toBe(before.prUrl);
    expect(after.terminalCause).toBe(before.terminalCause);
    expect(after.terminalFailureDetail).toEqual(before.terminalFailureDetail);
  });

  test("commitTerminalRunSettlement rejects nonterminal status", () => {
    const runId = seedRun(store);
    for (const status of ["paused", "in-progress"] as const) {
      store.setRunStatus(runId, status);
      expect(() =>
        store.commitTerminalRunSettlement({
          runId,
          status,
        }),
      ).toThrow(`Terminal run settlement requires a terminal status: ${status}`);
      const run = loadRunOrThrow(store, runId);
      expect(run.status).toBe(status);
      expect(run.finishedAt).toBeNull();
    }
  });

  test("commitTerminalRunSettlement leaves omitted evidence columns unchanged", () => {
    const runId = seedRun(store);
    store.setPrEvidence(runId, 11, "https://github.com/example/pr/11");

    store.commitTerminalRunSettlement({
      runId,
      status: "killed",
    });

    const run = loadRunOrThrow(store, runId);
    expect(run.status).toBe("killed");
    expect(run.finishedAt).not.toBeNull();
    expect(run.prNumber).toBe(11);
    expect(run.prUrl).toBe("https://github.com/example/pr/11");
    expect(run.terminalCause).toBeNull();
    expect(run.terminalFailureDetail).toBeNull();
  });

  test("commitTerminalRunSettlement refuses an unknown run id", () => {
    const runA = seedRun(store, { branch: "branch-a" });
    const runB = seedRun(store, { branch: "branch-b" });
    const beforeA = loadRunOrThrow(store, runA);
    const beforeB = loadRunOrThrow(store, runB);

    expect(() =>
      store.commitTerminalRunSettlement({
        runId: "no-such-run",
        status: "killed",
      }),
    ).toThrow("Run no-such-run not found");

    expect(loadRunOrThrow(store, runA)).toEqual(beforeA);
    expect(loadRunOrThrow(store, runB)).toEqual(beforeB);
  });

  test("commitTerminalRunSettlement updates prNumber and prUrl independently", () => {
    const runId = seedRun(store);
    store.setPrEvidence(runId, 11, "https://github.com/example/pr/11");

    store.commitTerminalRunSettlement({
      runId,
      status: "completed",
      prNumber: 22,
    });
    let run = loadRunOrThrow(store, runId);
    expect(run.prNumber).toBe(22);
    expect(run.prUrl).toBe("https://github.com/example/pr/11");

    store.commitTerminalRunSettlement({
      runId,
      status: "failed",
      prUrl: "https://github.com/example/pr/99",
    });
    run = loadRunOrThrow(store, runId);
    expect(run.prNumber).toBe(22);
    expect(run.prUrl).toBe("https://github.com/example/pr/99");
  });

  test("commitTerminalRunSettlement rejects invalid terminalCause without mutating the row", () => {
    const runId = seedRun(store);
    store.setPrEvidence(runId, 5, "https://github.com/example/pr/5");
    const before = loadRunOrThrow(store, runId);

    expect(() =>
      store.commitTerminalRunSettlement({
        runId,
        status: "failed",
        terminalCause: "bogus-outcome" as never,
      }),
    ).toThrow("Invalid terminal cause: bogus-outcome");

    expect(loadRunOrThrow(store, runId)).toEqual(before);
  });

  test("commitTerminalRunSettlement clears explicitly nulled evidence columns", () => {
    const runId = seedRun(store);
    store.commitTerminalRunSettlement({
      runId,
      status: "failed",
      terminalCause: "invocation_failure",
      prNumber: 3,
      prUrl: "https://github.com/example/pr/3",
      terminalFailureDetail: { failureKind: "quota", bindingAttempts: [] },
    });

    store.commitTerminalRunSettlement({
      runId,
      status: "killed",
      terminalCause: null,
      prNumber: null,
      prUrl: null,
      terminalFailureDetail: null,
    });

    const run = loadRunOrThrow(store, runId);
    expect(run.status).toBe("killed");
    expect(run.terminalCause).toBeNull();
    expect(run.prNumber).toBeNull();
    expect(run.prUrl).toBeNull();
    expect(run.terminalFailureDetail).toBeNull();
  });

  test("pre-migration runs read terminalCause and terminalFailureDetail as null after migration 029", () => {
    const legacyDbPath = join(tmpdir(), "jarvis-test-state-legacy-terminal-settlement.sqlite");
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
      const runId = "legacy-run-terminal-settlement";
      raw
        .prepare(
          `INSERT INTO runs (id, project, spec_ref, created_at, status, attempt_count, worktree_path, branch, spec_path)
           VALUES (?, 'legacy-project', 'main', ?, 'completed', 1, '/tmp/legacy', 'legacy-branch', 'spec.md')`,
        )
        .run(runId, Date.now());
      raw.close();

      const migrated = openStateStore(legacyDbPath);
      const run = loadRunOrThrow(migrated, runId);
      expect(run.terminalCause).toBeNull();
      expect(run.terminalFailureDetail).toBeNull();
      migrated.close();
    } finally {
      removeOrchestrationStore(legacyDbPath);
    }
  });

  test("loadRun surfaces terminalFailureDetailCorrupt when terminal_failure_detail JSON is invalid", () => {
    const runId = seedRun(store);
    const raw = new Database(TEST_DB_PATH);
    raw.prepare("UPDATE runs SET terminal_failure_detail = ? WHERE id = ?").run("{not-json", runId);
    raw.close();

    const run = loadRunOrThrow(store, runId);
    expect(run.terminalFailureDetail).toBeNull();
    expect(run.terminalFailureDetailCorrupt).toBe(true);
  });
});

function insertStageRow(
  raw: Database,
  args: { id: string; pipelineId: string; stageId: string; position: number; branchKey?: string },
): void {
  raw
    .prepare(
      `INSERT INTO pipeline_stages (id, pipeline_id, stage_id, branch_key, position, status, workflow_invocation_id, started_at, ended_at, artifact, failure_detail)
       VALUES (?, ?, ?, ?, ?, 'pending', NULL, NULL, NULL, NULL, NULL)`,
    )
    .run(args.id, args.pipelineId, args.stageId, args.branchKey ?? "default", args.position);
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

  test("listPipelines returns an empty collection for an empty store", () => {
    expect(store.listPipelines()).toEqual([]);
  });

  test("listPipelines enumerates complete durable active and interrupted pipelines with ordered stages after reopen", () => {
    const interruptedDefinition: PipelineDefinition = {
      name: "interrupted-pipeline",
      stages: [
        { stageId: "approve", kind: "approval" },
        { stageId: "ship", kind: "workflow", workflow: "implement", review: "debate" },
      ],
    };
    store.close();
    store = openStateStore(TEST_DB_PATH, { currentIdentity: "enumeration-owner:1" });
    const activeId = store.createPipeline({ definition: SAMPLE_PIPELINE_DEFINITION });
    const interruptedId = store.createPipeline({ definition: interruptedDefinition });

    store.updateStage({
      pipelineId: activeId,
      stageId: "plan",
      patch: {
        status: "succeeded",
        workflowInvocationId: "workflow-plan",
        startedAt: 100,
        endedAt: 200,
        artifact: { specPath: "spec/plan.md" },
      },
    });
    store.updateStage({
      pipelineId: activeId,
      stageId: "implement",
      patch: {
        status: "failed",
        workflowInvocationId: "workflow-implement",
        startedAt: 300,
        endedAt: 400,
        failureDetail: { code: "implementation_failed", message: "failed" },
      },
    });
    store.updateStage({
      pipelineId: interruptedId,
      stageId: "ship",
      patch: {
        status: "interrupted",
        workflowInvocationId: "workflow-ship",
        startedAt: 500,
        endedAt: 600,
        artifact: { entryRunId: "run-ship", prNumber: 42 },
        failureDetail: { message: "owner exited" },
      },
    });

    const raw = new Database(TEST_DB_PATH);
    let expectedById = new Map<string, Pipeline & { stages: PipelineStageRecord[] }>();
    try {
      raw.prepare("UPDATE pipelines SET owner_identity = NULL, status = 'interrupted' WHERE id = ?").run(interruptedId);
      raw.prepare("UPDATE pipeline_stages SET position = position + 100 WHERE pipeline_id = ?").run(activeId);
      raw
        .prepare(
          `UPDATE pipeline_stages SET position = CASE stage_id
            WHEN 'implement' THEN 0 WHEN 'gate' THEN 1 WHEN 'plan' THEN 2 END
           WHERE pipeline_id = ?`,
        )
        .run(activeId);

      const expectedPipelines = raw
        .prepare(
          `SELECT id, name, created_at AS createdAt, owner_identity AS ownerIdentity, status, definition, context
           FROM pipelines WHERE id IN (?, ?)`,
        )
        .all(activeId, interruptedId) as Array<{
        id: string;
        name: string;
        createdAt: number;
        ownerIdentity: string | null;
        status: "active" | "interrupted";
        definition: string;
        context: string | null;
      }>;
      const expectedStages = raw
        .prepare(
          `SELECT id, pipeline_id AS pipelineId, stage_id AS stageId, branch_key AS branchKey, position, status,
                  workflow_invocation_id AS workflowInvocationId, started_at AS startedAt, ended_at AS endedAt,
                  artifact, failure_detail AS failureDetail, decided_at AS decidedAt
           FROM pipeline_stages WHERE pipeline_id IN (?, ?)
           ORDER BY pipeline_id, position ASC, ${PIPELINE_STAGE_BRANCH_KEY_TIE_ORDER_SQL}`,
        )
        .all(activeId, interruptedId) as Array<{
        id: string;
        pipelineId: string;
        stageId: string;
        branchKey: string;
        position: number;
        status: string;
        workflowInvocationId: string | null;
        startedAt: number | null;
        endedAt: number | null;
        artifact: string | null;
        failureDetail: string | null;
        decidedAt: number | null;
      }>;
      expectedById = new Map<string, Pipeline & { stages: PipelineStageRecord[] }>(
        expectedPipelines.map((pipeline) => [
          pipeline.id,
          {
            ...pipeline,
            definition: JSON.parse(pipeline.definition) as PipelineDefinition,
            context: pipeline.context === null ? null : (JSON.parse(pipeline.context) as PipelineContext),
            terminalPublicationFailure: null,
            terminalPublicationSucceededAt: null,
            dismissedAt: null,
            stages: expectedStages
              .filter((stage) => stage.pipelineId === pipeline.id)
              .map((stage) => ({
                ...stage,
                artifact: stage.artifact === null ? null : (JSON.parse(stage.artifact) as unknown),
                failureDetail: stage.failureDetail === null ? null : (JSON.parse(stage.failureDetail) as unknown),
              })),
          },
        ]),
      );
      expect(expectedById.size).toBe(2);
      expect(expectedStages).toHaveLength(5);
    } finally {
      raw.close();
    }

    store.close();
    store = openStateStore(TEST_DB_PATH);
    const pipelines = store.listPipelines();
    expect(pipelines).toHaveLength(2);
    expect(pipelines.map((pipeline) => pipeline.id).sort()).toEqual([activeId, interruptedId].sort());
    expect(new Map(pipelines.map((pipeline) => [pipeline.id, pipeline]))).toEqual(expectedById);
  });

  test("admits a validated multi-stage definition and reads one pending stage per authored stage in order", () => {
    const pipelineId = store.createPipeline({ definition: SAMPLE_PIPELINE_DEFINITION });

    const pipeline = store.loadPipeline(pipelineId);
    if (!pipeline) throw new Error("Pipeline should exist");

    expect(pipeline.id).toBe(pipelineId);
    expect(pipeline.name).toBe("sample-pipeline");
    expect(pipeline.createdAt).toBeGreaterThan(0);
    expect(pipeline.context).toBeNull();
    expect(pipeline.stages).toHaveLength(3);
    expect(pipeline.stages.map((stage) => stage.stageId)).toEqual(["plan", "gate", "implement"]);
    for (const stage of pipeline.stages) {
      expect(stage.pipelineId).toBe(pipelineId);
      expect(stage.branchKey).toBe("default");
      expect(stage.status).toBe("pending");
      expect(stage.workflowInvocationId).toBeNull();
      expect(stage.startedAt).toBeNull();
      expect(stage.endedAt).toBeNull();
      expect(stage.artifact).toBeNull();
      expect(stage.failureDetail).toBeNull();
    }
    expect(pipeline.stages.map((stage) => stage.position)).toEqual([0, 1, 2]);
  });

  test("retains admitted seedPath context without seed across createPipeline and store reload", () => {
    const context: PipelineContext = {
      cwd: "/repo",
      seedPath: "v2/spec/seeds/feature.md",
      configPath: "/repo/.jarvis/config.json",
    };
    const pipelineId = store.createPipeline({ definition: SAMPLE_PIPELINE_DEFINITION, context });

    const beforeClose = store.loadPipeline(pipelineId);
    if (!beforeClose) throw new Error("Pipeline should exist");
    // Mutation checkpoint: omitting `seedPath` from the admitted snapshot makes the test fail.
    expect(beforeClose.context).toEqual(context);

    store.close();
    store = openStateStore(TEST_DB_PATH);
    const reopened = store.loadPipeline(pipelineId);
    if (!reopened) throw new Error("Pipeline should exist");
    expect(reopened.context).toEqual(context);
  });

  test("legacy context JSON with only seed loads unchanged without synthesizing seedPath", () => {
    const pipelineId = store.createPipeline({ definition: SAMPLE_PIPELINE_DEFINITION });
    const legacyContext = { cwd: "/repo", seed: "legacy inline seed" };
    const raw = new Database(TEST_DB_PATH);
    try {
      raw.prepare("UPDATE pipelines SET context = ? WHERE id = ?").run(JSON.stringify(legacyContext), pipelineId);
    } finally {
      raw.close();
    }

    const pipeline = store.loadPipeline(pipelineId);
    if (!pipeline) throw new Error("Pipeline should exist");
    // Mutation checkpoint: asserting `seedPath` is present on reload makes the test fail.
    expect(pipeline.context).toEqual(legacyContext);
  });

  test("retains the admitted context snapshot after the live source context is mutated, and round-trips across close and reopen", () => {
    const context: PipelineContext = { ...SAMPLE_PIPELINE_CONTEXT };
    const pipelineId = store.createPipeline({ definition: SAMPLE_PIPELINE_DEFINITION, context });

    context.cwd = "/mutated";
    context.seed = "mutated seed";
    delete context.configPath;

    const beforeClose = store.loadPipeline(pipelineId);
    if (!beforeClose) throw new Error("Pipeline should exist");
    expect(beforeClose.context).toEqual(SAMPLE_PIPELINE_CONTEXT);

    store.close();
    store = openStateStore(TEST_DB_PATH);
    const reopened = store.loadPipeline(pipelineId);
    if (!reopened) throw new Error("Pipeline should exist");
    expect(reopened.context).toEqual(SAMPLE_PIPELINE_CONTEXT);
  });

  test("a pre-context-migration database opens successfully and loads legacy pipeline context as absent", () => {
    const legacyDbPath = join(tmpdir(), "jarvis-test-state-legacy-pipeline-context.sqlite");
    removeOrchestrationStore(legacyDbPath);
    try {
      const raw = new Database(legacyDbPath);
      raw.exec(`
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
      const pipelineId = "legacy-pipeline";
      raw
        .prepare(
          "INSERT INTO pipelines (id, name, created_at, owner_identity, status, definition) VALUES (?, ?, ?, ?, 'active', ?)",
        )
        .run(pipelineId, "legacy-pipeline", Date.now(), "legacy-owner:1", JSON.stringify(SAMPLE_PIPELINE_DEFINITION));
      raw
        .prepare(
          `INSERT INTO pipeline_stages (id, pipeline_id, stage_id, position, status, workflow_invocation_id, started_at, ended_at, artifact, failure_detail)
           VALUES (?, ?, 'plan', 0, 'pending', NULL, NULL, NULL, NULL, NULL)`,
        )
        .run("legacy-stage", pipelineId);
      raw.close();

      const migrated = openStateStore(legacyDbPath);
      const pipeline = migrated.loadPipeline(pipelineId);
      if (!pipeline) throw new Error("Pipeline should exist");
      expect(pipeline.context).toBeNull();
      expect(pipeline.definition).toEqual(SAMPLE_PIPELINE_DEFINITION);

      const verify = new Database(legacyDbPath);
      const row = verify.prepare("SELECT context FROM pipelines WHERE id = ?").get(pipelineId) as {
        context: string | null;
      };
      expect(row.context).toBeNull();
      verify.close();
      migrated.close();
    } finally {
      removeOrchestrationStore(legacyDbPath);
    }
  });

  test("a pre-027-migration database opens successfully and loads dismissedAt as null", () => {
    const legacyDbPath = join(tmpdir(), "jarvis-test-state-legacy-dismissed-at.sqlite");
    removeOrchestrationStore(legacyDbPath);
    try {
      const raw = new Database(legacyDbPath);
      raw.exec(`
        CREATE TABLE pipelines (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          definition TEXT NOT NULL,
          owner_identity TEXT,
          status TEXT NOT NULL DEFAULT 'active',
          context TEXT,
          terminal_publication_failure TEXT,
          terminal_publication_succeeded_at INTEGER
        );
        CREATE TABLE pipeline_stages (
          id TEXT PRIMARY KEY,
          pipeline_id TEXT NOT NULL REFERENCES pipelines(id),
          stage_id TEXT NOT NULL,
          branch_key TEXT NOT NULL DEFAULT 'default',
          position INTEGER NOT NULL,
          status TEXT NOT NULL,
          workflow_invocation_id TEXT,
          started_at INTEGER,
          ended_at INTEGER,
          artifact TEXT,
          failure_detail TEXT,
          decided_at INTEGER,
          UNIQUE (pipeline_id, stage_id, branch_key)
        );
        CREATE TABLE _migrations (
          id TEXT PRIMARY KEY,
          applied_at INTEGER NOT NULL
        );
      `);
      for (const id of [
        "013-pipelines-and-stages",
        "014-pipeline-owner-identity-and-status",
        "015-pipeline-context",
        "018-pipeline-terminal-publication",
        "020-pipeline-stage-branch-key",
        "024-pipeline-stage-decided-at",
      ]) {
        raw.prepare("INSERT INTO _migrations (id, applied_at) VALUES (?, ?)").run(id, Date.now());
      }
      const pipelineId = "pre-027-pipeline";
      raw
        .prepare(
          "INSERT INTO pipelines (id, name, created_at, owner_identity, status, definition) VALUES (?, ?, ?, ?, 'active', ?)",
        )
        .run(pipelineId, "pre-027-pipeline", Date.now(), "legacy-owner:1", JSON.stringify(SAMPLE_PIPELINE_DEFINITION));
      raw
        .prepare(
          `INSERT INTO pipeline_stages (id, pipeline_id, stage_id, branch_key, position, status, workflow_invocation_id, started_at, ended_at, artifact, failure_detail, decided_at)
           VALUES (?, ?, 'plan', 'default', 0, 'pending', NULL, NULL, NULL, NULL, NULL, NULL)`,
        )
        .run("pre-027-stage", pipelineId);
      raw.close();

      const migrated = openStateStore(legacyDbPath);
      const pipeline = migrated.loadPipeline(pipelineId);
      if (!pipeline) throw new Error("Pipeline should exist");
      expect(pipeline.dismissedAt).toBeNull();
      expect(pipeline.stages).toHaveLength(1);
      const listed = migrated.listPipelines();
      expect(listed).toHaveLength(1);
      expect(listed[0]?.dismissedAt).toBeNull();
      migrated.close();
    } finally {
      removeOrchestrationStore(legacyDbPath);
    }
  });

  test("legacy pipeline rows without stored context do not synthesize admission defaults on load", () => {
    const pipelineId = store.createPipeline({ definition: SAMPLE_PIPELINE_DEFINITION });
    const raw = new Database(TEST_DB_PATH);
    try {
      raw.prepare("UPDATE pipelines SET context = NULL WHERE id = ?").run(pipelineId);
    } finally {
      raw.close();
    }

    const pipeline = store.loadPipeline(pipelineId);
    if (!pipeline) throw new Error("Pipeline should exist");
    expect(pipeline.context).toBeNull();
    expect(pipeline.context).not.toEqual(
      expect.objectContaining({ cwd: expect.any(String), seed: expect.any(String) }),
    );
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
          `INSERT INTO pipeline_stages (id, pipeline_id, stage_id, branch_key, position, status, workflow_invocation_id, started_at, ended_at, artifact, failure_detail)
           VALUES (?, ?, ?, ?, ?, 'pending', NULL, NULL, NULL, NULL, NULL)`,
        )
        .run("stage-orphan", "missing-pipeline", "plan", "default", 0),
    ).toThrow();
  });

  test("rejects duplicate (pipeline_id, stage_id, branch_key) but allows duplicate positions across branch siblings", () => {
    const pipelineId = store.createPipeline({
      definition: {
        name: "dup-check",
        stages: [{ stageId: "plan", kind: "workflow", workflow: "plan", review: "none" }],
      },
    });

    const raw = new Database(TEST_DB_PATH);
    try {
      expect(() =>
        insertStageRow(raw, { id: "stage-dup-id", pipelineId, stageId: "plan", position: 1, branchKey: "default" }),
      ).toThrow();

      insertStageRow(raw, {
        id: "stage-branch-sibling",
        pipelineId,
        stageId: "plan",
        position: 0,
        branchKey: "branch-a",
      });
      const branchRow = raw
        .prepare("SELECT branch_key AS branchKey, position FROM pipeline_stages WHERE id = ?")
        .get("stage-branch-sibling") as { branchKey: string; position: number };
      expect(branchRow.branchKey).toBe("branch-a");
      expect(branchRow.position).toBe(0);
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

  test("updateStage stamps endedAt on a terminal status write", () => {
    for (const status of ["succeeded", "failed", "interrupted", "skipped"] as const) {
      const pipelineId = store.createPipeline({ definition: singlePlanStagePipeline(`terminal-${status}`) });
      const before = Date.now();
      store.updateStage({ pipelineId, stageId: "plan", patch: { status } });

      const stage = store.loadPipeline(pipelineId)?.stages.find((row) => row.stageId === "plan");
      if (!stage) throw new Error("plan stage should exist");
      // @mutate v2/src/persistence/state-store.ts "return { ...patch, endedAt: now };" -> "return patch;"
      expect(stage.endedAt).not.toBeNull();
      expect(stage.endedAt).toBeGreaterThanOrEqual(before);
      expect(stage.startedAt).toBeNull();
    }

    const startedPipelineId = store.createPipeline({
      definition: singlePlanStagePipeline("terminal-preserves-started"),
    });
    store.updateStage({ pipelineId: startedPipelineId, stageId: "plan", patch: { startedAt: 500 } });
    store.updateStage({ pipelineId: startedPipelineId, stageId: "plan", patch: { status: "succeeded" } });
    const startedStage = store.loadPipeline(startedPipelineId)?.stages.find((row) => row.stageId === "plan");
    if (!startedStage) throw new Error("plan stage should exist");
    expect(startedStage.startedAt).toBe(500);
    expect(startedStage.endedAt).not.toBeNull();
  });

  test("updateStage leaves endedAt null on a non-terminal status write", () => {
    for (const status of ["awaiting", "running"]) {
      const pipelineId = store.createPipeline({ definition: singlePlanStagePipeline(`non-terminal-${status}`) });
      store.updateStage({ pipelineId, stageId: "plan", patch: { status } });

      const stage = store.loadPipeline(pipelineId)?.stages.find((row) => row.stageId === "plan");
      if (!stage) throw new Error("plan stage should exist");
      // @mutate v2/src/persistence/state-store.ts "!isTerminalStageStatus(patch.status)" -> "false"
      expect(stage.endedAt).toBeNull();
    }
  });

  test("updateStage preserves a caller-supplied endedAt on a terminal status write", () => {
    const pipelineId = store.createPipeline({ definition: singlePlanStagePipeline("terminal-caller-endedat") });
    store.updateStage({ pipelineId, stageId: "plan", patch: { status: "failed", endedAt: 1_700_000_000_000 } });

    const stage = store.loadPipeline(pipelineId)?.stages.find((row) => row.stageId === "plan");
    if (!stage) throw new Error("plan stage should exist");
    // @mutate v2/src/persistence/state-store.ts "typeof patch.endedAt === \"number\"" -> "false"
    expect(stage.endedAt).toBe(1_700_000_000_000);
  });

  function approvalStageRecord(pipeline: Pipeline & { stages: PipelineStageRecord[] }): PipelineStageRecord {
    const stage = pipeline.stages.find((row) => row.stageId === "gate");
    if (!stage) throw new Error("approval stage should exist");
    return stage;
  }

  test("closing and reopening preserves approval rows by durable id and authored stageId in awaiting, approved, and rejected states", () => {
    const pipelineId = store.createPipeline({ definition: SAMPLE_PIPELINE_DEFINITION });
    const admitted = store.loadPipeline(pipelineId);
    if (!admitted) throw new Error("Pipeline should exist");
    const approval = approvalStageRecord(admitted);
    const durableId = approval.id;
    const authoredStageId = approval.stageId;

    for (const status of ["awaiting", "approved", "rejected"] as const) {
      const raw = new Database(TEST_DB_PATH);
      try {
        raw.prepare("UPDATE pipeline_stages SET status = ? WHERE id = ?").run(status, durableId);
      } finally {
        raw.close();
      }

      store.close();
      store = openStateStore(TEST_DB_PATH);
      const reopened = store.loadPipeline(pipelineId);
      if (!reopened) throw new Error("Pipeline should exist");
      const row = reopened.stages.find((stage) => stage.id === durableId);
      if (!row) throw new Error("approval row should exist");
      expect(row.stageId).toBe(authoredStageId);
      expect(row.status).toBe(status);
    }
  });

  test("commitApprovalBoundary applies only to a matching pending approval row and refuses workflow, wrong, and non-pending rows without mutation", () => {
    const pipelineId = store.createPipeline({ definition: SAMPLE_PIPELINE_DEFINITION });
    const before = store.loadPipeline(pipelineId);
    if (!before) throw new Error("Pipeline should exist");
    const approval = approvalStageRecord(before);
    const workflow = before.stages.find((stage) => stage.stageId === "plan");
    if (!workflow) throw new Error("workflow stage should exist");

    expect(store.commitApprovalBoundary({ stageRecordId: approval.id })).toEqual({
      kind: "applied",
      stageRecordId: approval.id,
    });
    expect(approvalStageRecord(loadPipelineOrThrow(store, pipelineId)).status).toBe("awaiting");

    const afterBoundary = loadPipelineOrThrow(store, pipelineId);
    expect(store.commitApprovalBoundary({ stageRecordId: approval.id })).toEqual({
      kind: "refused",
      stageRecordId: approval.id,
      reason: "status_not_pending",
    });
    expect(store.commitApprovalBoundary({ stageRecordId: workflow.id })).toEqual({
      kind: "refused",
      stageRecordId: workflow.id,
      reason: "not_approval_stage",
    });
    expect(store.commitApprovalBoundary({ stageRecordId: "missing-row" })).toEqual({
      kind: "refused",
      stageRecordId: "missing-row",
      reason: "stage_not_found",
    });
    expect(store.loadPipeline(pipelineId)).toEqual(afterBoundary);
  });

  test("two store handles deciding one awaiting approval admit exactly one result and refuse duplicates without mutation", () => {
    const pipelineId = store.createPipeline({ definition: SAMPLE_PIPELINE_DEFINITION });
    const approval = approvalStageRecord(loadPipelineOrThrow(store, pipelineId));
    expect(store.commitApprovalBoundary({ stageRecordId: approval.id })).toEqual({
      kind: "applied",
      stageRecordId: approval.id,
    });

    const storeA = openStateStore(TEST_DB_PATH);
    const storeB = openStateStore(TEST_DB_PATH);
    try {
      const first = storeA.commitApprovalDecision({ stageRecordId: approval.id, decision: "approved" });
      const second = storeB.commitApprovalDecision({ stageRecordId: approval.id, decision: "rejected" });
      const outcomes = [first, second];
      expect(outcomes.filter((outcome) => outcome.kind === "applied")).toHaveLength(1);
      expect(outcomes.filter((outcome) => outcome.kind === "refused")).toHaveLength(1);
      const refused = outcomes.find((outcome) => outcome.kind === "refused");
      expect(refused).toEqual({
        kind: "refused",
        stageRecordId: approval.id,
        reason: "status_not_awaiting",
      });

      const afterDecision = loadPipelineOrThrow(store, pipelineId);
      expect(store.commitApprovalDecision({ stageRecordId: approval.id, decision: "approved" })).toEqual({
        kind: "refused",
        stageRecordId: approval.id,
        reason: "status_not_awaiting",
      });
      expect(store.commitApprovalDecision({ stageRecordId: approval.id, decision: "rejected" })).toEqual({
        kind: "refused",
        stageRecordId: approval.id,
        reason: "status_not_awaiting",
      });
      expect(
        store.commitApprovalDecision({
          stageRecordId: approval.id,
          decision: "bogus" as "approved",
        }),
      ).toEqual({
        kind: "refused",
        stageRecordId: approval.id,
        reason: "invalid_decision",
      });
      expect(store.loadPipeline(pipelineId)).toEqual(afterDecision);
    } finally {
      storeA.close();
      storeB.close();
    }
  });

  test("commitApprovalDecision stamps decidedAt on the decided row", () => {
    const before = Date.now();
    for (const decision of ["approved", "rejected"] as const) {
      const pipelineId = store.createPipeline({ definition: SAMPLE_PIPELINE_DEFINITION });
      const approval = approvalStageRecord(loadPipelineOrThrow(store, pipelineId));
      store.commitApprovalBoundary({ stageRecordId: approval.id });

      // @mutate v2/src/persistence/state-store.ts "decidedAt: Date.now()," -> "decidedAt: null,"
      expect(store.commitApprovalDecision({ stageRecordId: approval.id, decision })).toEqual({
        kind: "applied",
        stageRecordId: approval.id,
      });

      const loaded = loadPipelineOrThrow(store, pipelineId);
      const decided = approvalStageRecord(loaded);
      expect(typeof decided.decidedAt).toBe("number");
      expect(decided.decidedAt as number).toBeGreaterThanOrEqual(before);
      for (const stage of loaded.stages) {
        if (stage.id !== decided.id) expect(stage.decidedAt).toBeNull();
      }

      const listed = store.listPipelines().find((pipeline) => pipeline.id === pipelineId);
      if (!listed) throw new Error("pipeline should be listed");
      expect(approvalStageRecord(listed).decidedAt).toBe(decided.decidedAt);
    }
  });

  test("commitApprovalBoundary leaves decidedAt null on an awaiting row", () => {
    const pipelineId = store.createPipeline({ definition: SAMPLE_PIPELINE_DEFINITION });
    const approval = approvalStageRecord(loadPipelineOrThrow(store, pipelineId));

    // @mutate v2/src/persistence/state-store.ts "decidedAt: null," -> "decidedAt: Date.now(),"
    expect(store.commitApprovalBoundary({ stageRecordId: approval.id })).toEqual({
      kind: "applied",
      stageRecordId: approval.id,
    });
    const afterBoundary = approvalStageRecord(loadPipelineOrThrow(store, pipelineId));
    expect(afterBoundary.status).toBe("awaiting");
    expect(afterBoundary.decidedAt).toBeNull();

    const untouchedPipelineId = store.createPipeline({ definition: SAMPLE_PIPELINE_DEFINITION });
    const untouchedApproval = approvalStageRecord(loadPipelineOrThrow(store, untouchedPipelineId));
    expect(store.commitApprovalDecision({ stageRecordId: untouchedApproval.id, decision: "approved" })).toEqual({
      kind: "refused",
      stageRecordId: untouchedApproval.id,
      reason: "status_not_awaiting",
    });
    expect(approvalStageRecord(loadPipelineOrThrow(store, untouchedPipelineId)).decidedAt).toBeNull();
  });

  test("inverting pending-boundary guard fails approval boundary regression", () => {
    expect(approvalBoundaryAllowsStatus("pending")).toBe(true);
    expect(!approvalBoundaryAllowsStatus("pending")).toBe(false);
  });

  test("inverting approval-kind guard fails approval boundary regression", () => {
    expect(isApprovalAuthoredStage("gate", SAMPLE_PIPELINE_DEFINITION)).toBe(true);
    expect(isApprovalAuthoredStage("plan", SAMPLE_PIPELINE_DEFINITION)).toBe(false);
    expect(!isApprovalAuthoredStage("gate", SAMPLE_PIPELINE_DEFINITION)).toBe(false);
  });

  test("inverting awaiting-decision guard fails approval decision regression", () => {
    expect(approvalDecisionAllowsStatus("awaiting")).toBe(true);
    expect(!approvalDecisionAllowsStatus("awaiting")).toBe(false);
  });

  test("two branch rows for the same stageId persist distinct branchKey, status, and artifact payloads", () => {
    const pipelineId = store.createPipeline({ definition: singlePlanStagePipeline("branch-rows") });
    const branchRecordId = store.createPipelineStageBranch({
      pipelineId,
      stageId: "plan",
      branchKey: "branch-a",
    });

    store.updateStage({
      pipelineId,
      stageId: "plan",
      patch: { status: "succeeded", artifact: { specPath: "default-spec.md" } },
    });
    store.updateStage({
      pipelineId,
      stageId: "plan",
      branchKey: "branch-a",
      patch: {
        status: "failed",
        artifact: { downstreamInputs: ["ready-intents/a.md", "ready-intents/b.md"] },
      },
    });

    const pipeline = loadPipelineOrThrow(store, pipelineId);
    // Mutation checkpoint: collapsing storage to one row per stageId must turn this RED.
    expect(pipeline.stages.map((stage) => stage.branchKey).sort()).toEqual(["branch-a", "default"]);
    expect(pipeline.stages).toHaveLength(2);
    const defaultRow = pipeline.stages.find((stage) => stage.branchKey === "default");
    const branchRow = pipeline.stages.find((stage) => stage.branchKey === "branch-a");
    expect(defaultRow?.status).toBe("succeeded");
    expect(defaultRow?.artifact).toEqual({ specPath: "default-spec.md" });
    expect(branchRow?.id).toBe(branchRecordId);
    expect(branchRow?.status).toBe("failed");
    expect(branchRow?.artifact).toEqual({
      downstreamInputs: ["ready-intents/a.md", "ready-intents/b.md"],
    });
  });

  test("inverting branch-row guard fails branch-key regression", () => {
    const pipelineId = store.createPipeline({ definition: singlePlanStagePipeline("branch-guard") });
    store.createPipelineStageBranch({ pipelineId, stageId: "plan", branchKey: "branch-a" });
    expect(() => store.createPipelineStageBranch({ pipelineId, stageId: "plan", branchKey: "branch-a" })).toThrow(
      /Branch branch-a already exists for stage plan/u,
    );
    expect(() =>
      store.createPipelineStageBranch({ pipelineId, stageId: "unknown-stage", branchKey: "branch-b" }),
    ).toThrow(/Stage unknown-stage not found in pipeline/u);
    expect(() =>
      store.createPipelineStageBranch({ pipelineId: "unknown-pipeline", stageId: "plan", branchKey: "branch-b" }),
    ).toThrow(/Pipeline unknown-pipeline not found/u);
    expect(loadPipelineOrThrow(store, pipelineId).stages.filter((stage) => stage.stageId === "plan")).toHaveLength(2);
  });

  test("stage artifact with two downstream-input file paths round-trips through write and read", () => {
    const pipelineId = store.createPipeline({ definition: singlePlanStagePipeline("downstream-inputs") });
    const artifact = { downstreamInputs: ["ready-intents/a.md", "ready-intents/b.md"] };
    store.updateStage({ pipelineId, stageId: "plan", patch: { artifact } });
    store.close();

    store = openStateStore(TEST_DB_PATH);
    const loaded = loadPipelineOrThrow(store, pipelineId).stages[0]?.artifact;
    expect(loaded).toEqual(artifact);
    // Mutation checkpoint: storing only one path, a directory path, or dropping downstreamInputs
    // must turn this RED.
    expect((loaded as { downstreamInputs: string[] }).downstreamInputs).toEqual([
      "ready-intents/a.md",
      "ready-intents/b.md",
    ]);
  });

  test("createPipelineStageBranch admits pending branch rows on workflow and approval stages", () => {
    const pipelineId = store.createPipeline({ definition: SAMPLE_PIPELINE_DEFINITION });
    const admitted = loadPipelineOrThrow(store, pipelineId);
    const defaultPlan = admitted.stages.find((stage) => stage.stageId === "plan");
    const defaultGate = admitted.stages.find((stage) => stage.stageId === "gate");
    if (!defaultPlan || !defaultGate) throw new Error("default siblings should exist");

    const planBranchId = store.createPipelineStageBranch({
      pipelineId,
      stageId: "plan",
      branchKey: "plan-branch",
    });
    const gateBranchId = store.createPipelineStageBranch({
      pipelineId,
      stageId: "gate",
      branchKey: "gate-branch",
    });

    const pipeline = loadPipelineOrThrow(store, pipelineId);
    const planBranch = pipeline.stages.find((stage) => stage.id === planBranchId);
    const gateBranch = pipeline.stages.find((stage) => stage.id === gateBranchId);
    if (!planBranch || !gateBranch) throw new Error("branch rows should exist");

    for (const [branch, defaultSibling] of [
      [planBranch, defaultPlan],
      [gateBranch, defaultGate],
    ] as const) {
      expect(branch.status).toBe("pending");
      expect(branch.workflowInvocationId).toBeNull();
      expect(branch.startedAt).toBeNull();
      expect(branch.endedAt).toBeNull();
      expect(branch.artifact).toBeNull();
      expect(branch.failureDetail).toBeNull();
      expect(branch.position).toBe(defaultSibling.position);
    }
  });

  test("loadPipeline and listPipelines order branch siblings at the same position with default first", () => {
    const pipelineId = store.createPipeline({ definition: singlePlanStagePipeline("position-tie") });
    store.createPipelineStageBranch({ pipelineId, stageId: "plan", branchKey: "branch-z" });
    store.createPipelineStageBranch({ pipelineId, stageId: "plan", branchKey: "branch-a" });

    const loaded = loadPipelineOrThrow(store, pipelineId);
    expect(loaded.stages.map((stage) => stage.branchKey)).toEqual(["default", "branch-a", "branch-z"]);
    expect(new Set(loaded.stages.map((stage) => stage.position))).toEqual(new Set([0]));

    const listed = store.listPipelines().find((pipeline) => pipeline.id === pipelineId);
    expect(listed?.stages.map((stage) => stage.branchKey)).toEqual(["default", "branch-a", "branch-z"]);
  });

  test("a pre-019 fixture with pipeline_stages rows upgrades through 020, backfills branch_key, and enforces branch uniqueness", () => {
    const legacyDbPath = join(tmpdir(), "jarvis-test-state-legacy-branch-key.sqlite");
    removeOrchestrationStore(legacyDbPath);
    try {
      const raw = new Database(legacyDbPath);
      raw.exec(`
        CREATE TABLE pipelines (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          definition TEXT NOT NULL,
          owner_identity TEXT,
          status TEXT NOT NULL DEFAULT 'active',
          context TEXT,
          terminal_publication_failure TEXT,
          terminal_publication_succeeded_at INTEGER
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
        "015-pipeline-context",
        "016-run-reconciled-at",
        "017-run-ready-gate-repair-fence",
        "018-pipeline-terminal-publication",
        "019-run-retained-finalization-checkpoint",
      ]) {
        raw.prepare("INSERT INTO _migrations (id, applied_at) VALUES (?, ?)").run(id, Date.now());
      }
      const pipelineId = "legacy-branch-pipeline";
      raw
        .prepare(
          "INSERT INTO pipelines (id, name, created_at, owner_identity, status, definition) VALUES (?, ?, ?, ?, 'active', ?)",
        )
        .run(
          pipelineId,
          "legacy-branch-pipeline",
          Date.now(),
          "legacy-owner:1",
          JSON.stringify(SAMPLE_PIPELINE_DEFINITION),
        );
      raw
        .prepare(
          `INSERT INTO pipeline_stages (id, pipeline_id, stage_id, position, status, workflow_invocation_id, started_at, ended_at, artifact, failure_detail)
           VALUES (?, ?, 'plan', 0, 'succeeded', 'workflow-plan', 100, 200, ?, NULL)`,
        )
        .run("legacy-stage", pipelineId, JSON.stringify({ specPath: "spec/plan.md" }));
      raw.close();

      const migrated = openStateStore(legacyDbPath);
      const pipeline = migrated.loadPipeline(pipelineId);
      if (!pipeline) throw new Error("Pipeline should exist");
      expect(pipeline.stages).toHaveLength(1);
      expect(pipeline.stages[0]?.branchKey).toBe("default");
      expect(pipeline.stages[0]?.artifact).toEqual({ specPath: "spec/plan.md" });

      const verify = new Database(legacyDbPath);
      const branchKeyRow = verify
        .prepare("SELECT branch_key AS branchKey FROM pipeline_stages WHERE id = ?")
        .get("legacy-stage") as { branchKey: string };
      expect(branchKeyRow.branchKey).toBe("default");
      expect(() =>
        verify
          .prepare(
            `INSERT INTO pipeline_stages (id, pipeline_id, stage_id, branch_key, position, status, workflow_invocation_id, started_at, ended_at, artifact, failure_detail)
             VALUES (?, ?, 'plan', 'default', 0, 'pending', NULL, NULL, NULL, NULL, NULL)`,
          )
          .run("duplicate-default-branch", pipelineId),
      ).toThrow();
      insertStageRow(verify, {
        id: "legacy-branch-sibling",
        pipelineId,
        stageId: "plan",
        position: 0,
        branchKey: "branch-a",
      });
      verify.close();
      migrated.close();
    } finally {
      removeOrchestrationStore(legacyDbPath);
    }
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
      expect(migrationCount.total).toBe(26);
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
});

describe("pipeline reconciliation", () => {
  const PRIOR_IDENTITY = "11111:1000000";
  const CURRENT_IDENTITY = "22222:2000000";
  const STALE_COMPLETED_AT = 1_700_000_000_000;

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

  function seedOrphanRun(overrides: Partial<Parameters<StateStore["createRun"]>[0]> = {}): string {
    return seedRun(seedStore, { branch: `branch-${crypto.randomUUID()}`, ...overrides });
  }

  function setAttemptCompletedAt(attemptId: string, completedAt: number): void {
    const raw = new Database(TEST_DB_PATH);
    raw.prepare("UPDATE attempts SET completed_at = ? WHERE id = ?").run(completedAt, attemptId);
    raw.close();
  }

  test("beginRunReconciliation stamps reconciliation finish time on orphaned runs", async () => {
    const sweepStore = openSweepStore(async () => false);

    const inProgressRunId = seedOrphanRun();
    const inProgressAttemptId = seedStore.recordAttemptStart(inProgressRunId);

    const noAttemptRunId = seedOrphanRun();

    const completedOnlyRunId = seedOrphanRun();
    const completedAttemptId = seedStore.recordAttemptStart(completedOnlyRunId);
    seedStore.commitCompletionBoundary({
      attemptId: completedAttemptId,
      runStatus: "in-progress",
      outcomeKind: "progress",
    });
    setAttemptCompletedAt(completedAttemptId, STALE_COMPLETED_AT);

    const priorAndOpenRunId = seedOrphanRun();
    const priorAttemptId = seedStore.recordAttemptStart(priorAndOpenRunId);
    seedStore.commitCompletionBoundary({
      attemptId: priorAttemptId,
      runStatus: "in-progress",
      outcomeKind: "progress",
    });
    const openAttemptId = seedStore.recordAttemptStart(priorAndOpenRunId);
    setAttemptCompletedAt(priorAttemptId, STALE_COMPLETED_AT);

    const reviewDebateRunId = seedOrphanRun({
      stepId: "review-debate",
      workflowSnapshot: {
        invocationId: "inv-review-debate",
        steps: [{ stepId: "review-debate", role: "review", behavior: "review-debate" }],
      },
    });
    const reviewDebateAttemptId = seedStore.recordAttemptStart(reviewDebateRunId);

    const idempotentRunId = seedOrphanRun();

    const alreadyKilledRunId = seedOrphanRun({ status: "killed" });
    const rawKilled = new Database(TEST_DB_PATH);
    rawKilled.prepare("UPDATE runs SET reconciled_at = ? WHERE id = ?").run(1_600_000_000_000, alreadyKilledRunId);
    rawKilled.close();

    await sweepStore.beginRunReconciliation();

    const inProgressRun = loadRunOrThrow(sweepStore, inProgressRunId);
    expect(inProgressRun.status).toBe("killed");
    expect(inProgressRun.reconciledAt).toBeNull();
    expect(inProgressRun.attemptCount).toBe(0);
    expect(inProgressRun.attempts).toHaveLength(1);
    expect(inProgressRun.attempts[0]?.id).toBe(inProgressAttemptId);
    expect(inProgressRun.attempts[0]?.status).toBe("in-progress");
    expect(inProgressRun.attempts[0]?.outcomeKind).toBeNull();
    expect(inProgressRun.attempts[0]?.completedAt).not.toBeNull();

    const noAttemptRun = loadRunOrThrow(sweepStore, noAttemptRunId);
    expect(noAttemptRun.status).toBe("killed");
    expect(noAttemptRun.reconciledAt).not.toBeNull();
    expect(noAttemptRun.attempts).toHaveLength(0);
    expect(sweepStore.listRuns().find((run) => run.id === noAttemptRunId)?.reconciledAt).toBe(
      noAttemptRun.reconciledAt,
    );

    const completedOnlyRun = loadRunOrThrow(sweepStore, completedOnlyRunId);
    expect(completedOnlyRun.reconciledAt).not.toBeNull();
    expect(completedOnlyRun.reconciledAt).toBeGreaterThan(STALE_COMPLETED_AT);
    expect(completedOnlyRun.attempts[0]?.completedAt).toBe(STALE_COMPLETED_AT);

    const priorAndOpenRun = loadRunOrThrow(sweepStore, priorAndOpenRunId);
    expect(priorAndOpenRun.reconciledAt).toBeNull();
    const openAttempt = priorAndOpenRun.attempts.find((attempt) => attempt.id === openAttemptId);
    expect(openAttempt?.completedAt).not.toBeNull();
    expect(openAttempt?.completedAt).toBeGreaterThan(STALE_COMPLETED_AT);

    const reviewDebateRun = loadRunOrThrow(sweepStore, reviewDebateRunId);
    expect(reviewDebateRun.status).toBe("interrupted");
    expect(reviewDebateRun.reconciledAt).toBeNull();
    expect(reviewDebateRun.attempts[0]?.id).toBe(reviewDebateAttemptId);
    expect(reviewDebateRun.attempts[0]?.status).toBe("in-progress");
    expect(reviewDebateRun.attempts[0]?.completedAt).not.toBeNull();

    const afterFirst = loadRunOrThrow(sweepStore, idempotentRunId);
    await sweepStore.beginRunReconciliation();
    expect(loadRunOrThrow(sweepStore, idempotentRunId).reconciledAt).toBe(afterFirst.reconciledAt);

    expect(loadRunOrThrow(sweepStore, alreadyKilledRunId).reconciledAt).toBe(1_600_000_000_000);

    sweepStore.close();
  });

  test("a dismissed run stays loadable and keeps its lifecycle", async () => {
    const sweepStore = openSweepStore(async () => false);

    const runId = seedOrphanRun({ branch: "dismissed-branch" });
    seedStore.dismissRun(runId);

    expect(loadRunOrThrow(seedStore, runId).dismissedAt).not.toBeNull();
    expect(seedStore.listRuns().find((run) => run.id === runId)?.dismissedAt).not.toBeNull();
    expect(
      seedStore.findRunByProjectBranch({ project: "test-project", branch: "dismissed-branch", stepId: null })
        ?.dismissedAt,
    ).not.toBeNull();

    await sweepStore.beginRunReconciliation();

    const swept = loadRunOrThrow(sweepStore, runId);
    expect(swept.status).toBe("killed");
    expect(swept.dismissedAt).not.toBeNull();

    sweepStore.close();
  });

  // Inverting `orphanSettlementReconciledAt` to always return `finishAt` turns the first assertion
  // RED; inverting `orphanSettlementShouldStampAttempt` to ignore `runUpdateApplied` turns the
  // second RED — same guard-inversion proof without a production test hook.
  test("orphan settlement reconciled_at guard inversion", () => {
    expect(orphanSettlementReconciledAt("attempt-1", 1_700_000_000_000)).toBeNull();
    expect(orphanSettlementReconciledAt(undefined, 1_700_000_000_000)).toBe(1_700_000_000_000);
  });

  test("orphan settlement attempt stamp guard inversion", () => {
    expect(orphanSettlementShouldStampAttempt(true, "attempt-1")).toBe(true);
    expect(orphanSettlementShouldStampAttempt(false, "attempt-1")).toBe(false);
    expect(orphanSettlementShouldStampAttempt(true, undefined)).toBe(false);
  });

  test("beginRunReconciliation does not stamp attempt when guarded run update does not apply", async () => {
    const runId = seedOrphanRun();
    const attemptId = seedStore.recordAttemptStart(runId);

    let resolveProbe!: () => void;
    const probeBlocked = new Promise<void>((resolve) => {
      resolveProbe = resolve;
    });

    const sweepStore = openSweepStore(async () => {
      await probeBlocked;
      return false;
    });

    const reconciliation = sweepStore.beginRunReconciliation();

    const raw = new Database(TEST_DB_PATH);
    raw.prepare("UPDATE runs SET status = 'killed' WHERE id = ?").run(runId);
    raw.close();

    resolveProbe();
    await reconciliation;

    const run = loadRunOrThrow(sweepStore, runId);
    expect(run.status).toBe("killed");
    expect(run.attempts[0]?.id).toBe(attemptId);
    expect(run.attempts[0]?.completedAt).toBeNull();

    sweepStore.close();
  });

  test("orphan settlement reconciled_at fallback does not fabricate attempt rows", async () => {
    const sweepStore = openSweepStore(async () => false);
    const runId = seedOrphanRun();

    await sweepStore.beginRunReconciliation();

    const run = loadRunOrThrow(sweepStore, runId);
    expect(run.attempts).toHaveLength(0);
    expect(run.reconciledAt).not.toBeNull();

    sweepStore.close();
  });

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

  test("restart reconciliation leaves a failed stage and its following skipped rows unchanged", async () => {
    const pipelineId = seedPipeline(PRIOR_IDENTITY, ["succeeded", "failed", "skipped", "skipped"]);
    const before = seedStore.loadPipeline(pipelineId);
    if (!before) throw new Error("Pipeline should exist");
    const failedBefore = before.stages.find((stage) => stage.stageId === "stage-1");
    const skippedBefore = before.stages.filter((stage) => stage.status === "skipped");

    const sweepStore = openSweepStore(async () => false);
    const settled = await sweepStore.reconcilePipelines();

    expect(settled).toEqual([pipelineId]);
    const after = sweepStore.loadPipeline(pipelineId);
    expect(after?.status).toBe("interrupted");
    expect(after?.stages.find((stage) => stage.stageId === "stage-0")).toEqual(
      before.stages.find((stage) => stage.stageId === "stage-0"),
    );
    expect(after?.stages.find((stage) => stage.stageId === "stage-1")).toEqual(failedBefore);
    expect(after?.stages.filter((stage) => stage.status === "skipped")).toEqual(skippedBefore);
    sweepStore.close();
  });

  test("inverting skipped-stability guard fails skipped-suffix reconciliation regression", () => {
    expect(reconciliationStableStageStatus("skipped")).toBe(true);
    expect(!reconciliationStableStageStatus("skipped")).toBe(false);
  });

  test("restart reconciliation leaves awaiting, approved, and rejected approval rows unchanged alongside succeeded and pending siblings", async () => {
    const pipelineId = seedPipeline(PRIOR_IDENTITY, ["succeeded", "awaiting", "pending", "approved", "rejected"]);
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

  test("claimPipelineContinuation restores a reconciled interrupted pipeline to active", async () => {
    const pipelineId = seedPipeline(PRIOR_IDENTITY, ["succeeded", "pending"]);
    const sweepStore = openSweepStore(async () => false);
    await sweepStore.reconcilePipelines();
    expect(sweepStore.loadPipeline(pipelineId)?.status).toBe("interrupted");

    const claim = sweepStore.claimPipelineContinuation({ pipelineId, priorOwnerIdentity: PRIOR_IDENTITY });
    expect(claim).toEqual({ kind: "applied", pipelineId });
    const after = sweepStore.loadPipeline(pipelineId);
    expect(after?.status).toBe("active");
    expect(after?.ownerIdentity).toBe(CURRENT_IDENTITY);
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

describe("failed pipeline reopen", () => {
  let store: StateStore;

  beforeEach(() => {
    removeOrchestrationStore(TEST_DB_PATH);
    store = openStateStore(TEST_DB_PATH);
  });

  afterEach(() => {
    store.close();
    removeOrchestrationStore(TEST_DB_PATH);
  });

  type StageSeed = {
    status: string;
    workflowInvocationId?: string | null;
    startedAt?: number | null;
    endedAt?: number | null;
    artifact?: unknown;
    failureDetail?: unknown;
  };

  function seedContinuationPipeline(stageSeeds: StageSeed[]): { pipelineId: string; stages: PipelineStageRecord[] } {
    const pipelineId = store.createPipeline({
      definition: {
        name: "reopen-pipeline",
        stages: stageSeeds.map((_, index) => ({ stageId: `stage-${index}`, kind: "approval" })),
      },
    });
    rawSeedStages(
      pipelineId,
      stageSeeds.map((seed, index) => ({ ...seed, stageId: `stage-${index}` })),
    );
    const pipeline = loadPipelineOrThrow(store, pipelineId);
    return { pipelineId, stages: pipeline.stages };
  }

  type BranchStageSeed = StageSeed & { stageId: string; branchKey?: string };

  /** Admit a fan-out pipeline: one authored `approval` stage per `stageId`, plus one branch row per admission. */
  function createFanOutPipeline(
    name: string,
    stageIds: string[],
    branchAdmissions: Array<{ stageId: string; branchKey: string }>,
  ): string {
    const pipelineId = store.createPipeline({
      definition: { name, stages: stageIds.map((stageId) => ({ stageId, kind: "approval" })) },
    });
    for (const admission of branchAdmissions) {
      store.createPipelineStageBranch({ pipelineId, stageId: admission.stageId, branchKey: admission.branchKey });
    }
    return pipelineId;
  }

  /** Raw-seed lifecycle fields on rows keyed by `(stageId, branchKey)`; `branchKey` omitted defaults to `"default"`. */
  function rawSeedStages(pipelineId: string, seeds: BranchStageSeed[]): void {
    const raw = new Database(TEST_DB_PATH);
    try {
      for (const seed of seeds) {
        raw
          .prepare(
            `UPDATE pipeline_stages
             SET status = ?, workflow_invocation_id = ?, started_at = ?, ended_at = ?, artifact = ?, failure_detail = ?
             WHERE pipeline_id = ? AND stage_id = ? AND branch_key = ?`,
          )
          .run(
            seed.status,
            seed.workflowInvocationId ?? null,
            seed.startedAt ?? null,
            seed.endedAt ?? null,
            seed.artifact === undefined ? null : JSON.stringify(seed.artifact),
            seed.failureDetail === undefined ? null : JSON.stringify(seed.failureDetail),
            pipelineId,
            seed.stageId,
            seed.branchKey ?? "default",
          );
      }
    } finally {
      raw.close();
    }
  }

  type RawPipelineStageRow = {
    id: string;
    pipeline_id: string;
    stage_id: string;
    branch_key: string;
    position: number;
    status: string;
    workflow_invocation_id: string | null;
    started_at: number | null;
    ended_at: number | null;
    artifact: string | null;
    failure_detail: string | null;
    decided_at: number | null;
  };

  /** Every raw `pipeline_stages` column for one pipeline, ordered by durable `id` for stable diffing. */
  function rawStageRows(pipelineId: string): RawPipelineStageRow[] {
    const raw = new Database(TEST_DB_PATH);
    try {
      return raw
        .prepare(
          `SELECT id, pipeline_id, stage_id, branch_key, position, status, workflow_invocation_id, started_at,
                  ended_at, artifact, failure_detail, decided_at
           FROM pipeline_stages WHERE pipeline_id = ? ORDER BY id`,
        )
        .all(pipelineId) as RawPipelineStageRow[];
    } finally {
      raw.close();
    }
  }

  test("reopens a valid failed-plus-skipped-suffix pipeline in place and returns the failed row durable id", () => {
    const { pipelineId, stages } = seedContinuationPipeline([
      {
        status: "succeeded",
        workflowInvocationId: "wf-0",
        startedAt: 10,
        endedAt: 20,
        artifact: { entryRunId: "run-0" },
      },
      {
        status: "failed",
        workflowInvocationId: "wf-1",
        startedAt: 30,
        endedAt: 40,
        artifact: { entryRunId: "run-1" },
        failureDetail: { code: "dispatch_refused", message: "boom" },
      },
      { status: "skipped", startedAt: 50, endedAt: 60, artifact: { note: "blocked" } },
      { status: "skipped", failureDetail: { message: "never ran" } },
    ]);
    const failed = stages.find((stage) => stage.status === "failed");
    if (!failed) throw new Error("failed stage should exist");
    const before = loadPipelineOrThrow(store, pipelineId);

    expect(store.reopenFailedPipeline({ pipelineId })).toEqual({
      kind: "applied",
      stageRecordId: failed.id,
    });

    const after = loadPipelineOrThrow(store, pipelineId);
    const reopenedFailed = after.stages.find((stage) => stage.id === failed.id);
    if (!reopenedFailed) throw new Error("failed row should exist");
    expect(reopenedFailed.stageId).toBe(failed.stageId);
    expect(reopenedFailed.status).toBe("pending");
    expect(reopenedFailed.workflowInvocationId).toBeNull();
    expect(reopenedFailed.startedAt).toBeNull();
    expect(reopenedFailed.endedAt).toBeNull();
    expect(reopenedFailed.artifact).toBeNull();
    expect(reopenedFailed.failureDetail).toBeNull();

    for (const stage of after.stages.filter((row) => row.status === "pending" && row.id !== failed.id)) {
      expect(stage.workflowInvocationId).toBeNull();
      expect(stage.startedAt).toBeNull();
      expect(stage.endedAt).toBeNull();
      expect(stage.artifact).toBeNull();
      expect(stage.failureDetail).toBeNull();
    }

    const succeeded = after.stages.find((stage) => stage.stageId === "stage-0");
    const succeededBefore = before.stages.find((stage) => stage.stageId === "stage-0");
    if (!succeeded || !succeededBefore) throw new Error("succeeded stage should exist");
    expect(succeeded).toEqual(succeededBefore);
  });

  test("reopenFailedPipeline clears decidedAt on the reopened row and its skipped suffix", () => {
    const pipelineId = store.createPipeline({
      definition: {
        name: "reopen-decided-gates",
        stages: [
          { stageId: "plan", kind: "workflow", workflow: "plan", review: "none" },
          { stageId: "gate", kind: "approval" },
          { stageId: "gate-two", kind: "approval" },
        ],
      },
    });
    store.updateStage({ pipelineId, stageId: "plan", patch: { status: "succeeded" } });
    const gate = loadPipelineOrThrow(store, pipelineId).stages.find((stage) => stage.stageId === "gate");
    const gateTwo = loadPipelineOrThrow(store, pipelineId).stages.find((stage) => stage.stageId === "gate-two");
    if (!gate || !gateTwo) throw new Error("gate stages should exist");
    store.commitApprovalBoundary({ stageRecordId: gate.id });
    store.commitApprovalDecision({ stageRecordId: gate.id, decision: "approved" });
    store.commitApprovalBoundary({ stageRecordId: gateTwo.id });
    store.commitApprovalDecision({ stageRecordId: gateTwo.id, decision: "approved" });

    const decidedStages = loadPipelineOrThrow(store, pipelineId).stages;
    expect(decidedStages.find((stage) => stage.id === gate.id)?.decidedAt).not.toBeNull();
    expect(decidedStages.find((stage) => stage.id === gateTwo.id)?.decidedAt).not.toBeNull();

    store.updateStage({ pipelineId, stageId: "gate", patch: { status: "failed" } });
    store.updateStage({ pipelineId, stageId: "gate-two", patch: { status: "skipped" } });

    // @mutate v2/src/persistence/state-store.ts "decided_at = NULL," -> "decided_at = decided_at,"
    expect(store.reopenFailedPipeline({ pipelineId })).toEqual({ kind: "applied", stageRecordId: gate.id });

    const after = loadPipelineOrThrow(store, pipelineId);
    const reopenedGate = after.stages.find((stage) => stage.id === gate.id);
    const reopenedGateTwo = after.stages.find((stage) => stage.id === gateTwo.id);
    if (!reopenedGate || !reopenedGateTwo) throw new Error("reopened rows should exist");
    expect(reopenedGate.status).toBe("pending");
    expect(reopenedGate.decidedAt).toBeNull();
    expect(reopenedGateTwo.status).toBe("pending");
    expect(reopenedGateTwo.decidedAt).toBeNull();

    const predecessorPipelineId = store.createPipeline({
      definition: {
        name: "reopen-decided-predecessor",
        stages: [
          { stageId: "gate", kind: "approval" },
          { stageId: "plan", kind: "workflow", workflow: "plan", review: "none" },
        ],
      },
    });
    const predecessorGate = loadPipelineOrThrow(store, predecessorPipelineId).stages.find(
      (stage) => stage.stageId === "gate",
    );
    if (!predecessorGate) throw new Error("predecessor gate should exist");
    store.commitApprovalBoundary({ stageRecordId: predecessorGate.id });
    store.commitApprovalDecision({ stageRecordId: predecessorGate.id, decision: "approved" });
    const predecessorDecidedAt = loadPipelineOrThrow(store, predecessorPipelineId).stages.find(
      (stage) => stage.id === predecessorGate.id,
    )?.decidedAt;
    store.updateStage({ pipelineId: predecessorPipelineId, stageId: "plan", patch: { status: "failed" } });
    const predecessorPlanId = loadPipelineOrThrow(store, predecessorPipelineId).stages.find(
      (stage) => stage.stageId === "plan",
    )?.id;
    if (!predecessorPlanId) throw new Error("predecessor plan stage should exist");

    expect(store.reopenFailedPipeline({ pipelineId: predecessorPipelineId })).toEqual({
      kind: "applied",
      stageRecordId: predecessorPlanId,
    });
    expect(
      loadPipelineOrThrow(store, predecessorPipelineId).stages.find((stage) => stage.id === predecessorGate.id)
        ?.decidedAt,
    ).toBe(predecessorDecidedAt);
  });

  test("closing and reopening the store, including after restart reconciliation, retains the continuation point before reopen", async () => {
    const PRIOR_IDENTITY = "11111:1000000";
    const CURRENT_IDENTITY = "22222:2000000";
    const seedStore = openStateStore(TEST_DB_PATH, { currentIdentity: PRIOR_IDENTITY });
    const pipelineId = seedStore.createPipeline({
      definition: {
        name: "reopen-after-reconcile",
        stages: [
          { stageId: "stage-0", kind: "approval" },
          { stageId: "stage-1", kind: "approval" },
          { stageId: "stage-2", kind: "approval" },
        ],
      },
    });
    const raw = new Database(TEST_DB_PATH);
    try {
      raw.prepare("UPDATE pipelines SET owner_identity = ? WHERE id = ?").run(PRIOR_IDENTITY, pipelineId);
      for (const [stageId, status] of [
        ["stage-0", "succeeded"],
        ["stage-1", "failed"],
        ["stage-2", "skipped"],
      ] as const) {
        raw
          .prepare("UPDATE pipeline_stages SET status = ? WHERE pipeline_id = ? AND stage_id = ?")
          .run(status, pipelineId, stageId);
      }
    } finally {
      raw.close();
    }
    const beforeReconcile = seedStore.loadPipeline(pipelineId);
    if (!beforeReconcile) throw new Error("Pipeline should exist");
    const failedId = beforeReconcile.stages.find((stage) => stage.stageId === "stage-1")?.id;
    if (!failedId) throw new Error("failed stage should exist");
    seedStore.close();

    const sweepStore = openStateStore(TEST_DB_PATH, {
      currentIdentity: CURRENT_IDENTITY,
      isOwnerAlive: async () => false,
    });
    await sweepStore.reconcilePipelines();
    const afterReconcile = sweepStore.loadPipeline(pipelineId);
    if (!afterReconcile) throw new Error("Pipeline should exist");
    expect(afterReconcile.status).toBe("interrupted");
    expect(afterReconcile.stages.find((stage) => stage.stageId === "stage-1")?.status).toBe("failed");
    expect(afterReconcile.stages.find((stage) => stage.stageId === "stage-2")?.status).toBe("skipped");
    sweepStore.close();

    store = openStateStore(TEST_DB_PATH);
    expect(store.reopenFailedPipeline({ pipelineId })).toEqual({
      kind: "applied",
      stageRecordId: failedId,
    });
    expect(loadPipelineOrThrow(store, pipelineId).stages.find((stage) => stage.id === failedId)?.status).toBe(
      "pending",
    );
  });

  test("refuses no-failure, multiple-failure, malformed-suffix, and unknown pipelines without mutation", () => {
    const noFailureId = seedContinuationPipeline([{ status: "succeeded" }, { status: "pending" }]).pipelineId;
    const noFailureBefore = loadPipelineOrThrow(store, noFailureId);
    expect(store.reopenFailedPipeline({ pipelineId: noFailureId })).toEqual({
      kind: "refused",
      pipelineId: noFailureId,
      reason: "no_failed_stage",
    });
    expect(store.loadPipeline(noFailureId)).toEqual(noFailureBefore);

    const multipleFailureId = seedContinuationPipeline([{ status: "failed" }, { status: "failed" }]).pipelineId;
    const multipleFailureBefore = loadPipelineOrThrow(store, multipleFailureId);
    expect(store.reopenFailedPipeline({ pipelineId: multipleFailureId })).toEqual({
      kind: "refused",
      pipelineId: multipleFailureId,
      reason: "multiple_failed_stages",
    });
    expect(store.loadPipeline(multipleFailureId)).toEqual(multipleFailureBefore);

    const malformedSuffixId = seedContinuationPipeline([
      { status: "succeeded" },
      { status: "failed" },
      { status: "pending" },
    ]).pipelineId;
    const malformedSuffixBefore = loadPipelineOrThrow(store, malformedSuffixId);
    expect(store.reopenFailedPipeline({ pipelineId: malformedSuffixId })).toEqual({
      kind: "refused",
      pipelineId: malformedSuffixId,
      reason: "malformed_continuation",
    });
    expect(store.loadPipeline(malformedSuffixId)).toEqual(malformedSuffixBefore);

    const malformedPredecessorId = seedContinuationPipeline([
      { status: "pending" },
      { status: "failed" },
      { status: "skipped" },
    ]).pipelineId;
    const malformedPredecessorBefore = loadPipelineOrThrow(store, malformedPredecessorId);
    expect(store.reopenFailedPipeline({ pipelineId: malformedPredecessorId })).toEqual({
      kind: "refused",
      pipelineId: malformedPredecessorId,
      reason: "malformed_continuation",
    });
    expect(store.loadPipeline(malformedPredecessorId)).toEqual(malformedPredecessorBefore);

    expect(store.reopenFailedPipeline({ pipelineId: "missing-pipeline" })).toEqual({
      kind: "refused",
      pipelineId: "missing-pipeline",
      reason: "pipeline_not_found",
    });
  });

  test("two store handles reopening one failed continuation admit exactly one result and refuse duplicates without mutation", () => {
    const { pipelineId } = seedContinuationPipeline([
      { status: "succeeded", workflowInvocationId: "wf-0", artifact: { entryRunId: "run-0" } },
      { status: "failed", workflowInvocationId: "wf-1", failureDetail: { message: "failed" } },
      { status: "skipped" },
    ]);
    const before = loadPipelineOrThrow(store, pipelineId);

    const storeA = openStateStore(TEST_DB_PATH);
    const storeB = openStateStore(TEST_DB_PATH);
    try {
      const first = storeA.reopenFailedPipeline({ pipelineId });
      const second = storeB.reopenFailedPipeline({ pipelineId });
      const outcomes = [first, second];
      expect(outcomes.filter((outcome) => outcome.kind === "applied")).toHaveLength(1);
      expect(outcomes.filter((outcome) => outcome.kind === "refused")).toHaveLength(1);
      const refused = outcomes.find((outcome) => outcome.kind === "refused");
      expect(refused).toMatchObject({ kind: "refused", pipelineId });
      if (!refused || refused.kind !== "refused") throw new Error("expected refused outcome");
      expect(["reopen_lost", "no_failed_stage"]).toContain(refused.reason);

      const afterFirst = loadPipelineOrThrow(store, pipelineId);
      expect(store.reopenFailedPipeline({ pipelineId })).toEqual({
        kind: "refused",
        pipelineId,
        reason: "no_failed_stage",
      });
      expect(store.loadPipeline(pipelineId)).toEqual(afterFirst);
      expect(afterFirst.stages.find((stage) => stage.stageId === "stage-0")).toEqual(
        before.stages.find((stage) => stage.stageId === "stage-0"),
      );
    } finally {
      storeA.close();
      storeB.close();
    }
  });

  test("inverting reopen shape guards fails targeted regressions", () => {
    const failedStage: PipelineStageRecord = {
      id: "failed-id",
      pipelineId: "pipeline-id",
      stageId: "stage-1",
      branchKey: "default",
      position: 1,
      status: "failed",
      workflowInvocationId: null,
      startedAt: null,
      endedAt: null,
      artifact: null,
      failureDetail: null,
      decidedAt: null,
    };
    const suffixStage: PipelineStageRecord = {
      id: "suffix-id",
      pipelineId: "pipeline-id",
      stageId: "stage-2",
      branchKey: "default",
      position: 2,
      status: "skipped",
      workflowInvocationId: null,
      startedAt: null,
      endedAt: null,
      artifact: null,
      failureDetail: null,
      decidedAt: null,
    };

    expect(reopenPredecessorAllowsStatus("succeeded")).toBe(true);
    expect(reopenPredecessorAllowsStatus("approved")).toBe(true);
    expect(reopenPredecessorAllowsStatus("pending")).toBe(false);
    expect(reopenSuffixAllowsStatus("skipped")).toBe(true);
    expect(reopenSuffixAllowsStatus("pending")).toBe(false);
    expect(analyzeFailedPipelineReopenShape([failedStage, suffixStage]).kind).toBe("valid");
    expect(analyzeFailedPipelineReopenShape([{ ...failedStage, status: "pending" }, suffixStage])).toEqual({
      kind: "invalid",
      reason: "no_failed_stage",
    });
    expect(
      analyzeFailedPipelineReopenShape([
        failedStage,
        { ...failedStage, id: "failed-2", stageId: "stage-3", position: 3 },
      ]),
    ).toEqual({
      kind: "invalid",
      reason: "multiple_failed_stages",
    });
    expect(analyzeFailedPipelineReopenShape([failedStage, { ...suffixStage, status: "pending" }])).toEqual({
      kind: "invalid",
      reason: "malformed_continuation",
    });
  });

  test("analyzeFailedPipelineReopenShape ignores reconciled default rows for a failed branch row", () => {
    const intentDefault: PipelineStageRecord = {
      id: "intent-default",
      pipelineId: "pipeline-id",
      stageId: "intent",
      branchKey: "default",
      position: 0,
      status: "succeeded",
      workflowInvocationId: null,
      startedAt: null,
      endedAt: null,
      artifact: null,
      failureDetail: null,
      decidedAt: null,
    };
    const planDefault: PipelineStageRecord = {
      id: "plan-default",
      pipelineId: "pipeline-id",
      stageId: "plan",
      branchKey: "default",
      position: 1,
      status: "skipped",
      workflowInvocationId: null,
      startedAt: null,
      endedAt: null,
      artifact: null,
      failureDetail: null,
      decidedAt: null,
    };
    const planAlphaFailed: PipelineStageRecord = {
      id: "plan-alpha",
      pipelineId: "pipeline-id",
      stageId: "plan",
      branchKey: "alpha",
      position: 1,
      status: "failed",
      workflowInvocationId: null,
      startedAt: null,
      endedAt: 1,
      artifact: null,
      failureDetail: { message: "failed" },
      decidedAt: null,
    };
    const planBetaSucceeded: PipelineStageRecord = {
      id: "plan-beta",
      pipelineId: "pipeline-id",
      stageId: "plan",
      branchKey: "beta",
      position: 1,
      status: "succeeded",
      workflowInvocationId: null,
      startedAt: null,
      endedAt: 1,
      artifact: null,
      failureDetail: null,
      decidedAt: null,
    };
    const implementAlphaSkipped: PipelineStageRecord = {
      id: "implement-alpha",
      pipelineId: "pipeline-id",
      stageId: "implement",
      branchKey: "alpha",
      position: 2,
      status: "skipped",
      workflowInvocationId: null,
      startedAt: null,
      endedAt: null,
      artifact: null,
      failureDetail: null,
      decidedAt: null,
    };

    expect(
      analyzeFailedPipelineReopenShape([
        intentDefault,
        planDefault,
        planAlphaFailed,
        planBetaSucceeded,
        implementAlphaSkipped,
      ]),
    ).toEqual({
      kind: "valid",
      failedStageRecordId: "plan-alpha",
      suffixStageRecordIds: ["implement-alpha"],
    });
  });

  test("reopens only the named failed fan-out branch while sibling rows stay unchanged", () => {
    const pipelineId = createFanOutPipeline(
      "reopen-branch-scoped",
      ["stage-0", "stage-1", "stage-2"],
      [
        { stageId: "stage-1", branchKey: "alpha" },
        { stageId: "stage-1", branchKey: "beta" },
        { stageId: "stage-1", branchKey: "gamma" },
        { stageId: "stage-1", branchKey: "delta" },
        { stageId: "stage-2", branchKey: "alpha" },
        { stageId: "stage-2", branchKey: "beta" },
      ],
    );
    rawSeedStages(pipelineId, [
      {
        stageId: "stage-0",
        status: "succeeded",
        workflowInvocationId: "wf-0",
        startedAt: 10,
        endedAt: 20,
        artifact: { entryRunId: "run-0" },
      },
      { stageId: "stage-1", status: "skipped", artifact: { note: "fan-out placeholder" } },
      {
        stageId: "stage-1",
        branchKey: "alpha",
        status: "failed",
        workflowInvocationId: "wf-1-alpha",
        startedAt: 30,
        endedAt: 40,
        artifact: { entryRunId: "run-1-alpha" },
        failureDetail: { code: "dispatch_refused", message: "boom" },
      },
      {
        stageId: "stage-1",
        branchKey: "beta",
        status: "succeeded",
        workflowInvocationId: "wf-1-beta",
        startedAt: 31,
        endedAt: 41,
        artifact: { entryRunId: "run-1-beta" },
      },
      {
        stageId: "stage-1",
        branchKey: "gamma",
        status: "failed",
        workflowInvocationId: "wf-1-gamma",
        startedAt: 32,
        endedAt: 42,
        artifact: { entryRunId: "run-1-gamma" },
        failureDetail: { message: "gamma failed" },
      },
      { stageId: "stage-1", branchKey: "delta", status: "awaiting" },
      { stageId: "stage-2", status: "skipped" },
      {
        stageId: "stage-2",
        branchKey: "alpha",
        status: "skipped",
        startedAt: 50,
        endedAt: 60,
        artifact: { note: "blocked-alpha" },
      },
      {
        stageId: "stage-2",
        branchKey: "beta",
        status: "succeeded",
        workflowInvocationId: "wf-2-beta",
        startedAt: 51,
        endedAt: 61,
        artifact: { entryRunId: "run-2-beta" },
      },
    ]);

    const before = rawStageRows(pipelineId);
    const failedRow = before.find((row) => row.stage_id === "stage-1" && row.branch_key === "alpha");
    const suffixRow = before.find((row) => row.stage_id === "stage-2" && row.branch_key === "alpha");
    if (!failedRow || !suffixRow) throw new Error("target rows should exist");

    // Keystone checkpoint: forcing whole-pipeline selection hits gamma's sibling failure too and refuses.
    // @mutate v2/src/persistence/state-store.ts "const branchKey = args.branchKey;" -> "const branchKey = undefined;"
    // Mutation checkpoint: disabling the named-scope dispatch falls back to whole-pipeline analysis.
    // @mutate v2/src/persistence/state-store.ts "if (branchKey !== undefined && branchKey !== DEFAULT_PIPELINE_STAGE_BRANCH_KEY) {" -> "if (false) {"
    // Mutation checkpoint: disabling the boundary membership skip aborts the search at stage-0 (no alpha row there).
    // @mutate v2/src/persistence/state-store.ts "if (defaultRows.length === 0 || namedRows.length === 0) continue;" -> "if (false) continue;"
    // Mutation checkpoint: dropping the scope from the in-transaction re-analysis re-widens it to whole-pipeline,
    // which hits gamma's sibling failure and refuses.
    // @mutate v2/src/persistence/state-store.ts "analyzeFailedPipelineReopenShape(freshStages, branchKey)" -> "analyzeFailedPipelineReopenShape(freshStages)"
    expect(store.reopenFailedPipeline({ pipelineId, branchKey: "alpha" })).toEqual({
      kind: "applied",
      stageRecordId: failedRow.id,
    });

    const after = rawStageRows(pipelineId);
    const afterById = new Map(after.map((row) => [row.id, row]));

    const reopenedFailed = afterById.get(failedRow.id);
    if (!reopenedFailed) throw new Error("failed row should exist");
    expect(reopenedFailed.status).toBe("pending");
    expect(reopenedFailed.workflow_invocation_id).toBeNull();
    expect(reopenedFailed.started_at).toBeNull();
    expect(reopenedFailed.ended_at).toBeNull();
    expect(reopenedFailed.artifact).toBeNull();
    expect(reopenedFailed.failure_detail).toBeNull();
    expect(reopenedFailed.decided_at).toBeNull();

    const reopenedSuffix = afterById.get(suffixRow.id);
    if (!reopenedSuffix) throw new Error("suffix row should exist");
    expect(reopenedSuffix.status).toBe("pending");
    expect(reopenedSuffix.workflow_invocation_id).toBeNull();
    expect(reopenedSuffix.started_at).toBeNull();
    expect(reopenedSuffix.ended_at).toBeNull();
    expect(reopenedSuffix.artifact).toBeNull();
    expect(reopenedSuffix.failure_detail).toBeNull();
    expect(reopenedSuffix.decided_at).toBeNull();

    const targetIds = new Set([failedRow.id, suffixRow.id]);
    for (const beforeRow of before) {
      if (targetIds.has(beforeRow.id)) continue;
      expect(afterById.get(beforeRow.id)).toEqual(beforeRow);
    }
    expect(after).toHaveLength(before.length);
  });

  test("branch-scoped reopen refuses absent, non-failed, and malformed continuations without mutation", () => {
    const pipelineId = createFanOutPipeline(
      "reopen-branch-refusals",
      ["stage-0", "stage-1", "stage-2"],
      [
        { stageId: "stage-1", branchKey: "alpha" },
        { stageId: "stage-2", branchKey: "alpha" },
        { stageId: "stage-1", branchKey: "beta" },
        { stageId: "stage-2", branchKey: "beta" },
        { stageId: "stage-1", branchKey: "delta" },
        { stageId: "stage-2", branchKey: "delta" },
        { stageId: "stage-2", branchKey: "epsilon" },
        { stageId: "stage-1", branchKey: "zeta" },
        { stageId: "stage-2", branchKey: "zeta" },
        { stageId: "stage-1", branchKey: "eta" },
      ],
    );
    rawSeedStages(pipelineId, [
      { stageId: "stage-0", status: "succeeded" },
      // alpha: a genuinely replayable sibling failure a malformed scope must never fall back to.
      { stageId: "stage-1", branchKey: "alpha", status: "failed" },
      { stageId: "stage-2", branchKey: "alpha", status: "skipped" },
      // beta: complete, non-failed continuation.
      { stageId: "stage-1", branchKey: "beta", status: "succeeded" },
      { stageId: "stage-2", branchKey: "beta", status: "succeeded" },
      // delta: two failures within its own continuation.
      { stageId: "stage-1", branchKey: "delta", status: "failed" },
      { stageId: "stage-2", branchKey: "delta", status: "failed" },
      // epsilon: diverges only at stage-2; its stage-1 default predecessor is left "pending" (invalid).
      { stageId: "stage-2", branchKey: "epsilon", status: "failed" },
      // zeta: failed row followed by a non-skipped suffix.
      { stageId: "stage-1", branchKey: "zeta", status: "failed" },
      { stageId: "stage-2", branchKey: "zeta", status: "pending" },
      // eta: diverges at stage-1 but never admitted at stage-2 (incomplete continuation).
      { stageId: "stage-1", branchKey: "eta", status: "failed" },
    ]);

    const before = rawStageRows(pipelineId);

    expect(store.reopenFailedPipeline({ pipelineId, branchKey: "gamma" }).kind).toBe("refused");
    expect(store.reopenFailedPipeline({ pipelineId, branchKey: "beta" }).kind).toBe("refused");
    expect(store.reopenFailedPipeline({ pipelineId, branchKey: "delta" })).toEqual({
      kind: "refused",
      pipelineId,
      reason: "multiple_failed_stages",
    });
    expect(store.reopenFailedPipeline({ pipelineId, branchKey: "epsilon" })).toEqual({
      kind: "refused",
      pipelineId,
      reason: "malformed_continuation",
    });
    expect(store.reopenFailedPipeline({ pipelineId, branchKey: "zeta" })).toEqual({
      kind: "refused",
      pipelineId,
      reason: "malformed_continuation",
    });
    expect(store.reopenFailedPipeline({ pipelineId, branchKey: "eta" })).toEqual({
      kind: "refused",
      pipelineId,
      reason: "malformed_continuation",
    });

    const after = rawStageRows(pipelineId);
    expect(after).toEqual(before);
    // alpha's replayable failure specifically must never have been touched by any of the above.
    expect(after.find((row) => row.stage_id === "stage-1" && row.branch_key === "alpha")?.status).toBe("failed");

    // Fixture-level guard coverage for shapes unreachable through the store's own admission API
    // (duplicated/misaligned rows never occur via createPipeline/createPipelineStageBranch).
    const base = {
      pipelineId: "fixture-pipeline",
      workflowInvocationId: null,
      startedAt: null,
      endedAt: null,
      artifact: null,
      failureDetail: null,
      decidedAt: null,
    };
    const prefix0: PipelineStageRecord = {
      ...base,
      id: "prefix-0",
      stageId: "stage-0",
      branchKey: "default",
      position: 0,
      status: "succeeded",
    };

    // Mutation checkpoint: allowing >1 rows on either side of the boundary lets the first duplicate silently win.
    // @mutate v2/src/persistence/state-store.ts "if (defaultRows.length > 1 || namedRows.length > 1) return null;" -> "if (false) return null;"
    const dupDefaultA: PipelineStageRecord = {
      ...base,
      id: "dup-default-a",
      stageId: "stage-1a",
      branchKey: "default",
      position: 1,
      status: "pending",
    };
    const dupDefaultB: PipelineStageRecord = {
      ...base,
      id: "dup-default-b",
      stageId: "stage-1b",
      branchKey: "default",
      position: 1,
      status: "pending",
    };
    const namedAtDup: PipelineStageRecord = {
      ...base,
      id: "named-dup",
      stageId: "stage-1a",
      branchKey: "target",
      position: 1,
      status: "failed",
    };
    expect(analyzeFailedPipelineReopenShape([prefix0, dupDefaultA, dupDefaultB, namedAtDup], "target")).toEqual({
      kind: "invalid",
      reason: "malformed_continuation",
    });

    // Mutation checkpoint: dropping the stageId comparison lets a misaligned pair pass as the boundary.
    // @mutate v2/src/persistence/state-store.ts "if (!defaultRow || !namedRow || defaultRow.stageId !== namedRow.stageId) return null;" -> "if (!defaultRow || !namedRow) return null;"
    const misalignedDefault: PipelineStageRecord = {
      ...base,
      id: "misaligned-default",
      stageId: "stage-1-default",
      branchKey: "default",
      position: 1,
      status: "pending",
    };
    const misalignedNamed: PipelineStageRecord = {
      ...base,
      id: "misaligned-named",
      stageId: "stage-1-other",
      branchKey: "target",
      position: 1,
      status: "failed",
    };
    expect(analyzeFailedPipelineReopenShape([prefix0, misalignedDefault, misalignedNamed], "target")).toEqual({
      kind: "invalid",
      reason: "malformed_continuation",
    });

    // Mutation checkpoint: skipping the null-boundary refusal lets an all-named row set (no `default` anywhere) pass.
    // @mutate v2/src/persistence/state-store.ts "if (boundaryPosition === null) return null;" -> "if (false) return null;"
    const onlyNamed0: PipelineStageRecord = {
      ...base,
      id: "only-named-0",
      stageId: "stage-0",
      branchKey: "target",
      position: 0,
      status: "succeeded",
    };
    const onlyNamed1: PipelineStageRecord = {
      ...base,
      id: "only-named-1",
      stageId: "stage-1",
      branchKey: "target",
      position: 1,
      status: "failed",
    };
    expect(analyzeFailedPipelineReopenShape([onlyNamed0, onlyNamed1], "target")).toEqual({
      kind: "invalid",
      reason: "malformed_continuation",
    });

    // Mutation checkpoint: allowing a duplicated prefix row through lets the first duplicate silently win.
    // @mutate v2/src/persistence/state-store.ts "if (defaultRows.length !== 1) return null;" -> "if (false) return null;"
    const prefixDup1a: PipelineStageRecord = {
      ...base,
      id: "prefix-dup-1a",
      stageId: "stage-1a",
      branchKey: "default",
      position: 1,
      status: "succeeded",
    };
    const prefixDup1b: PipelineStageRecord = {
      ...base,
      id: "prefix-dup-1b",
      stageId: "stage-1b",
      branchKey: "default",
      position: 1,
      status: "succeeded",
    };
    const boundaryDefault2: PipelineStageRecord = {
      ...base,
      id: "boundary-default-2",
      stageId: "stage-2",
      branchKey: "default",
      position: 2,
      status: "pending",
    };
    const namedAt2: PipelineStageRecord = {
      ...base,
      id: "named-2",
      stageId: "stage-2",
      branchKey: "target",
      position: 2,
      status: "failed",
    };
    expect(
      analyzeFailedPipelineReopenShape([prefix0, prefixDup1a, prefixDup1b, boundaryDefault2, namedAt2], "target"),
    ).toEqual({ kind: "invalid", reason: "malformed_continuation" });

    // Mutation checkpoint: allowing a duplicated continuation row through lets the first duplicate silently win.
    // @mutate v2/src/persistence/state-store.ts "if (namedRows.length !== 1) return null;" -> "if (false) return null;"
    const boundaryDefault1: PipelineStageRecord = {
      ...base,
      id: "boundary-default-1",
      stageId: "stage-1",
      branchKey: "default",
      position: 1,
      status: "pending",
    };
    const boundaryNamed1: PipelineStageRecord = {
      ...base,
      id: "boundary-named-1",
      stageId: "stage-1",
      branchKey: "target",
      position: 1,
      status: "failed",
    };
    const dupNamed2a: PipelineStageRecord = {
      ...base,
      id: "dup-named-2a",
      stageId: "stage-2",
      branchKey: "target",
      position: 2,
      status: "skipped",
    };
    const dupNamed2b: PipelineStageRecord = {
      ...base,
      id: "dup-named-2b",
      stageId: "stage-2",
      branchKey: "target",
      position: 2,
      status: "skipped",
    };
    expect(
      analyzeFailedPipelineReopenShape([prefix0, boundaryDefault1, boundaryNamed1, dupNamed2a, dupNamed2b], "target"),
    ).toEqual({ kind: "invalid", reason: "malformed_continuation" });
  });

  test("branchKey default aliases the unscoped reopen contract", () => {
    const seeds: StageSeed[] = [
      { status: "succeeded", workflowInvocationId: "wf-0", artifact: { entryRunId: "run-0" } },
      { status: "failed", workflowInvocationId: "wf-1", failureDetail: { message: "boom" } },
      { status: "skipped" },
    ];
    const omitted = seedContinuationPipeline(seeds);
    const explicitDefault = seedContinuationPipeline(seeds);

    const omittedResult = store.reopenFailedPipeline({ pipelineId: omitted.pipelineId });
    const explicitResult = store.reopenFailedPipeline({
      pipelineId: explicitDefault.pipelineId,
      branchKey: "default",
    });
    expect(omittedResult.kind).toBe("applied");
    expect(explicitResult.kind).toBe("applied");

    const normalize = (pipelineId: string) =>
      rawStageRows(pipelineId)
        .map(({ id: _id, pipeline_id: _pipelineId, ...rest }) => rest)
        .sort((a, b) => a.stage_id.localeCompare(b.stage_id));
    expect(normalize(omitted.pipelineId)).toEqual(normalize(explicitDefault.pipelineId));

    // A sibling branch failure invalidates whole-pipeline shape; the alias must refuse exactly
    // like omission rather than narrowing to one branch.
    const siblingFailurePipelineId = createFanOutPipeline(
      "reopen-alias-sibling-failure",
      ["stage-0", "stage-1"],
      [{ stageId: "stage-1", branchKey: "alpha" }],
    );
    rawSeedStages(siblingFailurePipelineId, [
      { stageId: "stage-0", status: "succeeded" },
      { stageId: "stage-1", status: "failed" },
      { stageId: "stage-1", branchKey: "alpha", status: "failed" },
    ]);

    expect(store.reopenFailedPipeline({ pipelineId: siblingFailurePipelineId })).toEqual({
      kind: "refused",
      pipelineId: siblingFailurePipelineId,
      reason: "multiple_failed_stages",
    });
    expect(store.reopenFailedPipeline({ pipelineId: siblingFailurePipelineId, branchKey: "default" })).toEqual({
      kind: "refused",
      pipelineId: siblingFailurePipelineId,
      reason: "multiple_failed_stages",
    });
  });

  test("branch-scoped reopen rolls back deterministic stale-suffix interference", () => {
    const pipelineId = createFanOutPipeline(
      "reopen-branch-stale-interference",
      ["stage-0", "stage-1", "stage-2"],
      [
        { stageId: "stage-1", branchKey: "alpha" },
        { stageId: "stage-2", branchKey: "alpha" },
      ],
    );
    rawSeedStages(pipelineId, [
      { stageId: "stage-0", status: "succeeded" },
      { stageId: "stage-1", branchKey: "alpha", status: "failed" },
      { stageId: "stage-2", branchKey: "alpha", status: "skipped" },
    ]);

    const before = rawStageRows(pipelineId);
    const failedRow = before.find((row) => row.stage_id === "stage-1" && row.branch_key === "alpha");
    const suffixRow = before.find((row) => row.stage_id === "stage-2" && row.branch_key === "alpha");
    if (!failedRow || !suffixRow) throw new Error("target rows should exist");

    // Test-local trigger: the moment the failed row's conditional write lands (status -> 'pending'),
    // stale-mutate the target suffix row out from under the in-flight transaction's second write.
    const triggerConn = new Database(TEST_DB_PATH);
    try {
      triggerConn.run(
        `CREATE TRIGGER reopen_stale_suffix_interference
         AFTER UPDATE OF status ON pipeline_stages
         WHEN NEW.id = '${failedRow.id}' AND NEW.status = 'pending'
         BEGIN
           UPDATE pipeline_stages SET status = 'pending' WHERE id = '${suffixRow.id}';
         END;`,
      );
    } finally {
      triggerConn.close();
    }

    // Mutation checkpoint: dropping the conditional-write status guard lets the failed-row write land
    // even though the trigger already moved the suffix row out from under it, masking the interference.
    // @mutate v2/src/persistence/state-store.ts "        WHERE id = ? AND status = ?" -> "        WHERE id = ?"
    expect(store.reopenFailedPipeline({ pipelineId, branchKey: "alpha" })).toEqual({
      kind: "refused",
      pipelineId,
      reason: "reopen_lost",
    });

    const after = rawStageRows(pipelineId);
    expect(after).toEqual(before);
  });

  test("competing branch-scoped reopen calls admit one transaction", () => {
    const pipelineId = createFanOutPipeline(
      "reopen-branch-race",
      ["stage-0", "stage-1", "stage-2"],
      [
        { stageId: "stage-1", branchKey: "alpha" },
        { stageId: "stage-2", branchKey: "alpha" },
        { stageId: "stage-1", branchKey: "beta" },
      ],
    );
    rawSeedStages(pipelineId, [
      { stageId: "stage-0", status: "succeeded" },
      { stageId: "stage-1", branchKey: "alpha", status: "failed" },
      { stageId: "stage-2", branchKey: "alpha", status: "skipped" },
      { stageId: "stage-1", branchKey: "beta", status: "succeeded" },
    ]);

    const before = rawStageRows(pipelineId);
    const failedRow = before.find((row) => row.stage_id === "stage-1" && row.branch_key === "alpha");
    if (!failedRow) throw new Error("failed row should exist");

    // These two calls run sequentially through bun:sqlite's synchronous, single-writer driver — this proves
    // the second handle observes the first's committed reopen and duplicate calls stay admitted-once, not
    // in-flight contention. Deterministic interference and rollback evidence live in the trigger-based
    // "branch-scoped reopen rolls back deterministic stale-suffix interference" test above.
    const storeA = openStateStore(TEST_DB_PATH);
    const storeB = openStateStore(TEST_DB_PATH);
    try {
      const first = storeA.reopenFailedPipeline({ pipelineId, branchKey: "alpha" });
      const second = storeB.reopenFailedPipeline({ pipelineId, branchKey: "alpha" });
      const outcomes = [first, second];
      expect(outcomes.filter((outcome) => outcome.kind === "applied")).toHaveLength(1);
      expect(outcomes.filter((outcome) => outcome.kind === "refused")).toHaveLength(1);
      const applied = outcomes.find((outcome) => outcome.kind === "applied");
      if (!applied || applied.kind !== "applied") throw new Error("expected applied outcome");
      expect(applied.stageRecordId).toBe(failedRow.id);
      const refused = outcomes.find((outcome) => outcome.kind === "refused");
      if (!refused || refused.kind !== "refused") throw new Error("expected refused outcome");
      expect(refused.pipelineId).toBe(pipelineId);
      expect(["reopen_lost", "no_failed_stage"]).toContain(refused.reason);

      const duplicate = store.reopenFailedPipeline({ pipelineId, branchKey: "alpha" });
      expect(duplicate.kind).toBe("refused");

      const after = rawStageRows(pipelineId);
      const afterById = new Map(after.map((row) => [row.id, row]));
      expect(afterById.get(failedRow.id)?.status).toBe("pending");
      const suffixBefore = before.find((row) => row.stage_id === "stage-2" && row.branch_key === "alpha");
      if (!suffixBefore) throw new Error("suffix row should exist");
      expect(afterById.get(suffixBefore.id)?.status).toBe("pending");

      for (const beforeRow of before) {
        if (beforeRow.id === failedRow.id || beforeRow.id === suffixBefore.id) continue;
        expect(afterById.get(beforeRow.id)).toEqual(beforeRow);
      }
    } finally {
      storeA.close();
      storeB.close();
    }
  });
});

describe("terminal publication commits", () => {
  let store: StateStore;

  const TERMINAL_PIPELINE_DEFINITION: PipelineDefinition = {
    name: "terminal-pipeline",
    terminalAction: "ready",
    stages: [{ stageId: "implement", kind: "workflow", workflow: "implement", review: "light" }],
  };

  const SAMPLE_FAILURE = {
    operation: "gh pr ready" as const,
    message: "flip failed",
    exitCode: 1,
  };

  beforeEach(() => {
    removeOrchestrationStore(TEST_DB_PATH);
    store = openStateStore(TEST_DB_PATH);
  });

  afterEach(() => {
    store.close();
    removeOrchestrationStore(TEST_DB_PATH);
  });

  function seedSettledPipeline(): string {
    const pipelineId = store.createPipeline({ definition: TERMINAL_PIPELINE_DEFINITION });
    store.updateStage({ pipelineId, stageId: "implement", patch: { status: "succeeded" } });
    return pipelineId;
  }

  test("commitTerminalPublicationSuccess stamps first write and is idempotent", () => {
    const pipelineId = seedSettledPipeline();
    const before = Date.now();

    store.commitTerminalPublicationSuccess({ pipelineId });
    const first = loadPipelineOrThrow(store, pipelineId);
    expect(first.terminalPublicationSucceededAt).toBeGreaterThanOrEqual(before);
    expect(first.terminalPublicationFailure).toBeNull();

    store.commitTerminalPublicationSuccess({ pipelineId });
    expect(loadPipelineOrThrow(store, pipelineId).terminalPublicationSucceededAt).toBe(
      first.terminalPublicationSucceededAt,
    );
  });

  test("commitTerminalPublicationFailure stamps first write and is idempotent", () => {
    const pipelineId = seedSettledPipeline();

    store.commitTerminalPublicationFailure({
      pipelineId,
      terminalAction: "ready",
      failure: SAMPLE_FAILURE,
      prNumber: 42,
      prUrl: "https://example.com/pr/42",
    });
    const first = loadPipelineOrThrow(store, pipelineId);
    expect(first.terminalPublicationFailure).toEqual({
      terminalAction: "ready",
      failure: SAMPLE_FAILURE,
      prNumber: 42,
      prUrl: "https://example.com/pr/42",
    });
    expect(first.terminalPublicationSucceededAt).toBeNull();

    store.commitTerminalPublicationFailure({
      pipelineId,
      terminalAction: "merge",
      failure: { operation: "gh pr merge", message: "should not apply" },
    });
    expect(loadPipelineOrThrow(store, pipelineId).terminalPublicationFailure).toEqual(first.terminalPublicationFailure);
  });

  test("success and failure markers are mutually exclusive", () => {
    const pipelineId = seedSettledPipeline();

    store.commitTerminalPublicationFailure({
      pipelineId,
      terminalAction: "ready",
      failure: SAMPLE_FAILURE,
    });
    store.commitTerminalPublicationSuccess({ pipelineId });
    const afterFailure = loadPipelineOrThrow(store, pipelineId);
    expect(afterFailure.terminalPublicationSucceededAt).toBeNull();
    expect(afterFailure.terminalPublicationFailure?.failure).toEqual(SAMPLE_FAILURE);

    const freshId = seedSettledPipeline();
    store.commitTerminalPublicationSuccess({ pipelineId: freshId });
    store.commitTerminalPublicationFailure({
      pipelineId: freshId,
      terminalAction: "ready",
      failure: SAMPLE_FAILURE,
    });
    const afterSuccess = loadPipelineOrThrow(store, freshId);
    expect(afterSuccess.terminalPublicationFailure).toBeNull();
    expect(afterSuccess.terminalPublicationSucceededAt).not.toBeNull();
  });

  test("pipeline_stage_admission claim, load, release, and duplicate claim refusal for the current holder", () => {
    const pipelineId = store.createPipeline({ definition: singlePlanStagePipeline("admission") });
    const stageId = "plan";
    expect(store.loadPipelineStageAdmission({ pipelineId, stageId })).toEqual({ kind: "absent" });
    expect(store.claimPipelineStageAdmission({ pipelineId, stageId })).toEqual({ kind: "applied" });
    expect(store.claimPipelineStageAdmission({ pipelineId, stageId })).toEqual({
      kind: "refused",
      reason: "claim_lost",
    });
    expect(store.loadPipelineStageAdmission({ pipelineId, stageId })).toEqual({
      kind: "present",
      holderIdentity: CURRENT_OWNER_IDENTITY,
    });
    expect(store.releasePipelineStageAdmission({ pipelineId, stageId })).toEqual({ kind: "applied" });
    expect(store.loadPipelineStageAdmission({ pipelineId, stageId })).toEqual({ kind: "absent" });
    expect(store.releasePipelineStageAdmission({ pipelineId, stageId })).toEqual({ kind: "applied" });
  });

  test("pipeline_stage_admission release refuses stale holders and branch keys stay distinct", () => {
    const pipelineId = store.createPipeline({ definition: singlePlanStagePipeline("admission-stale") });
    const stageId = "plan";
    const holderA = "owner-a:1";
    const holderB = "owner-b:2";
    const storeA = openStateStore(TEST_DB_PATH, { currentIdentity: holderA });
    const storeB = openStateStore(TEST_DB_PATH, { currentIdentity: holderB });
    try {
      expect(storeA.claimPipelineStageAdmission({ pipelineId, stageId })).toEqual({ kind: "applied" });
      expect(storeB.releasePipelineStageAdmission({ pipelineId, stageId })).toEqual({
        kind: "refused",
        reason: "stale_holder",
      });
      expect(storeA.loadPipelineStageAdmission({ pipelineId, stageId })).toEqual({
        kind: "present",
        holderIdentity: holderA,
      });

      const branchRecordId = store.createPipelineStageBranch({ pipelineId, stageId, branchKey: "branch-a" });
      expect(storeA.claimPipelineStageAdmission({ pipelineId, stageId, branchKey: "branch-a" })).toEqual({
        kind: "applied",
      });
      expect(store.loadPipelineStageAdmission({ pipelineId, stageId })).toEqual({
        kind: "present",
        holderIdentity: holderA,
      });
      expect(store.loadPipelineStageAdmission({ pipelineId, stageId, branchKey: "branch-a" })).toEqual({
        kind: "present",
        holderIdentity: holderA,
      });
      expect(branchRecordId).toBeTruthy();
    } finally {
      storeA.close();
      storeB.close();
    }
  });

  test("two store handles claiming one pipeline stage admit exactly once and refuse duplicates", () => {
    const pipelineId = store.createPipeline({ definition: singlePlanStagePipeline("admission-claim") });
    const stageId = "plan";
    const holderA = "owner-a:1";
    const holderB = "owner-b:2";
    const storeA = openStateStore(TEST_DB_PATH, { currentIdentity: holderA });
    const storeB = openStateStore(TEST_DB_PATH, { currentIdentity: holderB });
    try {
      const first = storeA.claimPipelineStageAdmission({ pipelineId, stageId });
      const second = storeB.claimPipelineStageAdmission({ pipelineId, stageId });
      const outcomes = [first, second];
      // Mutation checkpoint: removing the first-writer INSERT guard must turn this RED.
      expect(outcomes.filter((outcome) => outcome.kind === "applied")).toHaveLength(1);
      expect(outcomes.filter((outcome) => outcome.kind === "refused")).toHaveLength(1);
      const refused = outcomes.find((outcome) => outcome.kind === "refused");
      expect(refused).toEqual({ kind: "refused", reason: "claim_lost" });
      expect(store.loadPipelineStageAdmission({ pipelineId, stageId })).toEqual({
        kind: "present",
        holderIdentity: holderA,
      });
    } finally {
      storeA.close();
      storeB.close();
    }
  });

  test("two store handles with the same holder identity refuse duplicate stage admission claims", () => {
    const pipelineId = store.createPipeline({ definition: singlePlanStagePipeline("admission-same-holder") });
    const stageId = "plan";
    const holder = "owner-a:1";
    const storeA = openStateStore(TEST_DB_PATH, { currentIdentity: holder });
    const storeB = openStateStore(TEST_DB_PATH, { currentIdentity: holder });
    try {
      const first = storeA.claimPipelineStageAdmission({ pipelineId, stageId });
      const second = storeB.claimPipelineStageAdmission({ pipelineId, stageId });
      expect(first).toEqual({ kind: "applied" });
      expect(second).toEqual({ kind: "refused", reason: "claim_lost" });
      expect(store.loadPipelineStageAdmission({ pipelineId, stageId })).toEqual({
        kind: "present",
        holderIdentity: holder,
      });
    } finally {
      storeA.close();
      storeB.close();
    }
  });
});

describe("pipeline dismissal", () => {
  let store: StateStore;

  beforeEach(() => {
    removeOrchestrationStore(TEST_DB_PATH);
    store = openStateStore(TEST_DB_PATH);
  });

  afterEach(() => {
    store.close();
    removeOrchestrationStore(TEST_DB_PATH);
  });

  test("dismissPipeline persists dismissedAt across reopen", () => {
    // @mutate v2/src/persistence/state-store.ts ".run(dismissedAt, args.pipelineId)" -> ".run(null, args.pipelineId)"
    const pipelineId = store.createPipeline({ definition: singlePlanStagePipeline("dismiss-reopen") });
    const before = Date.now();

    expect(store.dismissPipeline({ pipelineId })).toEqual({ kind: "applied", pipelineId });
    expect(loadPipelineOrThrow(store, pipelineId).dismissedAt).toBeGreaterThanOrEqual(before);
    const listed = store.listPipelines().find((pipeline) => pipeline.id === pipelineId);
    expect(listed?.dismissedAt).toBeGreaterThanOrEqual(before);

    store.close();
    store = openStateStore(TEST_DB_PATH);
    expect(loadPipelineOrThrow(store, pipelineId).dismissedAt).toBeGreaterThanOrEqual(before);
  });

  test("undismissPipeline clears dismissedAt back to null", () => {
    const pipelineId = store.createPipeline({ definition: singlePlanStagePipeline("undismiss") });
    store.dismissPipeline({ pipelineId });

    // @mutate v2/src/persistence/state-store.ts "SET dismissed_at = NULL WHERE id = ?" -> "SET dismissed_at = dismissed_at WHERE id = ?"
    expect(store.undismissPipeline({ pipelineId })).toEqual({ kind: "applied", pipelineId });
    expect(loadPipelineOrThrow(store, pipelineId).dismissedAt).toBeNull();

    store.close();
    store = openStateStore(TEST_DB_PATH);
    expect(loadPipelineOrThrow(store, pipelineId).dismissedAt).toBeNull();
  });

  test("undismissPipeline on a never-dismissed pipeline is a no-op success", () => {
    const pipelineId = store.createPipeline({ definition: singlePlanStagePipeline("never-dismissed") });

    expect(store.undismissPipeline({ pipelineId })).toEqual({ kind: "applied", pipelineId });
    expect(loadPipelineOrThrow(store, pipelineId).dismissedAt).toBeNull();
  });

  test("dismiss and undismiss only affect the targeted pipeline row", () => {
    // @mutate v2/src/persistence/state-store.ts "UPDATE pipelines SET dismissed_at = ? WHERE id = ? AND dismissed_at IS NULL" -> "UPDATE pipelines SET dismissed_at = ? WHERE dismissed_at IS NULL"
    // @mutate v2/src/persistence/state-store.ts "UPDATE pipelines SET dismissed_at = NULL WHERE id = ?" -> "UPDATE pipelines SET dismissed_at = NULL"
    const pipelineA = store.createPipeline({ definition: singlePlanStagePipeline("dismiss-scope-a") });
    const pipelineB = store.createPipeline({ definition: singlePlanStagePipeline("dismiss-scope-b") });

    store.dismissPipeline({ pipelineId: pipelineA });
    expect(loadPipelineOrThrow(store, pipelineB).dismissedAt).toBeNull();

    store.dismissPipeline({ pipelineId: pipelineB });
    store.undismissPipeline({ pipelineId: pipelineA });
    expect(loadPipelineOrThrow(store, pipelineA).dismissedAt).toBeNull();
    expect(loadPipelineOrThrow(store, pipelineB).dismissedAt).not.toBeNull();
  });

  test("dismiss and undismiss leave stage records and pipeline lifecycle untouched", () => {
    const pipelineId = store.createPipeline({ definition: SAMPLE_PIPELINE_DEFINITION });
    store.updateStage({
      pipelineId,
      stageId: "plan",
      patch: { status: "succeeded", workflowInvocationId: "workflow-plan", startedAt: 100, endedAt: 200 },
    });
    const before = loadPipelineOrThrow(store, pipelineId);
    const gate = before.stages.find((stage) => stage.stageId === "gate");
    if (!gate) throw new Error("gate stage should exist");
    store.commitApprovalBoundary({ stageRecordId: gate.id });
    store.commitApprovalDecision({ stageRecordId: gate.id, decision: "approved" });

    const beforeDismiss = loadPipelineOrThrow(store, pipelineId);
    store.dismissPipeline({ pipelineId });
    store.undismissPipeline({ pipelineId });
    const after = loadPipelineOrThrow(store, pipelineId);

    expect(after.stages).toEqual(beforeDismiss.stages);
    expect(after.name).toBe(beforeDismiss.name);
    expect(after.createdAt).toBe(beforeDismiss.createdAt);
    expect(after.definition).toEqual(beforeDismiss.definition);
    expect(after.context).toEqual(beforeDismiss.context);
    expect(after.status).toBe(beforeDismiss.status);
    expect(after.ownerIdentity).toBe(beforeDismiss.ownerIdentity);
    expect(after.terminalPublicationFailure).toEqual(beforeDismiss.terminalPublicationFailure);
    expect(after.terminalPublicationSucceededAt).toBe(beforeDismiss.terminalPublicationSucceededAt);
  });

  test("dismissPipeline and undismissPipeline refuse an unknown pipeline id", () => {
    // @mutate v2/src/persistence/state-store.ts "this.db.prepare(\"SELECT 1 FROM pipelines WHERE id = ?\").get(pipelineId) !== null;" -> "true;"
    const pipelineId = store.createPipeline({ definition: singlePlanStagePipeline("unknown-refusal") });

    expect(store.dismissPipeline({ pipelineId: "no-such-pipeline" })).toEqual({
      kind: "refused",
      pipelineId: "no-such-pipeline",
      reason: "pipeline_not_found",
    });
    expect(store.undismissPipeline({ pipelineId: "no-such-pipeline" })).toEqual({
      kind: "refused",
      pipelineId: "no-such-pipeline",
      reason: "pipeline_not_found",
    });
    expect(loadPipelineOrThrow(store, pipelineId).dismissedAt).toBeNull();
  });

  test("re-dismissing a dismissed pipeline preserves the first dismissal timestamp", () => {
    // @mutate v2/src/persistence/state-store.ts "UPDATE pipelines SET dismissed_at = ? WHERE id = ? AND dismissed_at IS NULL" -> "UPDATE pipelines SET dismissed_at = ? WHERE id = ?"
    const pipelineId = store.createPipeline({ definition: singlePlanStagePipeline("dismiss-idempotent") });
    const raw = new Database(TEST_DB_PATH);
    try {
      raw.prepare("UPDATE pipelines SET dismissed_at = 1000 WHERE id = ?").run(pipelineId);
    } finally {
      raw.close();
    }

    expect(store.dismissPipeline({ pipelineId })).toEqual({ kind: "applied", pipelineId });
    expect(loadPipelineOrThrow(store, pipelineId).dismissedAt).toBe(1000);
  });
});

describe("run dismissal", () => {
  let store: StateStore;

  beforeEach(() => {
    removeOrchestrationStore(TEST_DB_PATH);
    store = openStateStore(TEST_DB_PATH);
  });

  afterEach(() => {
    store.close();
    removeOrchestrationStore(TEST_DB_PATH);
  });

  test("dismissRun persists dismissedAt across reopen", () => {
    // @mutate v2/src/persistence/state-store.ts ".run(dismissedAt, runId)" -> ".run(null, runId)"
    const runId = seedRun(store);
    const before = Date.now();

    expect(store.dismissRun(runId)).toEqual({ kind: "applied", runId });
    expect(loadRunOrThrow(store, runId).dismissedAt).toBeGreaterThanOrEqual(before);
    const listed = store.listRuns().find((run) => run.id === runId);
    expect(listed?.dismissedAt).toBeGreaterThanOrEqual(before);

    store.close();
    store = openStateStore(TEST_DB_PATH);
    expect(loadRunOrThrow(store, runId).dismissedAt).toBeGreaterThanOrEqual(before);
  });

  test("undismissRun clears dismissedAt back to null", () => {
    const runId = seedRun(store);
    store.dismissRun(runId);

    // @mutate v2/src/persistence/state-store.ts "UPDATE runs SET dismissed_at = NULL WHERE id = ?" -> "UPDATE runs SET dismissed_at = dismissed_at WHERE id = ?"
    expect(store.undismissRun(runId)).toEqual({ kind: "applied", runId });
    expect(loadRunOrThrow(store, runId).dismissedAt).toBeNull();

    store.close();
    store = openStateStore(TEST_DB_PATH);
    expect(loadRunOrThrow(store, runId).dismissedAt).toBeNull();
  });

  test("undismissRun on a never-dismissed run is a no-op success", () => {
    const runId = seedRun(store);

    expect(store.undismissRun(runId)).toEqual({ kind: "applied", runId });
    expect(loadRunOrThrow(store, runId).dismissedAt).toBeNull();
  });

  test("re-dismissing a dismissed run preserves the first dismissal timestamp", () => {
    // @mutate v2/src/persistence/state-store.ts "UPDATE runs SET dismissed_at = ? WHERE id = ? AND dismissed_at IS NULL" -> "UPDATE runs SET dismissed_at = ? WHERE id = ?"
    const runId = seedRun(store);
    const raw = new Database(TEST_DB_PATH);
    try {
      raw.prepare("UPDATE runs SET dismissed_at = 1000 WHERE id = ?").run(runId);
    } finally {
      raw.close();
    }

    expect(store.dismissRun(runId)).toEqual({ kind: "applied", runId });
    expect(loadRunOrThrow(store, runId).dismissedAt).toBe(1000);
  });

  test("dismiss and undismiss only affect the targeted run row", () => {
    // @mutate v2/src/persistence/state-store.ts "UPDATE runs SET dismissed_at = ? WHERE id = ? AND dismissed_at IS NULL" -> "UPDATE runs SET dismissed_at = ? WHERE (id = ? OR 1 = 1) AND dismissed_at IS NULL"
    // @mutate v2/src/persistence/state-store.ts "UPDATE runs SET dismissed_at = NULL WHERE id = ?" -> "UPDATE runs SET dismissed_at = NULL"
    const runA = seedRun(store, { branch: "dismiss-scope-a" });
    const runB = seedRun(store, { branch: "dismiss-scope-b" });

    store.dismissRun(runA);
    expect(loadRunOrThrow(store, runB).dismissedAt).toBeNull();

    store.dismissRun(runB);
    store.undismissRun(runA);
    expect(loadRunOrThrow(store, runA).dismissedAt).toBeNull();
    expect(loadRunOrThrow(store, runB).dismissedAt).not.toBeNull();
  });

  test("dismiss and undismiss leave run status attempts and workflow snapshot untouched", () => {
    const snapshot = { invocationId: "inv-dismiss", steps: [{ stepId: "step-1", role: "implement" }] };
    const runId = seedRun(store, { stepId: "step-1", workflowSnapshot: snapshot });
    const attemptId = store.recordAttemptStart(runId);
    store.commitCompletionBoundary({
      attemptId,
      runStatus: "completed",
      outcomeKind: "done",
      completionAgent: "claude",
    });
    store.setPrEvidence(runId, 42, "https://github.com/example/pr/42");

    const beforeDismiss = loadRunOrThrow(store, runId);
    store.dismissRun(runId);
    store.undismissRun(runId);
    const after = loadRunOrThrow(store, runId);

    expect(after.status).toBe(beforeDismiss.status);
    expect(after.attemptCount).toBe(beforeDismiss.attemptCount);
    expect(after.workflowSnapshot).toEqual(beforeDismiss.workflowSnapshot);
    expect(after.stepId).toBe(beforeDismiss.stepId);
    expect(after.finishedAt).toBe(beforeDismiss.finishedAt);
    expect(after.reconciledAt).toBe(beforeDismiss.reconciledAt);
    expect(after.prNumber).toBe(beforeDismiss.prNumber);
    expect(after.prUrl).toBe(beforeDismiss.prUrl);
    expect(after.worktreePath).toBe(beforeDismiss.worktreePath);
    expect(after.branch).toBe(beforeDismiss.branch);
    expect(after.attempts).toEqual(beforeDismiss.attempts);
  });

  test("dismissRun and undismissRun refuse an unknown run id", () => {
    // @mutate v2/src/persistence/state-store.ts "return this.db.prepare(\"SELECT 1 FROM runs WHERE id = ?\").get(runId) !== null;" -> "return true;"
    const runId = seedRun(store);

    expect(store.dismissRun("no-such-run")).toEqual({
      kind: "refused",
      runId: "no-such-run",
      reason: "run_not_found",
    });
    expect(store.undismissRun("no-such-run")).toEqual({
      kind: "refused",
      runId: "no-such-run",
      reason: "run_not_found",
    });
    expect(loadRunOrThrow(store, runId).dismissedAt).toBeNull();
  });
});
