export const MAX_CONCURRENT_AGENT_GATE_INVOCATIONS = 1;

/** An owned hold on the machine-wide gate-invocation budget; only its holder can release it. */
export type GateInvocationLease = { release: () => void };

const liveGateInvocationLeases = new Set<GateInvocationLease>();
const gateInvocationLeaseReleaseListeners = new Set<() => void>();

type LeaseWaiter = {
  grant: (lease: GateInvocationLease) => void;
  dispose: () => void;
};

const leaseWaitQueue: LeaseWaiter[] = [];

/** Subscribe to lease releases; listeners run in a microtask after the lease is deleted, and a throwing listener does not affect others. Returns an unsubscribe. */
export function subscribeGateInvocationLeaseReleased(listener: () => void): () => void {
  gateInvocationLeaseReleaseListeners.add(listener);
  return () => {
    gateInvocationLeaseReleaseListeners.delete(listener);
  };
}

function notifyGateInvocationLeaseReleased(): void {
  const listeners = [...gateInvocationLeaseReleaseListeners];
  queueMicrotask(() => {
    for (const listener of listeners) {
      try {
        listener();
      } catch {
        // A faulty listener must not starve the others.
      }
    }
  });
}

/** Pure admission: one more full-suite gate invocation fits while the live count is below the limit. */
export function gateInvocationAdmits(heldCount: number, limit: number): boolean {
  return heldCount < limit;
}

function createGateInvocationLease(): GateInvocationLease | undefined {
  if (!gateInvocationAdmits(liveGateInvocationLeases.size, MAX_CONCURRENT_AGENT_GATE_INVOCATIONS)) return undefined;
  const lease: GateInvocationLease = {
    release: () => {
      if (!liveGateInvocationLeases.delete(lease)) return;
      notifyGateInvocationLeaseReleased();
      drainLeaseWaitQueue();
    },
  };
  liveGateInvocationLeases.add(lease);
  return lease;
}

function drainLeaseWaitQueue(): void {
  while (leaseWaitQueue.length > 0) {
    const lease = createGateInvocationLease();
    if (lease === undefined) return;
    const waiter = leaseWaitQueue.shift();
    if (waiter === undefined) {
      lease.release();
      return;
    }
    waiter.grant(lease);
  }
}

function dequeueLeaseWaiter(waiter: LeaseWaiter): void {
  const index = leaseWaitQueue.indexOf(waiter);
  if (index !== -1) leaseWaitQueue.splice(index, 1);
}

/** Acquire an owned lease, or `undefined` when `MAX_CONCURRENT_AGENT_GATE_INVOCATIONS` leases are live. Release is idempotent and removes only this lease. */
export function acquireGateInvocationLease(): GateInvocationLease | undefined {
  return createGateInvocationLease();
}

export function liveGateInvocationLeaseCount(): number {
  return liveGateInvocationLeases.size;
}

export const HARNESS_GATE_SLOT_WAIT_LIST_MESSAGE = "waiting for gate slot";

const harnessGateSlotWaitByRunId = new Map<string, string>();
let leasedHarnessFullSuiteGateSpawns = 0;

/** While a harness finalization gate is queued on the slot, `jarvis run list` surfaces this message. */
export function harnessGateSlotWaitListMessage(runId: string): string | undefined {
  return harnessGateSlotWaitByRunId.has(runId) ? HARNESS_GATE_SLOT_WAIT_LIST_MESSAGE : undefined;
}

/** In-flight harness full-suite gate spawns holding the slot lease (ready gate and required integration). */
export function leasedHarnessFullSuiteGateSpawnCount(): number {
  return leasedHarnessFullSuiteGateSpawns;
}

function markHarnessGateSlotWait(runId: string, gate: string): void {
  harnessGateSlotWaitByRunId.set(runId, gate);
}

function clearHarnessGateSlotWait(runId: string): void {
  harnessGateSlotWaitByRunId.delete(runId);
}

/** Wait in FIFO order for an owned lease when the cap is held; refuses never queue here. */
export function awaitGateInvocationLease(options: {
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<GateInvocationLease> {
  const immediate = acquireGateInvocationLease();
  if (immediate !== undefined) return Promise.resolve(immediate);

  return new Promise((resolve, reject) => {
    let settled = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let abortListener: (() => void) | undefined;

    const finish = (result: { ok: true; lease: GateInvocationLease } | { ok: false; error: Error }) => {
      if (settled) {
        if (result.ok) result.lease.release();
        return;
      }
      settled = true;
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      if (abortListener !== undefined && options.signal !== undefined) {
        options.signal.removeEventListener("abort", abortListener);
      }
      if (result.ok) resolve(result.lease);
      else reject(result.error);
    };

    const waiter: LeaseWaiter = {
      grant: (lease) => {
        finish({ ok: true, lease });
      },
      dispose: () => {
        dequeueLeaseWaiter(waiter);
      },
    };

    const onAbort = () => {
      waiter.dispose();
      finish({ ok: false, error: new Error("gate invocation lease wait aborted") });
    };

    if (options.signal?.aborted) {
      finish({ ok: false, error: new Error("gate invocation lease wait aborted") });
      return;
    }

    if (options.signal !== undefined) {
      abortListener = onAbort;
      options.signal.addEventListener("abort", abortListener, { once: true });
    }

    if (options.timeoutMs !== undefined) {
      timeoutId = setTimeout(() => {
        waiter.dispose();
        finish({ ok: false, error: new Error(`gate invocation lease wait timed out after ${options.timeoutMs}ms`) });
      }, options.timeoutMs);
    }

    leaseWaitQueue.push(waiter);
  });
}

type HarnessFullSuiteGateSlotOptions = {
  gate: string;
  runId?: string;
  signal?: AbortSignal;
  slotWaitTimeoutMs: number;
  onSlotWait?: (fields: { gate: string; waitedMs: number }) => void;
};

/** Acquire the shared gate slot (waiting in FIFO order when held), run one full-suite gate spawn, then release. */
export async function runHarnessFullSuiteGateWithSlot(
  options: HarnessFullSuiteGateSlotOptions,
  run: () => Promise<void>,
): Promise<void> {
  const waitStartedAtMs = Date.now();
  let lease = acquireGateInvocationLease();
  if (lease === undefined) {
    if (options.runId !== undefined) {
      markHarnessGateSlotWait(options.runId, options.gate);
    }
    try {
      lease = await awaitGateInvocationLease({
        ...(options.signal !== undefined ? { signal: options.signal } : {}),
        timeoutMs: options.slotWaitTimeoutMs,
      });
    } finally {
      if (options.runId !== undefined) {
        clearHarnessGateSlotWait(options.runId);
      }
    }
    options.onSlotWait?.({ gate: options.gate, waitedMs: Date.now() - waitStartedAtMs });
  }
  leasedHarnessFullSuiteGateSpawns += 1;
  try {
    await run();
  } finally {
    leasedHarnessFullSuiteGateSpawns -= 1;
    lease.release();
  }
}
