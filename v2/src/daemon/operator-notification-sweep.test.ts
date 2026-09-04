import { Database } from "bun:sqlite";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStateStore, type StateStore } from "../persistence/state-store.ts";
import { removeOrchestrationStore } from "../persistence/state-store-on-disk.ts";
import { deriveOperatorIncidents, serializeOperatorIncident } from "./operator-incidents.ts";
import {
  type NotificationSweepDeps,
  runNotificationSweep,
  runNotificationSweepIntervalTick,
  shouldSkipOverlappingNotificationSweep,
} from "./operator-notification-sweep.ts";

const dbPath = join(tmpdir(), `jarvis-operator-notification-sweep-${process.pid}.sqlite`);

let store: StateStore;

function patchRunRow(runId: string, patch: { createdAt?: number; finishedAt?: number | null; status?: string }): void {
  const raw = new Database(dbPath);
  try {
    if (patch.createdAt !== undefined) {
      raw.prepare("UPDATE runs SET created_at = ? WHERE id = ?").run(patch.createdAt, runId);
    }
    if (patch.finishedAt !== undefined) {
      raw.prepare("UPDATE runs SET finished_at = ? WHERE id = ?").run(patch.finishedAt, runId);
    }
    if (patch.status !== undefined) {
      raw.prepare("UPDATE runs SET status = ? WHERE id = ?").run(patch.status, runId);
    }
  } finally {
    raw.close();
  }
}

beforeEach(() => {
  removeOrchestrationStore(dbPath);
  store = openStateStore(dbPath);
});

afterEach(() => {
  store.close();
  removeOrchestrationStore(dbPath);
});

test("shouldSkipOverlappingNotificationSweep: skips only while a sweep is in flight", () => {
  expect(shouldSkipOverlappingNotificationSweep(false)).toBe(false);
  expect(shouldSkipOverlappingNotificationSweep(true)).toBe(true);
});

test("sweep persists incident_json on winning delivery insert", () => {
  const blockedRunId = store.createRun({
    project: "demo",
    specRef: "main",
    worktreePath: "/tmp/worktree",
    branch: "feature",
    specPath: "spec.md",
  });
  patchRunRow(blockedRunId, { status: "blocked", finishedAt: 10_000, createdAt: 10_000 });

  const incidents = deriveOperatorIncidents(store, 50_000);
  const incident = incidents[0];
  if (incident === undefined) throw new Error("expected blocked incident");
  const expectedJson = serializeOperatorIncident(incident);

  runNotificationSweep({
    store,
    readSinkCommand: () => undefined,
    nowMs: () => 50_000,
  });

  const raw = new Database(dbPath);
  try {
    const row = raw
      .prepare("SELECT incident_json FROM operator_notification_deliveries WHERE incident_id = ? AND transition = ?")
      .get(incident.incidentId, incident.transition) as { incident_json: string | null };
    expect(row.incident_json).toBe(expectedJson);
  } finally {
    raw.close();
  }
});

test("notification sweep timer skips a tick while the prior sweep is still running", () => {
  const state = { sweepInProgress: false };
  const deps: NotificationSweepDeps = {
    store: { isClosed: () => false } as StateStore,
    readSinkCommand: () => undefined,
  };

  let sweepCount = 0;
  const blockingSweep = (sweepDeps: NotificationSweepDeps) => {
    sweepCount += 1;
    runNotificationSweepIntervalTick(state, sweepDeps, blockingSweep);
  };

  runNotificationSweepIntervalTick(state, deps, blockingSweep);
  expect(sweepCount).toBe(1);
});
