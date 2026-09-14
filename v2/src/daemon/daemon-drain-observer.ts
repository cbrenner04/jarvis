import { connectIpcClient } from "../ipc/client.ts";
import { RpcError } from "../ipc/rpc-errors.ts";
import { createRpcTransport } from "../ipc/rpc-transport.ts";
import { probeSocketLiveness, type SocketLiveness } from "../ipc/server.ts";
import { type DaemonListRunRow, parseListRuns } from "./daemon-wire.ts";

/**
 * A liveness verdict that means the predecessor's private endpoint is gone — nothing is
 * listening at that path anymore, so drain observation ends. `live` (a peer accepted, or the
 * probe merely timed out under load) never ends observation: a busy predecessor is still
 * draining, not gone.
 */
export function drainObservationEndsOnLiveness(liveness: SocketLiveness): boolean {
  return liveness === "absent" || liveness === "stale";
}

export type DrainObserver = {
  /** Run ids the predecessor reported live as of the most recent successful poll; empty once drained. */
  liveRunIds(): ReadonlySet<string>;
  /** Stops polling. Idempotent. */
  stop(): void;
};

/** Union of live run ids across every observed predecessor, real or legacy keyed-socket. */
export function unionLiveRunIds(observers: readonly Pick<DrainObserver, "liveRunIds">[]): ReadonlySet<string> {
  const union = new Set<string>();
  for (const observer of observers) {
    for (const runId of observer.liveRunIds()) union.add(runId);
  }
  return union;
}

async function defaultListLiveRunIds(socketPath: string, timeoutMs: number): Promise<readonly string[]> {
  const client = await connectIpcClient(socketPath);
  const transport = createRpcTransport(client);
  try {
    // `live_run_ids` reads no store; `list` (full projection) is the fallback for a legacy peer without it.
    try {
      const reply = (await transport.request("live_run_ids", undefined, { timeoutMs })) as { runIds?: unknown } | null;
      const runIds = reply?.runIds;
      if (!Array.isArray(runIds) || !runIds.every((id) => typeof id === "string")) {
        throw new Error("malformed live_run_ids response");
      }
      return runIds;
    } catch (error) {
      if (!(error instanceof RpcError && error.code === "unknown_method")) throw error;
    }
    const listed = parseListRuns(await transport.request("list", undefined, { timeoutMs }));
    if (listed === undefined) throw new Error("malformed list response");
    return listed.runs.filter((row) => row.isLive).map((row) => row.runId);
  } finally {
    transport.close();
  }
}

/** Cancels a scheduled poll loop. */
type PollLoopHandle = { clear(): void };

/**
 * Starts the poll loop: runs `onTick` once immediately, then every `intervalMs`. Injectable so a
 * test can drive ticks itself and await each one, instead of racing a real timer.
 */
export type SchedulePollLoop = (onTick: () => Promise<void>, intervalMs: number) => PollLoopHandle;

function scheduleRealPollLoop(onTick: () => Promise<void>, intervalMs: number): PollLoopHandle {
  void onTick();
  const timer = setInterval(() => {
    void onTick();
  }, intervalMs);
  timer.unref();
  return { clear: () => clearInterval(timer) };
}

type DrainObserverDeps = {
  probeLiveness?: (socketPath: string) => Promise<SocketLiveness>;
  listLiveRunIds?: (socketPath: string, timeoutMs: number) => Promise<readonly string[]>;
  pollIntervalMs?: number;
  rpcTimeoutMs?: number;
  schedulePollLoop?: SchedulePollLoop;
};

/**
 * Polls a predecessor generation's private endpoint for its live run set, so the successor can
 * keep reporting those runs as live until the predecessor drains. A liveness probe (cheap, short
 * timeout) gates each tick: `absent`/`stale` means the predecessor's process has actually exited,
 * so observation ends there and the live set clears. A `list` RPC failure while the socket itself
 * still reads `live` — a timeout under load, a malformed reply — is a stall, not a drain: the
 * last known live set is retained and the next tick retries. This is advisory throughout; it
 * never throws out of the polling loop and never fails the caller.
 */
export function observePredecessorDrain(socketPath: string, deps: DrainObserverDeps = {}): DrainObserver {
  const probeLiveness = deps.probeLiveness ?? probeSocketLiveness;
  const listLiveRunIds = deps.listLiveRunIds ?? defaultListLiveRunIds;
  const pollIntervalMs = deps.pollIntervalMs ?? 500;
  const rpcTimeoutMs = deps.rpcTimeoutMs ?? 1_000;

  let live = new Set<string>();
  let stopped = false;
  let loop: PollLoopHandle | undefined;

  const tick = async (): Promise<void> => {
    if (stopped) return;
    const liveness = await probeLiveness(socketPath);
    if (stopped) return;
    if (drainObservationEndsOnLiveness(liveness)) {
      live = new Set();
      stopped = true;
      loop?.clear();
      return;
    }
    try {
      const ids = await listLiveRunIds(socketPath, rpcTimeoutMs);
      if (!stopped) live = new Set(ids);
    } catch {
      // Transient RPC failure while the socket itself is still live: retain the last known set.
    }
  };

  loop = (deps.schedulePollLoop ?? scheduleRealPollLoop)(tick, pollIntervalMs);
  // A drain observed during the very first tick clears the loop before `loop` was assigned, so
  // honour that here rather than leaving a real timer running behind a `stopped` observer.
  if (stopped) loop.clear();

  return {
    liveRunIds: () => live,
    stop: () => {
      stopped = true;
      loop?.clear();
    },
  };
}

