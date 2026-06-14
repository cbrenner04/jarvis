import type { Database } from "bun:sqlite";

/** A single schema migration. Append-only: never edit or reorder applied entries. */
export type Migration = { id: string; up: string };

/** Ordered schema migrations. Add new ones at the end. */
export const MIGRATIONS: Migration[] = [
  {
    id: "001-bootstrap-runs-attempts",
    up: `
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        project TEXT NOT NULL,
        spec_ref TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        status TEXT NOT NULL,
        attempt_count INTEGER NOT NULL DEFAULT 0,
        worktree_path TEXT NOT NULL,
        branch TEXT NOT NULL,
        spec_path TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS attempts (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        attempt_number INTEGER NOT NULL,
        started_at INTEGER NOT NULL,
        status TEXT NOT NULL,
        outcome_kind TEXT,
        completed_at INTEGER,
        FOREIGN KEY (run_id) REFERENCES runs(id)
      )
    `,
  },
  {
    id: "002-add-run-stop-cause",
    up: "ALTER TABLE runs ADD COLUMN stop_cause TEXT",
  },
];

/** Apply all pending migrations, recording each in the _migrations ledger. */
export function applyMigrations(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL
    )
  `);
  for (const migration of MIGRATIONS) {
    runMigration(db, migration);
  }
}

function runMigration(db: Database, migration: Migration): void {
  const exists = db.prepare("SELECT 1 FROM _migrations WHERE id = ?").get(migration.id);
  if (exists) return;

  if (migration.id === "002-add-run-stop-cause" && columnExists(db, "runs", "stop_cause")) {
    db.prepare("INSERT INTO _migrations (id, applied_at) VALUES (?, ?)").run(migration.id, Date.now());
    return;
  }

  try {
    db.exec(migration.up);
    db.prepare("INSERT INTO _migrations (id, applied_at) VALUES (?, ?)").run(migration.id, Date.now());
  } catch (error) {
    throw new Error(`Migration ${migration.id} failed: ${error}`);
  }
}

function columnExists(db: Database, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return rows.some((row) => row.name === column);
}
