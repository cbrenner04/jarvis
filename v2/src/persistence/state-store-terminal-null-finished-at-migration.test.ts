import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStateStore } from "./state-store.ts";
import { removeOrchestrationStore } from "./state-store-on-disk.ts";

const BASELINE_ID = "031-baseline-squash";
const PUBLICATION_FAILURE_MIGRATION_ID = "032-completed-publication-failure-rows-to-failed";
const MIGRATION_ID = "033-terminal-null-finished-at-backfill";
const CREATED_AT = 1_700_000_000_000;
const CHANGED_AT = CREATED_AT + 6_000;
const EXISTING_FINISHED_AT = CREATED_AT + 9_000;

type SeedRow = {
  id: string;
  status: string;
  createdAt: number;
  finishedAt: number | null;
  statusChangedAt: number | null;
};

const SEED_ROWS: SeedRow[] = [
  { id: "failed-from-changed", status: "failed", createdAt: CREATED_AT, finishedAt: null, statusChangedAt: CHANGED_AT },
  {
    id: "completed-from-created",
    status: "completed",
    createdAt: CREATED_AT + 1_000,
    finishedAt: null,
    statusChangedAt: null,
  },
  {
    id: "blocked-from-changed",
    status: "blocked",
    createdAt: CREATED_AT,
    finishedAt: null,
    statusChangedAt: CHANGED_AT + 1,
  },
  { id: "in-progress", status: "in-progress", createdAt: CREATED_AT, finishedAt: null, statusChangedAt: CHANGED_AT },
  { id: "paused", status: "paused", createdAt: CREATED_AT, finishedAt: null, statusChangedAt: CHANGED_AT },
  {
    id: "failed-has-finished",
    status: "failed",
    createdAt: CREATED_AT,
    finishedAt: EXISTING_FINISHED_AT,
    statusChangedAt: CHANGED_AT,
  },
];

const REPAIRED_IDS = ["failed-from-changed", "completed-from-created", "blocked-from-changed"];

function createStampedStore(dbPath: string): void {
  removeOrchestrationStore(dbPath);
  openStateStore(dbPath).close();
}

function seedRows(dbPath: string, ids: { stamp: readonly string[] }): void {
  const raw = new Database(dbPath);
  raw.exec("DELETE FROM _migrations");
  for (const id of ids.stamp) {
    raw.prepare("INSERT INTO _migrations (id, applied_at) VALUES (?, ?)").run(id, Date.now());
  }
  for (const row of SEED_ROWS) {
    raw
      .prepare(
        `INSERT INTO runs (
          id, project, spec_ref, created_at, status, worktree_path, branch, spec_path,
          finished_at, status_changed_at
        ) VALUES (?, 'p', 'main', ?, ?, '/w', 'b', 's.md', ?, ?)`,
      )
      .run(row.id, row.createdAt, row.status, row.finishedAt, row.statusChangedAt);
  }
  raw.close();
}

function readRows(dbPath: string): Record<string, Record<string, unknown>> {
  const raw = new Database(dbPath);
  const rows = raw.prepare("SELECT id, status, finished_at, status_changed_at, created_at FROM runs").all() as Array<
    Record<string, unknown> & { id: string }
  >;
  raw.close();
  return Object.fromEntries(rows.map((row) => [row.id, row]));
}

function readMigrationIds(dbPath: string): string[] {
  const raw = new Database(dbPath);
  const rows = raw.prepare("SELECT id FROM _migrations ORDER BY id").all() as Array<{ id: string }>;
  raw.close();
  return rows.map((row) => row.id);
}

describe("terminal null finished_at migration", () => {
  const dbPath = join(tmpdir(), "jarvis-test-state-terminal-null-finished-at-migration.sqlite");

  afterEach(() => {
    removeOrchestrationStore(dbPath);
  });

  test("backfills terminal null finished_at from COALESCE and leaves other rows untouched", () => {
    createStampedStore(dbPath);
    seedRows(dbPath, { stamp: [BASELINE_ID, PUBLICATION_FAILURE_MIGRATION_ID] });

    openStateStore(dbPath).close();
    const rows = readRows(dbPath);

    for (const seed of SEED_ROWS.filter((row) => REPAIRED_IDS.includes(row.id))) {
      expect(rows[seed.id]).toMatchObject({
        status: seed.status,
        finished_at: seed.statusChangedAt ?? seed.createdAt,
        status_changed_at: seed.statusChangedAt,
        created_at: seed.createdAt,
      });
    }
    expect(rows["in-progress"]).toMatchObject({ finished_at: null });
    expect(rows.paused).toMatchObject({ finished_at: null });
    expect(rows["failed-has-finished"]).toMatchObject({ finished_at: EXISTING_FINISHED_AT });
    expect(readMigrationIds(dbPath)).toEqual([BASELINE_ID, PUBLICATION_FAILURE_MIGRATION_ID, MIGRATION_ID]);

    const before = readRows(dbPath);
    openStateStore(dbPath).close();
    expect(readRows(dbPath)).toEqual(before);

    const raw = new Database(dbPath);
    raw.exec("UPDATE runs SET finished_at = NULL WHERE id = 'failed-from-changed'");
    raw.close();
    openStateStore(dbPath).close();
    expect(readRows(dbPath)["failed-from-changed"]?.finished_at).toBeNull();
    expect(readMigrationIds(dbPath)).toEqual([BASELINE_ID, PUBLICATION_FAILURE_MIGRATION_ID, MIGRATION_ID]);
  });

  test("a pre-squash store is upgraded and repaired in one open", () => {
    createStampedStore(dbPath);
    seedRows(dbPath, { stamp: ["004-invocation-failure-detail", "030-operator-notification-delivery"] });

    openStateStore(dbPath).close();

    const rows = readRows(dbPath);
    for (const seed of SEED_ROWS.filter((row) => REPAIRED_IDS.includes(row.id))) {
      expect(rows[seed.id]?.finished_at).toBe(seed.statusChangedAt ?? seed.createdAt);
    }
    expect(readMigrationIds(dbPath)).toEqual([
      "004-invocation-failure-detail",
      "030-operator-notification-delivery",
      BASELINE_ID,
      PUBLICATION_FAILURE_MIGRATION_ID,
      MIGRATION_ID,
    ]);
  });
});
