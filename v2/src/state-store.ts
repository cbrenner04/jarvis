import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

export type BootstrapStateStoreOptions = {
  dbPath?: string;
};

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
