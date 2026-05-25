import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import {
  getDefaultPhase1StateStorePath,
  openPhase1StateStore,
} from "./state-store.ts";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeTempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-v2-store-"));
  tempDirs.push(dir);
  return join(dir, "nested", "state", "v2.sqlite");
}

describe("phase1 state store bootstrap", () => {
  test("opens with default path contract helper", () => {
    expect(getDefaultPhase1StateStorePath()).toContain(".jarvis/state/v2.sqlite");
  });

  test("fresh bootstrap creates parent directories and schema", () => {
    const dbPath = makeTempDbPath();

    const store = openPhase1StateStore({ path: dbPath });
    store.close();

    expect(existsSync(dbPath)).toBe(true);

    const db = new Database(dbPath, { strict: true });
    try {
      db.exec("PRAGMA foreign_keys = ON;");

      const tables = db
        .query<{ name: string }, []>(
          "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
        )
        .all()
        .map((row) => row.name);

      expect(tables).toEqual([
        "runs",
        "schema_migrations",
        "step_attempts",
        "step_outcomes",
      ]);

      const triggerNames = db
        .query<{ name: string }, []>(
          "SELECT name FROM sqlite_master WHERE type = 'trigger' ORDER BY name",
        )
        .all()
        .map((row) => row.name);
      expect(triggerNames).toEqual([
        "step_attempts_ordinal_monotonic",
        "step_outcomes_requires_completed_attempt",
      ]);
    } finally {
      db.close();
    }
  });

  test("reopen on current schema is no-op for durable data", () => {
    const dbPath = makeTempDbPath();

    const first = openPhase1StateStore({ path: dbPath });
    first.close();

    const db = new Database(dbPath, { strict: true });
    db.exec("PRAGMA foreign_keys = ON;");
    try {
      db.exec(`
        INSERT INTO runs(run_id, workflow_name, status, next_step_id, created_at, updated_at)
        VALUES('run-1', 'wf', 'running', 'step-2', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')
      `);
      db.exec(`
        INSERT INTO step_attempts(attempt_id, run_id, step_id, attempt_ordinal, status, started_at, finished_at)
        VALUES('attempt-1', 'run-1', 'step-1', 1, 'done', '2026-01-01T00:00:00.000Z', '2026-01-01T00:01:00.000Z')
      `);
      db.exec(`
        INSERT INTO step_outcomes(outcome_id, attempt_id, outcome_kind, created_at)
        VALUES('outcome-1', 'attempt-1', 'done', '2026-01-01T00:01:00.000Z')
      `);

      expect(
        db
          .query<{ count: number }, []>(
            "SELECT COUNT(*) AS count FROM schema_migrations",
          )
          .get()?.count,
      ).toBe(1);
    } finally {
      db.close();
    }

    const bytesBefore = readFileSync(dbPath);

    const reopened = openPhase1StateStore({ path: dbPath });
    reopened.close();

    const verify = new Database(dbPath, { strict: true });
    verify.exec("PRAGMA foreign_keys = ON;");
    try {
      expect(
        verify
          .query<{ count: number }, []>("SELECT COUNT(*) AS count FROM runs")
          .get()?.count,
      ).toBe(1);
      expect(
        verify
          .query<{ count: number }, []>(
            "SELECT COUNT(*) AS count FROM step_attempts",
          )
          .get()?.count,
      ).toBe(1);
      expect(
        verify
          .query<{ count: number }, []>(
            "SELECT COUNT(*) AS count FROM step_outcomes",
          )
          .get()?.count,
      ).toBe(1);
      expect(
        verify
          .query<{ count: number }, []>(
            "SELECT COUNT(*) AS count FROM schema_migrations",
          )
          .get()?.count,
      ).toBe(1);
    } finally {
      verify.close();
    }

    const bytesAfter = readFileSync(dbPath);
    expect(bytesAfter.equals(bytesBefore)).toBe(true);
  });
});
