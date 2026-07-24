import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { openStateStore, STATE_STORE_BUSY_TIMEOUT_MS } from "./state-store";

const tmpdir = () => process.env.TMPDIR || "/tmp";

describe("StateStore WAL concurrency", () => {
  test("concurrent reader observes committed rows while writer holds uncommitted transaction", () => {
    const testPath = join(tmpdir(), `jarvis-test-reader-${Date.now()}.sqlite`);
    try {
      const store = openStateStore(testPath);

      // Create initial run
      const initialRunId = store.createRun({
        project: "test-proj",
        specRef: "main",
        worktreePath: "/tmp/wt",
        branch: "branch1",
        specPath: "spec.md",
      });

      store.close();

      // Open a direct connection to hold a write transaction
      const writerDb = new Database(testPath);
      writerDb.exec("PRAGMA journal_mode=WAL");
      writerDb.exec(`PRAGMA busy_timeout=${STATE_STORE_BUSY_TIMEOUT_MS}`);
      writerDb.prepare("BEGIN IMMEDIATE").run();

      writerDb
        .prepare(
          "INSERT INTO runs (id, project, spec_ref, created_at, status, attempt_count, worktree_path, branch, spec_path) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)",
        )
        .run("uncommitted-id", "uncommitted-proj", "main", Date.now(), "in-progress", "/tmp", "uncommitted", "spec.md");

      // Now try to read from a separate connection while write is open
      const readerStore = openStateStore(testPath);
      const runs = readerStore.listRuns();

      // Should see the initial run but not the uncommitted one
      const ids = runs.map((r) => r.id);
      expect(ids).toContain(initialRunId);
      expect(ids).not.toContain("uncommitted-id");

      // Clean up
      writerDb.exec("COMMIT");
      writerDb.close();
      readerStore.close();

      // After commit, the new row should be visible
      const finalStore = openStateStore(testPath);
      const finalRuns = finalStore.listRuns();
      const finalIds = finalRuns.map((r) => r.id);
      expect(finalIds).toContain("uncommitted-id");
      finalStore.close();
    } finally {
      rmSync(testPath, { force: true });
      rmSync(`${testPath}-wal`, { force: true });
      rmSync(`${testPath}-shm`, { force: true });
    }
  });

  test("second writer on separate connection commits without database is locked", async () => {
    const testPath = join(tmpdir(), `jarvis-test-dual-writer-${Date.now()}.sqlite`);
    try {
      const store = openStateStore(testPath);
      store.close();

      // Spawn a subprocess that holds a write transaction, then commits after a delay
      const subprocess = spawn("bun", ["--eval", subprocess_lock_holder_script(testPath, 500)]);

      // Give subprocess time to acquire the lock
      await new Promise((resolve) => setTimeout(resolve, 100));

      const startTime = Date.now();

      // Now try to write from this process
      const store2 = openStateStore(testPath);
      const id = store2.createRun({
        project: "test-writer-2",
        specRef: "main",
        worktreePath: "/tmp/wt2",
        branch: "branch2",
        specPath: "spec.md",
      });

      const elapsed = Date.now() - startTime;

      // Should have succeeded without database is locked error
      expect(id).toBeTruthy();

      // Should have waited roughly the lock holder's hold time (500ms + some margin)
      // but definitely not the full busy timeout
      expect(elapsed).toBeLessThan(STATE_STORE_BUSY_TIMEOUT_MS);
      expect(elapsed).toBeGreaterThan(400);

      store2.close();

      // Wait for subprocess to exit
      await new Promise((resolve) => subprocess.on("close", resolve));
    } finally {
      rmSync(testPath, { force: true });
      rmSync(`${testPath}-wal`, { force: true });
      rmSync(`${testPath}-shm`, { force: true });
    }
  });

  test("listRuns polling vs concurrent completion boundary commits doesn't error", () => {
    const testPath = join(tmpdir(), `jarvis-test-polling-${Date.now()}.sqlite`);
    try {
      const store1 = openStateStore(testPath);

      // Create initial run
      const runId = store1.createRun({
        project: "test-proj",
        specRef: "main",
        worktreePath: "/tmp/wt",
        branch: "branch1",
        specPath: "spec.md",
      });

      store1.close();

      // Open a second store for polling
      const pollStore = openStateStore(testPath);

      // Use a separate connection to commit completion boundaries
      const writerStore = openStateStore(testPath);

      // Perform multiple polls while other connection commits boundaries
      for (let i = 0; i < 5; i++) {
        const attemptId = writerStore.recordAttemptStart(runId);
        writerStore.commitCompletionBoundary({
          attemptId,
          runStatus: "in-progress",
          outcomeKind: "progress",
        });

        // Poll while boundary was being committed (or just after)
        const runs = pollStore.listRuns();
        expect(runs).toHaveLength(1);
        expect(runs[0]?.id).toBe(runId);
      }

      writerStore.close();
      pollStore.close();
    } finally {
      rmSync(testPath, { force: true });
      rmSync(`${testPath}-wal`, { force: true });
      rmSync(`${testPath}-shm`, { force: true });
    }
  });

  test("multiple concurrent stores don't deadlock with completion boundary commits", () => {
    const testPath = join(tmpdir(), `jarvis-test-boundary-${Date.now()}.sqlite`);
    try {
      const store1 = openStateStore(testPath);

      // Create a run
      const runId = store1.createRun({
        project: "test-proj",
        specRef: "main",
        worktreePath: "/tmp/wt",
        branch: "branch1",
        specPath: "spec.md",
      });

      const attemptId = store1.recordAttemptStart(runId);

      // Open a second store
      const store2 = openStateStore(testPath);

      // Use store2 to read while store1 commits a boundary
      const runs2Before = store2.listRuns();
      expect(runs2Before).toHaveLength(1);

      // Commit the boundary on store1
      store1.commitCompletionBoundary({
        attemptId,
        runStatus: "completed",
        outcomeKind: "done",
      });

      // store2 should still be able to read
      const runs2After = store2.listRuns();
      expect(runs2After).toHaveLength(1);
      expect(runs2After[0]?.status).toBe("completed");

      store1.close();
      store2.close();
    } finally {
      rmSync(testPath, { force: true });
      rmSync(`${testPath}-wal`, { force: true });
      rmSync(`${testPath}-shm`, { force: true });
    }
  });
});

function subprocess_lock_holder_script(dbPath: string, holdTimeMs: number): string {
  return `
import { Database } from "bun:sqlite";
const db = new Database("${dbPath}");
db.exec("PRAGMA journal_mode=WAL");
db.prepare("BEGIN IMMEDIATE").run();
await new Promise(resolve => setTimeout(resolve, ${holdTimeMs}));
db.exec("COMMIT");
db.close();
`;
}
