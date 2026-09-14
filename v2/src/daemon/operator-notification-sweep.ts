import { spawn } from "node:child_process";
import type { StateStore } from "../persistence/state-store.ts";
import {
  deriveOperatorIncidents,
  NOTIFICATION_KEY_FORMAT_VERSION,
  type OperatorIncident,
  serializeOperatorIncident,
} from "./operator-incidents.ts";

export const NOTIFICATION_SWEEP_INTERVAL_MS = 5_000;

type NotificationSinkSpawnResult = { ok: true } | { ok: false };

export type NotificationSinkSpawner = (command: string, incidentJson: string) => NotificationSinkSpawnResult;

/** Fire-and-forget sink spawn; incident JSON is written to stdin. */
function spawnNotificationSinkCommand(command: string, incidentJson: string): NotificationSinkSpawnResult {
  try {
    // guard-unbounded-subprocess: fire-and-forget notification sink, detached + unref
    const child = spawn("bash", ["-c", command], {
      stdio: ["pipe", "ignore", "ignore"],
      detached: true,
    });
    child.stdin?.write(incidentJson);
    child.stdin?.end();
    child.unref();
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

export type NotificationSweepDeps = {
  store: StateStore;
  readSinkCommand: () => string | undefined;
  spawnSink?: NotificationSinkSpawner;
  nowMs?: () => number;
  wakeNotificationWaiters?: (store: StateStore) => void;
};

function deliverIncident(
  store: StateStore,
  incident: OperatorIncident,
  sinkCommand: string | undefined,
  spawnSink: NotificationSinkSpawner,
  deliveredAt: number,
  wakeNotificationWaiters?: (store: StateStore) => void,
): void {
  const { incidentId, transition } = incident;
  if (store.hasNotificationDelivery({ incidentId, transition })) {
    if (store.loadDeliveredNotificationIncident({ incidentId, transition }) !== null) {
      wakeNotificationWaiters?.(store);
    }
    return;
  }

  const incidentJson = serializeOperatorIncident(incident);

  if (sinkCommand === undefined) {
    if (store.tryRecordNotificationDelivery({ incidentId, transition, deliveredAt, incidentJson })) {
      wakeNotificationWaiters?.(store);
    }
    return;
  }

  if (!store.tryRecordNotificationDelivery({ incidentId, transition, deliveredAt, incidentJson })) return;

  const spawnResult = spawnSink(sinkCommand, incidentJson);
  if (!spawnResult.ok) {
    store.releaseNotificationDelivery({ incidentId, transition });
    return;
  }
  wakeNotificationWaiters?.(store);
}

export function shouldSkipOverlappingNotificationSweep(inProgress: boolean): boolean {
  return inProgress;
}

export function runNotificationSweepIntervalTick(
  state: { sweepInProgress: boolean },
  deps: NotificationSweepDeps,
  runSweep: (sweepDeps: NotificationSweepDeps) => void = runNotificationSweep,
): void {
  if (shouldSkipOverlappingNotificationSweep(state.sweepInProgress)) {
    return;
  }
  state.sweepInProgress = true;
  runSweep(deps);
  state.sweepInProgress = false;
}

/**
 * Whether a key-format reconcile may mark an owed incident delivered unseen: only incidents that
 * settled before this daemon started, which a prior daemon already delivered under the old format.
 */
export function isPreStartIncident(incident: Pick<OperatorIncident, "sinceMs">, daemonStartedAtMs: number): boolean {
  return incident.sinceMs !== null && incident.sinceMs < daemonStartedAtMs;
}

/**
 * Once per key-format change: mark every owed incident that settled before this daemon started as
 * delivered under the new format without spawning the sink, then record the version. Rows are
 * key-only (`incident_json` null), so `notifications wait|list` never surface them. Runs before the
 * boot sweep; a store already at the current version is untouched.
 */
export function reconcileNotificationKeyFormat(
  deps: Pick<NotificationSweepDeps, "store" | "nowMs"> & { daemonStartedAtMs: number },
): { suppressed: number } | null {
  const store = deps.store;
  if (store.isClosed()) return null;
  if (store.loadNotificationKeyFormatVersion() === NOTIFICATION_KEY_FORMAT_VERSION) return null;

  const nowMs = deps.nowMs?.() ?? Date.now();
  let suppressed = 0;
  for (const incident of deriveOperatorIncidents(store, nowMs)) {
    if (!isPreStartIncident(incident, deps.daemonStartedAtMs)) continue;
    const { incidentId, transition } = incident;
    if (store.tryRecordNotificationDelivery({ incidentId, transition, deliveredAt: nowMs })) suppressed += 1;
  }
  store.recordNotificationKeyFormatVersion(NOTIFICATION_KEY_FORMAT_VERSION);
  return { suppressed };
}

/** Diff derived incidents against the delivery ledger and discharge owed notifications. */
export function runNotificationSweep(deps: NotificationSweepDeps): void {
  const store = deps.store;
  if (store.isClosed()) return;

  const sinkCommand = deps.readSinkCommand()?.trim() || undefined;
  const spawnSink = deps.spawnSink ?? spawnNotificationSinkCommand;
  const nowMs = deps.nowMs?.() ?? Date.now();

  const wakeNotificationWaiters = deps.wakeNotificationWaiters;
  for (const incident of deriveOperatorIncidents(store, nowMs)) {
    deliverIncident(store, incident, sinkCommand, spawnSink, nowMs, wakeNotificationWaiters);
  }
  wakeNotificationWaiters?.(store);
}