type RunOwnershipDirectory = {
  /** The direct predecessor's cached row for `runId`, or `undefined` while it is not reported live. */
  ownerRow(runId: string): DaemonListRunRow | undefined;
  /** Resolves an absent row through an authoritative refresh; rejects when that refresh fails. */
  resolveOwner(runId: string): Promise<boolean>;
  /** Stops polling. Idempotent. */
  stop(): void;
};

async function defaultListOwnedRuns(socketPath: string, timeoutMs: number): Promise<readonly DaemonListRunRow[]> {
  const client = await connectIpcClient(socketPath);
  const transport = createRpcTransport(client);
  try {
    const listed = parseListRuns(await transport.request("list_owned", undefined, { timeoutMs }));
    if (listed === undefined) throw new Error("malformed list_owned response");
    return listed.runs;
  } finally {
    transport.close();
  }
}

type RunOwnershipDirectoryDeps = {
  probeLiveness?: (socketPath: string) => Promise<SocketLiveness>;
  listOwnedRuns?: (socketPath: string, timeoutMs: number) => Promise<readonly DaemonListRunRow[]>;
  pollIntervalMs?: number;
  rpcTimeoutMs?: number;
  schedulePollLoop?: SchedulePollLoop;
};

/**
 * Polls the direct handoff predecessor's private `list_owned` endpoint (never a legacy
 * digest-keyed peer — those stay on the advisory `unionLiveRunIds` path) for its owner-local run
 * rows, so a caller can substitute the predecessor's authoritative row for a run it still owns.
 * Unlike `observePredecessorDrain`'s advisory live-id set, any poll failure — a `list_owned` RPC
 * error, or a liveness probe reading `absent`/`stale` — clears every cached row rather than
 * retaining the last snapshot: a stale owner row must never be served once the owner has stopped
 * confirming it. `predecessorSocketPath === undefined` (no real handoff predecessor) returns a
 * directory that never holds any row and never polls.
 */
export function observeRunOwnership(
  predecessorSocketPath: string | undefined,
  deps: RunOwnershipDirectoryDeps = {},
): RunOwnershipDirectory {
  if (predecessorSocketPath === undefined) {
    return { ownerRow: () => undefined, resolveOwner: async () => false, stop: () => undefined };
  }

  const probeLiveness = deps.probeLiveness ?? probeSocketLiveness;
  const listOwnedRuns = deps.listOwnedRuns ?? defaultListOwnedRuns;
  const pollIntervalMs = deps.pollIntervalMs ?? 500;
  const rpcTimeoutMs = deps.rpcTimeoutMs ?? 1_000;

  let rowsByRunId = new Map<string, DaemonListRunRow>();
  let snapshotAuthoritative = false;
  let stopped = false;
  let loop: PollLoopHandle | undefined;
  // Ticks may overlap (a slow reply outlives the interval); a tick's outcome applies only if no
  // later-started tick has already applied one, so a stale reply never resurrects a cleared row.
  let startedTicks = 0;
  let appliedTick = 0;
  const applies = (tickNumber: number): boolean => {
    if (stopped || tickNumber < appliedTick) return false;
    appliedTick = tickNumber;
    return true;
  };

  const refreshOwnership = async (): Promise<boolean> => {
    if (stopped) return false;
    startedTicks += 1;
    const tickNumber = startedTicks;
    const liveness = await probeLiveness(predecessorSocketPath);
    if (!applies(tickNumber)) return false;
    if (drainObservationEndsOnLiveness(liveness)) {
      rowsByRunId = new Map();
      snapshotAuthoritative = true;
      stopped = true;
      loop?.clear();
      return true;
    }
    try {
      const rows = await listOwnedRuns(predecessorSocketPath, rpcTimeoutMs);
      if (applies(tickNumber)) {
        rowsByRunId = new Map(rows.map((row) => [row.runId, row]));
        snapshotAuthoritative = true;
        return true;
      }
      return false;
    } catch (error) {
      // Stricter than `observePredecessorDrain`'s transient-failure retention: a poll failure here
      // clears every cached row rather than keeping a snapshot the owner is no longer confirming.
      if (applies(tickNumber)) {
        rowsByRunId = new Map();
        snapshotAuthoritative = false;
      }
      throw error;
    }
  };

  const tick = async (): Promise<void> => {
    try {
      await refreshOwnership();
    } catch {
      // Poll failures clear the snapshot and are retried on the next tick or routed request.
    }
  };

  loop = (deps.schedulePollLoop ?? scheduleRealPollLoop)(tick, pollIntervalMs);
  // A drain observed during the very first tick clears the loop before `loop` was assigned, so
  // honour that here rather than leaving a real timer running behind a `stopped` directory.
  if (stopped) loop.clear();

  return {
    ownerRow: (runId) => rowsByRunId.get(runId),
    resolveOwner: async (runId) => {
      if (rowsByRunId.has(runId)) return true;
      if (snapshotAuthoritative) return false;
      if (stopped) return false;
      const applied = await refreshOwnership();
      if (!applied && !snapshotAuthoritative) throw new Error("ownership refresh was superseded before resolution");
      return rowsByRunId.has(runId);
    },
    stop: () => {
      stopped = true;
      loop?.clear();
    },
  };
}
