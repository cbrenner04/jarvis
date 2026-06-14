import type { Database } from "bun:sqlite";

/** A single log-schema migration. Append-only: never edit or reorder applied entries. */
export type LogMigration = { id: string; up: string };

/** Ordered log-schema migrations. Add new ones at the end. */
export const LOG_MIGRATIONS: LogMigration[] = [
  {
    id: "001-create-log-records",
    up: `
      CREATE TABLE IF NOT EXISTS log_records (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        ts INTEGER NOT NULL,
        level TEXT NOT NULL,
        event TEXT NOT NULL,
        data_json TEXT,
        UNIQUE(run_id, seq)
      );
      CREATE INDEX IF NOT EXISTS idx_log_records_run_seq ON log_records(run_id, seq)
    `,
  },
];

/** Apply all pending log migrations, recording each in the _log_migrations ledger. */
export function applyLogMigrations(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _log_migrations (
      id TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL
    )
  `);
  for (const migration of LOG_MIGRATIONS) {
    runLogMigration(db, migration);
  }
}

function runLogMigration(db: Database, migration: LogMigration): void {
  const exists = db.prepare("SELECT 1 FROM _log_migrations WHERE id = ?").get(migration.id);
  if (exists) return;

  try {
    db.exec(migration.up);
    db.prepare("INSERT INTO _log_migrations (id, applied_at) VALUES (?, ?)").run(migration.id, Date.now());
  } catch (error) {
    throw new Error(`Log migration ${migration.id} failed: ${error}`);
  }
}
