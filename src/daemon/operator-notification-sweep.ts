import { spawn } from "node:child_process";
import type { LogReader, PersistedRecord } from "../persistence/log-stream.ts";
import type { StateStore } from "../persistence/state-store.ts";
import {
  type DeriveOperatorIncidentsOptions,
  deriveOperatorIncidents,
  NOTIFICATION_KEY_FORMAT_VERSION,
  type OperatorIncident,
  serializeOperatorIncident,
} from "./operator-incidents.ts";
import { findTerminalLogRecord, type TerminalLogRecord } from "./run-operator-error.ts";

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
  logReader?: LogReader;
  deriveOperatorIncidentsOptions?: DeriveOperatorIncidentsOptions;
};

/**
 * Per-tick memoized terminal-record lookup: the log is read at most once (via `readAllRecords` when the
 * reader offers it), never once per candidate run.
 */
function terminalLogRecordLookup(logReader: LogReader): (runId: string) => TerminalLogRecord | undefined {
  const memo = new Map<string, TerminalLogRecord | undefined>();
  let recordsByRun: Map<string, PersistedRecord[]> | undefined;
  return (runId) => {
    if (memo.has(runId)) return memo.get(runId);
    let records: PersistedRecord[];
    if (logReader.readAllRecords === undefined) {
      records = logReader.tail(runId);
    } else {
      if (recordsByRun === undefined) {
        recordsByRun = new Map();
        for (const record of logReader.readAllRecords()) {
          const bucket = recordsByRun.get(record.runId);
          if (bucket === undefined) recordsByRun.set(record.runId, [record]);
          else bucket.push(record);
        }
      }
      records = [...(recordsByRun.get(runId) ?? [])].sort((a, b) => a.seq - b.seq);
    }
    const terminal = findTerminalLogRecord(records);
    memo.set(runId, terminal);
    return terminal;
  };
}

/** Terminal `loop_finished` lane signal for notification derivation (same source as run list/wait). */
export function notificationSweepDeriveOptions(
  deps: Pick<NotificationSweepDeps, "logReader" | "deriveOperatorIncidentsOptions">,
): DeriveOperatorIncidentsOptions {
  const explicit = deps.deriveOperatorIncidentsOptions ?? {};
  const fromLog = deps.logReader === undefined ? undefined : terminalLogRecordLookup(deps.logReader);
  const explicitForRun = explicit.terminalLogRecordForRun;
  if (fromLog === undefined) return explicit;
  if (explicitForRun === undefined) return { ...explicit, terminalLogRecordForRun: fromLog };
  return {
    ...explicit,
    terminalLogRecordForRun: (runId) => explicitForRun(runId) ?? fromLog(runId),
  };
}

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
  deps: Pick<NotificationSweepDeps, "store" | "nowMs" | "logReader" | "deriveOperatorIncidentsOptions"> & {
    daemonStartedAtMs: number;
  },
): { suppressed: number } | null {
  const store = deps.store;
  if (store.isClosed()) return null;
  if (store.loadNotificationKeyFormatVersion() === NOTIFICATION_KEY_FORMAT_VERSION) return null;

  const nowMs = deps.nowMs?.() ?? Date.now();
  const deriveOptions = notificationSweepDeriveOptions(deps);
  let suppressed = 0;
  for (const incident of deriveOperatorIncidents(store, nowMs, deriveOptions)) {
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
  const deriveOptions = notificationSweepDeriveOptions(deps);
  for (const incident of deriveOperatorIncidents(store, nowMs, deriveOptions)) {
    deliverIncident(store, incident, sinkCommand, spawnSink, nowMs, wakeNotificationWaiters);
  }
  wakeNotificationWaiters?.(store);
}
