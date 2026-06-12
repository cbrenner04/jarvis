import type { Database } from "bun:sqlite";

/** A single schema migration. Append-only: never edit or reorder applied entries. */
export type Migration = { id: string; up: string };

/** Ordered schema migrations. Add new ones at the end. */
export const MIGRATIONS: Migration[] = [
  {
    id: "001-create-runs",
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
      )
    `,
  },
  {
    id: "002-create-attempts",
    up: `
      CREATE TABLE IF NOT EXISTS attempts (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        attempt_number INTEGER NOT NULL,
        started_at INTEGER NOT NULL,
        status TEXT NOT NULL,
        FOREIGN KEY (run_id) REFERENCES runs(id)
      )
    `,
  },
  {
    id: "003-create-outcomes",
    up: `
      CREATE TABLE IF NOT EXISTS outcomes (
        id TEXT PRIMARY KEY,
        attempt_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        completed_at INTEGER NOT NULL,
        FOREIGN KEY (attempt_id) REFERENCES attempts(id)
      )
    `,
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
  for (const migration of MIGRATIONS) runMigration(db, migration);
}

function runMigration(db: Database, migration: Migration): void {
  const exists = db.prepare("SELECT 1 FROM _migrations WHERE id = ?").get(migration.id);
  if (exists) return;

  try {
    db.exec(migration.up);
    db.prepare("INSERT INTO _migrations (id, applied_at) VALUES (?, ?)").run(migration.id, Date.now());
  } catch (error) {
    throw new Error(`Migration ${migration.id} failed: ${error}`);
  }
}
