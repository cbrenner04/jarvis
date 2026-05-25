import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Database } from "bun:sqlite";

const DEFAULT_STATE_STORE_PATH = join(homedir(), ".jarvis", "state", "v2.sqlite");

const MIGRATIONS: ReadonlyArray<{ version: number; sql: readonly string[] }> = [
  {
    version: 1,
    sql: [
      `
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      )
      `,
      `
      CREATE TABLE IF NOT EXISTS runs (
        run_id TEXT PRIMARY KEY,
        workflow_name TEXT NOT NULL,
        status TEXT NOT NULL,
        next_step_id TEXT,
        spec_path TEXT,
        worktree_path TEXT,
        branch_name TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
      `,
      `
      CREATE TABLE IF NOT EXISTS step_attempts (
        attempt_id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        step_id TEXT NOT NULL,
        attempt_ordinal INTEGER NOT NULL CHECK (attempt_ordinal > 0),
        status TEXT NOT NULL,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        FOREIGN KEY(run_id) REFERENCES runs(run_id) ON DELETE CASCADE,
        UNIQUE(run_id, step_id, attempt_ordinal)
      )
      `,
      `
      CREATE TRIGGER IF NOT EXISTS step_attempts_ordinal_monotonic
      BEFORE INSERT ON step_attempts
      FOR EACH ROW
      WHEN NEW.attempt_ordinal != (
        COALESCE(
          (
            SELECT MAX(existing.attempt_ordinal)
            FROM step_attempts AS existing
            WHERE existing.run_id = NEW.run_id
              AND existing.step_id = NEW.step_id
          ),
          0
        ) + 1
      )
      BEGIN
        SELECT RAISE(ABORT, 'attempt_ordinal must be contiguous per run_id + step_id');
      END
      `,
      `
      CREATE TABLE IF NOT EXISTS step_outcomes (
        outcome_id TEXT PRIMARY KEY,
        attempt_id TEXT NOT NULL UNIQUE,
        outcome_kind TEXT NOT NULL,
        detail TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY(attempt_id) REFERENCES step_attempts(attempt_id) ON DELETE CASCADE
      )
      `,
      `
      CREATE TRIGGER IF NOT EXISTS step_outcomes_requires_completed_attempt
      BEFORE INSERT ON step_outcomes
      FOR EACH ROW
      WHEN NOT EXISTS (
        SELECT 1
        FROM step_attempts AS attempt
        WHERE attempt.attempt_id = NEW.attempt_id
          AND attempt.finished_at IS NOT NULL
      )
      BEGIN
        SELECT RAISE(ABORT, 'outcome requires a completed attempt');
      END
      `,
    ],
  },
];

/** Options for opening the Phase 1 state store database. */
export type OpenPhase1StateStoreOptions = {
  /**
   * Optional absolute or relative sqlite path. Omit to use the default
   * `~/.jarvis/state/v2.sqlite` location.
   */
  path?: string;
};

/**
 * Minimal handle for the Phase 1 store connection.
 *
 * The database is fully bootstrapped (directories + migrations) before this
 * handle is returned.
 */
export type Phase1StateStore = {
  readonly path: string;
  close: () => void;
};

/** Returns the default Phase 1 SQLite state-store path. */
export function getDefaultPhase1StateStorePath(): string {
  return DEFAULT_STATE_STORE_PATH;
}

/**
 * Opens the Phase 1 SQLite state store and applies idempotent migrations.
 *
 * This function owns bootstrap so callers never need to create directories or
 * run setup SQL before using the store.
 */
export function openPhase1StateStore(
  options: OpenPhase1StateStoreOptions = {},
): Phase1StateStore {
  const dbPath = resolve(options.path ?? DEFAULT_STATE_STORE_PATH);
  mkdirSync(dirname(dbPath), { recursive: true });

  const db = new Database(dbPath, { create: true, strict: true });
  db.exec("PRAGMA foreign_keys = ON;");
  applyMigrations(db);

  return {
    path: dbPath,
    close: () => db.close(),
  };
}

function applyMigrations(db: Database): void {
  db.exec("BEGIN;");
  try {
    db.exec(
      "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)",
    );

    const getApplied = db.query("SELECT 1 FROM schema_migrations WHERE version = ?1");
    const markApplied = db.query(
      "INSERT INTO schema_migrations(version, applied_at) VALUES(?1, ?2)",
    );

    for (const migration of MIGRATIONS) {
      const alreadyApplied = getApplied.get(migration.version);
      if (alreadyApplied) {
        continue;
      }

      for (const sql of migration.sql) {
        db.exec(sql);
      }

      markApplied.run(migration.version, new Date().toISOString());
    }

    db.exec("COMMIT;");
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }
}
