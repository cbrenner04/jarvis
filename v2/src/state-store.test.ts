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
  type AttemptStatus,
  type OutcomeClass,
  type RunStatus,
  type StepKind,
} from "./state-store.ts";

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

  test("round-trips runs checkpoint and pointer fields", () => {
    const { tempDir, dbPath } = mkTempDbPath();
    const store = bootstrapStateStore({ dbPath });
    store.close();
    const db = new Database(dbPath, { strict: true });
    db.query(
      `INSERT INTO runs (
        run_id, project_key, workflow_id, target_ref, created_at, run_status, next_step_id, worktree_path, branch_name, spec_path, pr_ref
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`,
    ).run(
      "run_1",
      "project",
      "wf",
      "target",
      "2026-05-24T00:00:00Z",
      "running",
      "impl-step",
      "/tmp/wt",
      "feature/x",
      "v2/spec/foo.md",
      "refs/pull/1/head",
    );

    const run = db
      .query<
        {
          next_step_id: string | null;
          worktree_path: string | null;
          branch_name: string | null;
          spec_path: string | null;
          pr_ref: string | null;
        },
        [string]
      >(
        "SELECT next_step_id, worktree_path, branch_name, spec_path, pr_ref FROM runs WHERE run_id = ?1",
      )
      .get("run_1");
    expect(run).toEqual({
      next_step_id: "impl-step",
      worktree_path: "/tmp/wt",
      branch_name: "feature/x",
      spec_path: "v2/spec/foo.md",
      pr_ref: "refs/pull/1/head",
    });
    db.close(false);
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("enforces step attempt ordinal uniqueness per run and step plus one-to-one outcomes", () => {
    const { tempDir, dbPath } = mkTempDbPath();
    const store = bootstrapStateStore({ dbPath });
    store.close();
    const db = new Database(dbPath, { strict: true });

    db.query(
      "INSERT INTO runs (run_id, project_key, workflow_id, target_ref, created_at, run_status) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
    ).run("run_1", "project", "wf", "target", "2026-05-24T00:00:00Z", "running");

    db.query(
      `INSERT INTO step_attempts (
        attempt_id, run_id, step_id, attempt_ordinal, step_kind, attempt_status, started_at, ended_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
    ).run(
      "attempt_1",
      "run_1",
      "step_1",
      1,
      "implementation",
      "succeeded",
      "2026-05-24T00:00:01Z",
      "2026-05-24T00:00:02Z",
    );
    expect(() =>
      db.query(
        `INSERT INTO step_attempts (
          attempt_id, run_id, step_id, attempt_ordinal, step_kind, attempt_status, started_at, ended_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
      ).run(
        "attempt_2",
        "run_1",
        "step_1",
        1,
        "implementation",
        "succeeded",
        "2026-05-24T00:00:03Z",
        "2026-05-24T00:00:04Z",
      ),
    ).toThrow();

    db.query(
      `INSERT INTO step_outcomes (
        outcome_id, attempt_id, run_id, step_id, outcome_class, recorded_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
    ).run("outcome_1", "attempt_1", "run_1", "step_1", "done", "2026-05-24T00:00:05Z");
    expect(() =>
      db.query(
        `INSERT INTO step_outcomes (
          outcome_id, attempt_id, run_id, step_id, outcome_class, recorded_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
      ).run("outcome_2", "attempt_1", "run_1", "step_1", "progress", "2026-05-24T00:00:06Z"),
    ).toThrow();

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
