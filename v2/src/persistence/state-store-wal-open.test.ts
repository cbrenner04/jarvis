import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { removeOrchestrationStore } from "./state-store-on-disk";
import { openStateStore, STATE_STORE_BUSY_TIMEOUT_MS } from "./state-store";

const tmpdir = () => process.env.TMPDIR || "/tmp";

function withTempDb(name: string, run: (testPath: string) => void): void {
  const testPath = join(tmpdir(), `jarvis-test-${name}-${Date.now()}.sqlite`);
  try {
    run(testPath);
  } finally {
    removeOrchestrationStore(testPath);
  }
}

describe("StateStore WAL open settings", () => {
  test("new openStateStore database reports journal_mode = wal", () => {
    withTempDb("journal-mode", (testPath) => {
      const store = openStateStore(testPath);
      const db = new Database(testPath);
      const result = db.prepare("PRAGMA journal_mode").get() as Record<string, unknown>;
      expect(String(result.journal_mode)).toBe("wal");
      db.close();
      store.close();
    });
  });

  test("STATE_STORE_BUSY_TIMEOUT_MS is set to a non-zero value", () => {
    expect(STATE_STORE_BUSY_TIMEOUT_MS).toBeGreaterThan(0);
  });

  test("opening pre-seeded delete-mode database migrates to WAL with rows intact", () => {
    withTempDb("migration", (testPath) => {
      // Create database in delete journal mode and seed with data
      const oldDb = new Database(testPath);
      oldDb.exec("PRAGMA journal_mode=DELETE");
      oldDb.exec(`
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
      `);
      oldDb
        .prepare(
          "INSERT INTO runs (id, project, spec_ref, created_at, status, attempt_count, worktree_path, branch, spec_path) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)",
        )
        .run("seed-id", "seed-proj", "main", Date.now(), "in-progress", "/tmp", "seed-branch", "spec.md");
      oldDb.close();

      // Verify it was in delete mode
      const beforeDb = new Database(testPath);
      const before = beforeDb.prepare("PRAGMA journal_mode").get() as Record<string, unknown>;
      expect(String(before.journal_mode)).toBe("delete");
      beforeDb.close();

      // Now open with openStateStore (should trigger migration to WAL)
      const store = openStateStore(testPath);

      // Verify it's now in WAL mode
      const afterDb = new Database(testPath);
      const after = afterDb.prepare("PRAGMA journal_mode").get() as Record<string, unknown>;
      expect(String(after.journal_mode)).toBe("wal");

      // Verify the seeded row is still there
      const row = afterDb.prepare("SELECT id, project FROM runs WHERE id = ?").get("seed-id") as {
        id: string;
        project: string;
      } | null;
      expect(row?.id).toBe("seed-id");
      expect(row?.project).toBe("seed-proj");

      afterDb.close();
      store.close();
    });
  });

  test("state store can be reopened and reads existing data", () => {
    withTempDb("reopen", (testPath) => {
      // Create run with first store
      const store1 = openStateStore(testPath);
      const runId = store1.createRun({
        project: "test-proj",
        specRef: "main",
        worktreePath: "/tmp/wt",
        branch: "branch1",
        specPath: "spec.md",
      });
      store1.close();

      // Reopen and verify data persists
      const store2 = openStateStore(testPath);
      const run = store2.loadRun(runId);
      expect(run?.id).toBe(runId);
      expect(run?.project).toBe("test-proj");
      store2.close();
    });
  });
});
