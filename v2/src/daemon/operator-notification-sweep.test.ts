import { Database } from "bun:sqlite";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStateStore, type StateStore } from "../persistence/state-store.ts";
import { removeOrchestrationStore } from "../persistence/state-store-on-disk.ts";
import {
  deriveOperatorIncidents,
  NOTIFICATION_KEY_FORMAT_VERSION,
  serializeOperatorIncident,
} from "./operator-incidents.ts";
import {
  isPreStartIncident,
  type NotificationSweepDeps,
  reconcileNotificationKeyFormat,
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

test("isPreStartIncident: only incidents settled before daemon start qualify", () => {
  expect(isPreStartIncident({ sinceMs: 49_999 }, 50_000)).toBe(true);
  expect(isPreStartIncident({ sinceMs: 50_000 }, 50_000)).toBe(false);
  expect(isPreStartIncident({ sinceMs: null }, 50_000)).toBe(false);
});

function seedBlockedRun(branch: string, atMs: number): string {
  const runId = store.createRun({ project: "demo", specRef: "main", worktreePath: "/tmp/w", branch, specPath: "s.md" });
  patchRunRow(runId, { status: "blocked", finishedAt: atMs, createdAt: atMs });
  return runId;
}

test("reconcileNotificationKeyFormat marks pre-start incidents delivered unseen and leaves later ones owed", () => {
  const preStartRunId = seedBlockedRun("old", 10_000);
  const postStartRunId = seedBlockedRun("new", 60_000);
  expect(store.loadNotificationKeyFormatVersion()).toBeNull();

  expect(reconcileNotificationKeyFormat({ store, nowMs: () => 70_000, daemonStartedAtMs: 50_000 })).toEqual({
    suppressed: 1,
  });
  expect(store.loadNotificationKeyFormatVersion()).toBe(NOTIFICATION_KEY_FORMAT_VERSION);
  expect(store.listDeliveredNotificationIncidents({ sinceMs: 0 })).toEqual([]);

  const spawned: string[] = [];
  runNotificationSweep({
    store,
    readSinkCommand: () => "sink",
    spawnSink: (_command, json) => {
      spawned.push(json);
      return { ok: true };
    },
    nowMs: () => 70_000,
  });
  expect(spawned.map((json) => (JSON.parse(json) as { runId: string }).runId)).toEqual([postStartRunId]);
  expect(store.hasNotificationDelivery({ incidentId: `run:${preStartRunId}`, transition: "blocked:10000" })).toBe(true);

  expect(reconcileNotificationKeyFormat({ store, nowMs: () => 80_000, daemonStartedAtMs: 50_000 })).toBeNull();
});

test("reconcileNotificationKeyFormat is a no-op at the current version", () => {
  seedBlockedRun("old", 10_000);
  store.recordNotificationKeyFormatVersion(NOTIFICATION_KEY_FORMAT_VERSION);
  expect(reconcileNotificationKeyFormat({ store, nowMs: () => 70_000, daemonStartedAtMs: 50_000 })).toBeNull();
  expect(deriveOperatorIncidents(store, 70_000)).toHaveLength(1);
});
