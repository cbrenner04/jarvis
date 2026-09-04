import { spawn } from "node:child_process";
import type { StateStore } from "../persistence/state-store.ts";
import { deriveOperatorIncidents, type OperatorIncident, serializeOperatorIncident } from "./operator-incidents.ts";

export const NOTIFICATION_SWEEP_INTERVAL_MS = 5_000;

export type NotificationSinkSpawnResult = { ok: true } | { ok: false };

export type NotificationSinkSpawner = (command: string, incidentJson: string) => NotificationSinkSpawnResult;

/** Fire-and-forget sink spawn; incident JSON is written to stdin. */
export function spawnNotificationSinkCommand(command: string, incidentJson: string): NotificationSinkSpawnResult {
  try {
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
};

function deliverIncident(
  store: StateStore,
  incident: OperatorIncident,
  sinkCommand: string | undefined,
  spawnSink: NotificationSinkSpawner,
  deliveredAt: number,
): void {
  const { incidentId, transition } = incident;
  if (store.hasNotificationDelivery({ incidentId, transition })) return;

  const incidentJson = serializeOperatorIncident(incident);

  if (sinkCommand === undefined) {
    store.tryRecordNotificationDelivery({ incidentId, transition, deliveredAt, incidentJson });
    return;
  }

  if (!store.tryRecordNotificationDelivery({ incidentId, transition, deliveredAt, incidentJson })) return;

  const spawnResult = spawnSink(sinkCommand, incidentJson);
  if (!spawnResult.ok) {
    store.releaseNotificationDelivery({ incidentId, transition });
  }
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

/** Diff derived incidents against the delivery ledger and discharge owed notifications. */
export function runNotificationSweep(deps: NotificationSweepDeps): void {
  const store = deps.store;
  if (store.isClosed()) return;

  const sinkCommand = deps.readSinkCommand()?.trim() || undefined;
  const spawnSink = deps.spawnSink ?? spawnNotificationSinkCommand;
  const nowMs = deps.nowMs?.() ?? Date.now();

  for (const incident of deriveOperatorIncidents(store, nowMs)) {
    deliverIncident(store, incident, sinkCommand, spawnSink, nowMs);
  }
}
