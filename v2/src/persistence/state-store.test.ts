import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isOwnerAlive, openStateStore, type StateStore } from "./state-store";

const TEST_DB_PATH = join(tmpdir(), "jarvis-test-state.sqlite");

function removeDbFiles(dbPath: string): void {
  rmSync(dbPath, { force: true });
  rmSync(`${dbPath}-wal`, { force: true });
  rmSync(`${dbPath}-shm`, { force: true });
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

describe("StateStore", () => {
  let store: StateStore;

  beforeEach(() => {
    removeDbFiles(TEST_DB_PATH);
    store = openStateStore(TEST_DB_PATH);
  });

  afterEach(() => {
    store.close();
    removeDbFiles(TEST_DB_PATH);
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
    rmSync(legacyDbPath, { force: true });
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
      rmSync(legacyDbPath, { force: true });
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
    removeDbFiles(TEST_DB_PATH);
    store = openStateStore(TEST_DB_PATH);
  });

  afterEach(() => {
    store.close();
    removeDbFiles(TEST_DB_PATH);
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
