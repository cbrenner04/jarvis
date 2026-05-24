import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

export type BootstrapStateStoreOptions = {
  dbPath?: string;
};

export const RUN_STATUSES = [
  "running",
  "paused",
  "awaiting_human",
  "blocked",
  "completed",
  "killed",
  "failed",
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const STEP_KINDS = ["implementation", "review", "human"] as const;
export type StepKind = (typeof STEP_KINDS)[number];

export const ATTEMPT_STATUSES = ["succeeded", "blocked", "killed", "failed"] as const;
export type AttemptStatus = (typeof ATTEMPT_STATUSES)[number];

export const OUTCOME_CLASSES = ["progress", "done", "no_work", "blocked", "error"] as const;
export type OutcomeClass = (typeof OUTCOME_CLASSES)[number];

export type StateStore = {
  dbPath: string;
  close: () => void;
};

type Migration = {
  version: number;
  sql: string;
};

const DEFAULT_DB_PATH = join(process.env.HOME ?? "~", ".jarvis", "state", "v2.sqlite");
const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS state_store_bootstrap_marker (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `,
  },
  {
    version: 2,
    sql: `
      CREATE TABLE IF NOT EXISTS runs (
        run_id TEXT PRIMARY KEY,
        project_key TEXT NOT NULL,
        workflow_id TEXT NOT NULL,
        target_ref TEXT NOT NULL,
        created_at TEXT NOT NULL,
        run_status TEXT NOT NULL CHECK (
          run_status IN ('running', 'paused', 'awaiting_human', 'blocked', 'completed', 'killed', 'failed')
        ),
        started_at TEXT,
        ended_at TEXT,
        next_step_id TEXT,
        worktree_path TEXT,
        branch_name TEXT,
        spec_path TEXT,
        pr_ref TEXT,
        terminal_outcome_class TEXT CHECK (
          terminal_outcome_class IS NULL OR terminal_outcome_class IN ('success', 'blocked', 'killed', 'failed')
        ),
        terminal_reason TEXT
      );

      CREATE TABLE IF NOT EXISTS step_attempts (
        attempt_id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        step_id TEXT NOT NULL,
        attempt_ordinal INTEGER NOT NULL CHECK (attempt_ordinal >= 1),
        step_kind TEXT NOT NULL CHECK (step_kind IN ('implementation', 'review', 'human')),
        attempt_status TEXT NOT NULL CHECK (attempt_status IN ('succeeded', 'blocked', 'killed', 'failed')),
        started_at TEXT NOT NULL,
        ended_at TEXT NOT NULL,
        FOREIGN KEY (run_id) REFERENCES runs(run_id),
        UNIQUE (run_id, step_id, attempt_ordinal)
      );

      CREATE TABLE IF NOT EXISTS step_outcomes (
        outcome_id TEXT PRIMARY KEY,
        attempt_id TEXT NOT NULL UNIQUE,
        run_id TEXT NOT NULL,
        step_id TEXT NOT NULL,
        outcome_class TEXT NOT NULL CHECK (outcome_class IN ('progress', 'done', 'no_work', 'blocked', 'error')),
        blocker_reason TEXT,
        repeat_from_step_id TEXT,
        repeat_to_step_id TEXT,
        recorded_at TEXT NOT NULL,
        FOREIGN KEY (attempt_id) REFERENCES step_attempts(attempt_id),
        FOREIGN KEY (run_id) REFERENCES runs(run_id)
      );
    `,
  },
];

export function bootstrapStateStore(options?: BootstrapStateStoreOptions): StateStore {
  const dbPath = options?.dbPath ?? DEFAULT_DB_PATH;
  const dir = dirname(dbPath);
  mkdirSync(dir, { recursive: true });

  const db = new Database(dbPath, { create: true, strict: true });

  db.exec(`
    CREATE TABLE IF NOT EXISTS state_store_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const appliedVersions = new Set<number>(
    db
      .query<{ version: number }, []>(
        "SELECT version FROM state_store_migrations ORDER BY version ASC",
      )
      .all()
      .map((row) => row.version),
  );

  for (const migration of MIGRATIONS) {
    if (appliedVersions.has(migration.version)) {
      continue;
    }

    db.transaction(() => {
      db.exec(migration.sql);
      db.query("INSERT INTO state_store_migrations (version) VALUES (?1)").run(migration.version);
    })();
  }

  return {
    dbPath,
    close: () => db.close(false),
  };
}
