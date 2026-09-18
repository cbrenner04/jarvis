import {
  gateInvocationAdmits,
  liveGateInvocationLeaseCount,
  MAX_CONCURRENT_AGENT_GATE_INVOCATIONS,
  subscribeGateInvocationLeaseReleased,
} from "../execution/write-loop.ts";
import { type LogEvent, type LogSink, openLogSink } from "../persistence/log-stream.ts";
import type { Run, StateStore } from "../persistence/state-store.ts";

/** Lifetime cap on automatic re-drives per run, shared by every daemon generation. */
export const MAX_SLOT_REDRIVES = 3;

type SlotRedriveResumeResult = { kind: "response"; result: unknown } | { kind: "error"; code: string; message: string };

export type SlotRedriveCoordinator = {
  /** Queue a settled run when it is a re-drivable slot-contention refusal; otherwise a no-op. */
  enqueue(runId: string): void;
  /** Rebuild the waiting set from durable slot-refused rows after a daemon restart, then drain. */
  rehydrate(): void;
  /**
   * Late-bind the resume path (the `run.resume` handler) the coordinator dispatches through, plus an
   * optional check of a rehydrated lane's retained work: a returned reason drops the entry uncounted.
   */
  bindResume(
    resume: (runId: string) => Promise<SlotRedriveResumeResult> | SlotRedriveResumeResult,
    retainedWorkProblem?: (runId: string) => string | undefined,
  ): void;
  /** Drop the release subscription and every waiting entry. */
  stop(): void;
};

type SlotRedriveCoordinatorDeps = {
  store: StateStore;
  logsPath: string | undefined;
  isRetiring: () => boolean;
  /** Whether a reachable draining predecessor generation still owns `runId`. */
  predecessorOwns?: (runId: string) => Promise<boolean>;
};

/** A failed, undismissed slot-contention refusal — the only row shape the coordinator re-drives. */
export function slotRedriveWaiting(run: Run | null | undefined): run is Run {
  return (
    run !== null &&
    run !== undefined &&
    run.status === "failed" &&
    run.terminalCause === "gate_invocation_refused" &&
    run.gateRefusalRecoveryState?.cause === "slot_contention" &&
    (run.dismissedAt ?? null) === null
  );
}

export function slotRedriveCountOf(run: Run): number {
  return run.gateRefusalRecoveryState?.slotRedriveCount ?? 0;
}

