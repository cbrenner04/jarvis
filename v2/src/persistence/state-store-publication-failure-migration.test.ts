import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ATTENTION_TERMINAL_RECENCY_MS } from "../attention-terminal-recency.ts";
import { deriveOperatorIncidents } from "../daemon/operator-incidents.ts";
import { openStateStore } from "./state-store.ts";
import { removeOrchestrationStore } from "./state-store-on-disk.ts";

const BASELINE_ID = "031-baseline-squash";
const MIGRATION_ID = "032-completed-publication-failure-rows-to-failed";
const CREATED_AT = 1_700_000_000_000;
const FINISHED_AT = CREATED_AT + 5_000;
const CHANGED_AT = CREATED_AT + 6_000;

type SeedRow = { id: string; status: string; cause: string | null };

const SEED_ROWS: SeedRow[] = [
  { id: "commit-failed", status: "completed", cause: "completion_commit_failed" },
  { id: "ready-flip-failed", status: "completed", cause: "ready_flip_failed" },
  { id: "complete", status: "completed", cause: "complete" },
  { id: "null-cause", status: "completed", cause: null },
  { id: "stale-gate-failed", status: "completed", cause: "ready_gate_failed" },
  { id: "failed-commit", status: "failed", cause: "completion_commit_failed" },
  { id: "paused-flip", status: "paused", cause: "ready_flip_failed" },
];

const REPAIRED_IDS = ["commit-failed", "ready-flip-failed"];

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
          finished_at, status_changed_at, terminal_cause, terminal_failure_detail
        ) VALUES (?, 'p', 'main', ?, ?, '/w', 'b', 's.md', ?, ?, ?, ?)`,
      )
      .run(row.id, CREATED_AT, row.status, FINISHED_AT, CHANGED_AT, row.cause, `detail-${row.id}`);
  }
  raw.close();
}

function readRows(dbPath: string): Record<string, Record<string, unknown>> {
  const raw = new Database(dbPath);
  const rows = raw
    .prepare("SELECT id, status, terminal_cause, terminal_failure_detail, finished_at, status_changed_at FROM runs")
    .all() as Array<Record<string, unknown> & { id: string }>;
  raw.close();
  return Object.fromEntries(rows.map((row) => [row.id, row]));
}

function readMigrationIds(dbPath: string): string[] {
  const raw = new Database(dbPath);
  const rows = raw.prepare("SELECT id FROM _migrations ORDER BY id").all() as Array<{ id: string }>;
  raw.close();
  return rows.map((row) => row.id);
}

describe("completed publication-failure rows migration", () => {
  const dbPath = join(tmpdir(), "jarvis-test-state-publication-failure-migration.sqlite");

  afterEach(() => {
    removeOrchestrationStore(dbPath);
  });

  test("rewrites completed rows with a publication-failure cause to failed and leaves other rows untouched", () => {
    createStampedStore(dbPath);
    seedRows(dbPath, { stamp: [BASELINE_ID] });

    openStateStore(dbPath).close();
    const rows = readRows(dbPath);

    for (const id of REPAIRED_IDS) {
      const row = SEED_ROWS.find((seed) => seed.id === id);
      expect(rows[id]).toEqual({
        id,
        status: "failed",
        terminal_cause: row?.cause,
        terminal_failure_detail: `detail-${id}`,
        finished_at: FINISHED_AT,
        status_changed_at: CHANGED_AT,
      });
    }
    for (const seed of SEED_ROWS.filter((row) => !REPAIRED_IDS.includes(row.id))) {
      expect(rows[seed.id]).toMatchObject({ status: seed.status, terminal_cause: seed.cause });
    }
    expect(readMigrationIds(dbPath)).toEqual([BASELINE_ID, MIGRATION_ID]);

    const before = readRows(dbPath);
    openStateStore(dbPath).close();
    expect(readRows(dbPath)).toEqual(before);

    // Once stamped, the migration is skipped: a later matching row is not rewritten.
    const raw = new Database(dbPath);
    raw.exec("UPDATE runs SET status = 'completed' WHERE id = 'commit-failed'");
    raw.close();
    openStateStore(dbPath).close();
    expect(readRows(dbPath)["commit-failed"]?.status).toBe("completed");
    expect(readMigrationIds(dbPath)).toEqual([BASELINE_ID, MIGRATION_ID]);
  });

  test("a pre-squash store is upgraded and repaired in one open", () => {
    createStampedStore(dbPath);
    seedRows(dbPath, { stamp: ["004-invocation-failure-detail", "030-operator-notification-delivery"] });

    openStateStore(dbPath).close();

    expect(readRows(dbPath)["commit-failed"]?.status).toBe("failed");
    expect(readMigrationIds(dbPath)).toEqual([
      "004-invocation-failure-detail",
      "030-operator-notification-delivery",
      BASELINE_ID,
      MIGRATION_ID,
    ]);
  });

  test("a repaired row older than the recency window derives no incident", () => {
    createStampedStore(dbPath);
    seedRows(dbPath, { stamp: [BASELINE_ID] });
    const store = openStateStore(dbPath);
    try {
      const staleNow = FINISHED_AT + ATTENTION_TERMINAL_RECENCY_MS + 1;
      const incidentRunIds = (nowMs: number) =>
        deriveOperatorIncidents(store, nowMs)
          .map((incident) => ("runId" in incident ? incident.runId : undefined))
          .filter((runId) => runId !== undefined && REPAIRED_IDS.includes(runId));
      expect(incidentRunIds(staleNow)).toEqual([]);
      expect(incidentRunIds(FINISHED_AT + 1).sort()).toEqual([...REPAIRED_IDS].sort());
    } finally {
      store.close();
    }
  });
});
