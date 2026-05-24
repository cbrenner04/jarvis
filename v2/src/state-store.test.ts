import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import {
  ATTEMPT_STATUSES,
  OUTCOME_CLASSES,
  RUN_STATUSES,
  STEP_KINDS,
  bootstrapStateStore,
  commitStepBoundary,
  createRun,
  listStepHistory,
  loadRunForResume,
  recordStepStart,
  type AttemptStatus,
  type OutcomeClass,
  type RunStatus,
  type StepKind,
} from "./state-store.ts";
import * as publicApi from "./index.ts";

function mkTempDbPath(): { tempDir: string; dbPath: string } {
  const tempDir = mkdtempSync(join(tmpdir(), "jarvis-v2-state-store-"));
  return { tempDir, dbPath: join(tempDir, "state.sqlite") };
}

describe("bootstrapStateStore", () => {
  test("uses explicit dbPath and applies migrations idempotently", () => {
    const { tempDir, dbPath } = mkTempDbPath();

    const first = bootstrapStateStore({ dbPath });
    first.close();

    const dbAfterFirst = new Database(dbPath, { readonly: true, strict: true });
    const firstRows = dbAfterFirst
      .query<{ version: number; applied_at: string }, []>(
        "SELECT version, applied_at FROM state_store_migrations ORDER BY version ASC",
      )
      .all();
    dbAfterFirst.close(false);

    const second = bootstrapStateStore({ dbPath });
    second.close();

    const dbAfterSecond = new Database(dbPath, { readonly: true, strict: true });
    const secondRows = dbAfterSecond
      .query<{ version: number; applied_at: string }, []>(
        "SELECT version, applied_at FROM state_store_migrations ORDER BY version ASC",
      )
      .all();
    dbAfterSecond.close(false);

    expect(firstRows.length).toBeGreaterThan(0);
    expect(secondRows).toEqual(firstRows);

    rmSync(tempDir, { recursive: true, force: true });
  });

  test("creates runs, step_attempts, and step_outcomes with phase-1 columns", () => {
    const { tempDir, dbPath } = mkTempDbPath();
    const store = bootstrapStateStore({ dbPath });
    store.close();

    const db = new Database(dbPath, { readonly: true, strict: true });
    const tables = db
      .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => row.name);
    expect(tables).toContain("runs");
    expect(tables).toContain("step_attempts");
    expect(tables).toContain("step_outcomes");

    const runsColumns = db
      .query<{ name: string }, []>("SELECT name FROM pragma_table_info('runs')")
      .all()
      .map((row) => row.name);
    expect(runsColumns).toEqual([
      "run_id",
      "project_key",
      "workflow_id",
      "target_ref",
      "created_at",
      "run_status",
      "started_at",
      "ended_at",
      "next_step_id",
      "worktree_path",
      "branch_name",
      "spec_path",
      "pr_ref",
      "terminal_outcome_class",
      "terminal_reason",
    ]);
    db.close(false);
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("omits deferred fields from phase-1 tables", () => {
    const { tempDir, dbPath } = mkTempDbPath();
    const store = bootstrapStateStore({ dbPath });
    store.close();
    const db = new Database(dbPath, { readonly: true, strict: true });
    const allColumns = ["runs", "step_attempts", "step_outcomes"]
      .flatMap((table) =>
        db
          .query<{ name: string }, []>(`SELECT name FROM pragma_table_info('${table}')`)
          .all()
          .map((row) => row.name),
      )
      .join("|");
    for (const deferred of [
      "transcript",
      "token",
      "cost",
      "event",
      "session",
      "quota",
      "daemon",
    ]) {
      expect(allColumns.includes(deferred)).toBeFalse();
    }
    db.close(false);
    rmSync(tempDir, { recursive: true, force: true });
  });
});

describe("state-store repository operations", () => {
  test("public barrel exports only bootstrap + repository ops (no raw query surface)", () => {
    expect(Object.keys(publicApi).sort()).toEqual([
      "bootstrapStateStore",
      "commitStepBoundary",
      "createRun",
      "listStepHistory",
      "loadRunForResume",
      "recordStepStart",
    ]);
  });

  test("createRun + commitStepBoundary round-trip through loadRunForResume and listStepHistory", () => {
    const { tempDir, dbPath } = mkTempDbPath();
    const store = bootstrapStateStore({ dbPath });

    const run = createRun(store, {
      runId: "run_1",
      projectId: "jarvis",
      workflowName: "v2",
      specPath: "v2/spec/index.md",
      worktreePath: "/tmp/wt",
      branch: "feature/v2",
      initialStepId: "step_1",
    });
    expect(run.runId).toBe("run_1");
    expect(run.nextStepId).toBe("step_1");

    const firstAttempt = recordStepStart(store, {
      runId: "run_1",
      stepId: "step_1",
      startedAt: "2026-05-24T00:00:01Z",
    });

    const commit = commitStepBoundary(store, {
      runId: "run_1",
      attemptId: firstAttempt.attemptId,
      stepId: "step_1",
      terminalStatus: "succeeded",
      outcomeClass: "progress",
      nextStepId: "step_2",
      finishedAt: "2026-05-24T00:00:02Z",
    });

    expect(commit.attemptId).toBe(firstAttempt.attemptId);
    expect(commit.nextStepId).toBe("step_2");

    const resume = loadRunForResume(store, { runId: "run_1" });
    expect(resume.run).toEqual({
      runId: "run_1",
      projectId: "jarvis",
      workflowName: "v2",
      specPath: "v2/spec/index.md",
      worktreePath: "/tmp/wt",
      branch: "feature/v2",
      createdAt: run.createdAt,
      nextStepId: "step_2",
      runStatus: "running",
    });
    expect(resume.latestAttemptsByStep.step_1?.attemptId).toBe(firstAttempt.attemptId);
    expect(resume.latestOutcomeByAttempt[firstAttempt.attemptId]?.outcomeClass).toBe("progress");

    const history = listStepHistory(store, { runId: "run_1", stepId: "step_1" });
    expect(history.attempts).toHaveLength(1);
    expect(history.attempts[0]?.attemptOrdinal).toBe(1);
    expect(history.attempts[0]?.outcome?.outcomeClass).toBe("progress");

    store.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("recordStepStart produces monotonic per-step attempt ordinals", () => {
    const { tempDir, dbPath } = mkTempDbPath();
    const store = bootstrapStateStore({ dbPath });

    createRun(store, {
      runId: "run_1",
      projectId: "jarvis",
      workflowName: "v2",
      specPath: "v2/spec/index.md",
      worktreePath: "/tmp/wt",
      branch: "feature/v2",
      initialStepId: "step_1",
    });

    const a1 = recordStepStart(store, {
      runId: "run_1",
      stepId: "step_1",
      startedAt: "2026-05-24T00:00:01Z",
    });
    const a2 = recordStepStart(store, {
      runId: "run_1",
      stepId: "step_1",
      startedAt: "2026-05-24T00:00:02Z",
    });
    const a3 = recordStepStart(store, {
      runId: "run_1",
      stepId: "step_1",
      startedAt: "2026-05-24T00:00:03Z",
    });

    expect([a1.attemptOrdinal, a2.attemptOrdinal, a3.attemptOrdinal]).toEqual([1, 2, 3]);

    store.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("commitStepBoundary rolls back attempt finish + outcome + checkpoint on transactional failure", () => {
    const { tempDir, dbPath } = mkTempDbPath();
    const store = bootstrapStateStore({ dbPath });

    createRun(store, {
      runId: "run_1",
      projectId: "jarvis",
      workflowName: "v2",
      specPath: "v2/spec/index.md",
      worktreePath: "/tmp/wt",
      branch: "feature/v2",
      initialStepId: "step_1",
    });
    const attempt = recordStepStart(store, {
      runId: "run_1",
      stepId: "step_1",
      startedAt: "2026-05-24T00:00:01Z",
    });

    expect(() =>
      commitStepBoundary(store, {
        runId: "run_1",
        attemptId: attempt.attemptId,
        stepId: "step_1",
        terminalStatus: "failed",
        outcomeClass: "error",
        nextStepId: "step_2",
        finishedAt: "2026-05-24T00:00:02Z",
        forceFailAfterAttemptFinish: true,
      }),
    ).toThrow("forced failure");

    const db = new Database(dbPath, { readonly: true, strict: true });
    const attemptRow = db
      .query<{ attempt_status: string; ended_at: string }, [string]>(
        "SELECT attempt_status, ended_at FROM step_attempts WHERE attempt_id = ?1",
      )
      .get(attempt.attemptId);
    const outcomeCount = db
      .query<{ count: number }, [string]>(
        "SELECT COUNT(*) AS count FROM step_outcomes WHERE attempt_id = ?1",
      )
      .get(attempt.attemptId);
    const runRow = db
      .query<{ next_step_id: string | null }, [string]>(
        "SELECT next_step_id FROM runs WHERE run_id = ?1",
      )
      .get("run_1");

    expect(attemptRow).toEqual({ attempt_status: "succeeded", ended_at: "2026-05-24T00:00:01Z" });
    expect(outcomeCount?.count).toBe(0);
    expect(runRow?.next_step_id).toBe("step_1");

    db.close(false);
    store.close();
    rmSync(tempDir, { recursive: true, force: true });
  });
});

const _runStatusOk: RunStatus = RUN_STATUSES[0];
const _stepKindOk: StepKind = STEP_KINDS[0];
const _attemptStatusOk: AttemptStatus = ATTEMPT_STATUSES[0];
const _outcomeClassOk: OutcomeClass = OUTCOME_CLASSES[0];
// @ts-expect-error invalid run status must fail typecheck
const _runStatusBad: RunStatus = "in_progress";
// @ts-expect-error invalid step kind must fail typecheck
const _stepKindBad: StepKind = "plan";
// @ts-expect-error invalid attempt status must fail typecheck
const _attemptStatusBad: AttemptStatus = "running";
// @ts-expect-error invalid outcome class must fail typecheck
const _outcomeClassBad: OutcomeClass = "success";