/** Oldest refusal first by durable `finishedAt`, ties broken by run id. */
export function compareSlotRedriveOrder(a: Run, b: Run): number {
  const byFinished = (a.finishedAt ?? 0) - (b.finishedAt ?? 0);
  if (byFinished !== 0) return byFinished;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function gateSlotFree(): boolean {
  return gateInvocationAdmits(liveGateInvocationLeaseCount(), MAX_CONCURRENT_AGENT_GATE_INVOCATIONS);
}

export function createSlotRedriveCoordinator(deps: SlotRedriveCoordinatorDeps): SlotRedriveCoordinator {
  const { store } = deps;
  const waiting = new Set<string>();
  const rehydrated = new Set<string>();
  let retainedWorkProblem: ((runId: string) => string | undefined) | undefined;
  let resume: ((runId: string) => Promise<SlotRedriveResumeResult> | SlotRedriveResumeResult) | undefined;
  let unsubscribe: (() => void) | undefined;
  let draining = false;
  let drainRequested = false;

  const log = (runId: string, event: LogEvent): void => {
    if (deps.logsPath === undefined) return;
    let sink: LogSink | undefined;
    try {
      sink = openLogSink(deps.logsPath);
      sink.append(runId, event);
    } catch {
      // best-effort diagnostics; never block a re-drive decision
    } finally {
      sink?.close();
    }
  };

  const ownerAdmits = async (runId: string): Promise<boolean> => {
    if (!(await store.forceKillOwnerAdmits(runId))) return false;
    return !(await (deps.predecessorOwns?.(runId) ?? Promise.resolve(false)).catch(() => false));
  };

  type DispatchOutcome = "dispatched" | "slot_taken" | "dropped";

  const dispatch = async (run: Run): Promise<DispatchOutcome> => {
    const runId = run.id;
    if (!(await ownerAdmits(runId))) {
      waiting.delete(runId);
      log(runId, { kind: "slot_redrive_skipped_owner" });
      return "dropped";
    }
    // The row and slot may have changed while the owner probe was awaited.
    const fresh = store.loadRun(runId);
    if (!slotRedriveWaiting(fresh) || slotRedriveCountOf(fresh) >= MAX_SLOT_REDRIVES) {
      waiting.delete(runId);
      return "dropped";
    }
    const problem = rehydrated.has(runId) ? retainedWorkProblem?.(runId) : undefined;
    if (problem !== undefined) {
      waiting.delete(runId);
      log(runId, { kind: "slot_redrive_refused", code: problem, slotRedriveCount: slotRedriveCountOf(fresh) });
      return "dropped";
    }
    if (!gateSlotFree()) return "slot_taken";
    const redrive = resume;
    const slotRedriveCount = redrive === undefined ? undefined : store.incrementSlotRedriveCount(runId);
    waiting.delete(runId);
    rehydrated.delete(runId);
    if (slotRedriveCount === undefined || redrive === undefined) return "dropped";
    log(runId, { kind: "slot_redrive", slotRedriveCount, bound: MAX_SLOT_REDRIVES });
    const result = await redrive(runId);
    if (result.kind === "error") {
      log(runId, { kind: "slot_redrive_refused", code: result.code, slotRedriveCount });
      return "dropped";
    }
    return "dispatched";
  };

  /** Waiting rows still eligible, oldest first; entries whose row moved on are dropped. */
  const oldestFirst = (): Run[] => {
    const rows: Run[] = [];
    for (const runId of [...waiting]) {
      const row = store.loadRun(runId);
      if (slotRedriveWaiting(row) && slotRedriveCountOf(row) < MAX_SLOT_REDRIVES) rows.push(row);
      else waiting.delete(runId);
    }
    return rows.sort(compareSlotRedriveOrder);
  };

  const drainOnce = async (): Promise<void> => {
    if (deps.isRetiring() || !gateSlotFree()) return;
    for (const run of oldestFirst()) {
      const outcome = await dispatch(run);
      if (outcome !== "dropped") return;
    }
  };

  const release = (): void => {
    if (waiting.size > 0) return;
    unsubscribe?.();
    unsubscribe = undefined;
  };

  const drain = async (): Promise<void> => {
    if (draining) {
      drainRequested = true;
      return;
    }
    draining = true;
    try {
      do {
        drainRequested = false;
        await drainOnce();
      } while (drainRequested);
    } catch {
      // a failed pass leaves entries waiting for the next release
    } finally {
      draining = false;
      release();
    }
  };

  const enqueue = (runId: string): void => {
    let run: Run | null | undefined;
    try {
      run = store.loadRun(runId);
    } catch {
      return; // store already closed during daemon shutdown
    }
    if (!slotRedriveWaiting(run)) return;
    const slotRedriveCount = slotRedriveCountOf(run);
    if (slotRedriveCount >= MAX_SLOT_REDRIVES) {
      log(runId, { kind: "slot_redrive_exhausted", slotRedriveCount, bound: MAX_SLOT_REDRIVES });
      return;
    }
    waiting.add(runId);
    rehydrated.delete(runId);
    unsubscribe ??= subscribeGateInvocationLeaseReleased(() => void drain());
    // The release this lane waits for may already have happened; drain off the settling stack.
    if (gateSlotFree()) queueMicrotask(() => void drain());
  };

  const rehydrate = (): void => {
    let rows: Run[];
    try {
      rows = store.listRuns();
    } catch {
      return; // store already closed during daemon shutdown
    }
    const pending = rows.filter((row) => slotRedriveWaiting(row) && slotRedriveCountOf(row) < MAX_SLOT_REDRIVES);
    if (pending.length === 0) return;
    for (const row of pending) {
      waiting.add(row.id);
      rehydrated.add(row.id);
    }
    unsubscribe ??= subscribeGateInvocationLeaseReleased(() => void drain());
    if (gateSlotFree()) queueMicrotask(() => void drain());
  };

  return {
    enqueue,
    rehydrate,
    bindResume: (fn, retained) => {
      resume = fn;
      retainedWorkProblem = retained;
    },
    stop: () => {
      waiting.clear();
      rehydrated.clear();
      unsubscribe?.();
      unsubscribe = undefined;
    },
  };
}
