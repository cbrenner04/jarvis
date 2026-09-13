import { connectIpcClient } from "../ipc/client.ts";
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
  /** Owner-authoritative rows from the most recent confirmed route snapshot. */
  runRoutes?(): readonly ObservedRunRoute[];
  /** Run ids the predecessor reported live as of the most recent successful poll; empty once drained. */
  liveRunIds(): ReadonlySet<string>;
  /** Stops polling. Idempotent. */
  stop(): void;
  /**
   * Resolves once the first tick establishes an authoritative route snapshot — a successful `list`, or
   * the predecessor's socket reading `absent`/`stale` (nothing to observe). Never rejects; a
   * repeatedly-transient predecessor simply leaves it pending, which a bounded caller (see
   * `daemon-handoff-route-readiness.ts`) races against its own deadline. Optional so a
   * `DrainObserver`-shaped test double need not implement it.
   */
  firstSettlement?: Promise<void>;
};

export type ObservedRunRoute = {
  runId: string;
  isLive: boolean;
  /** Present for real owner snapshots; omitted only by the legacy live-id test seam. */
  row?: DaemonListRunRow;
};

/** Compatibility projection for callers that only need public liveness. */
export function unionLiveRunIds(observers: readonly Pick<DrainObserver, "liveRunIds">[]): ReadonlySet<string> {
  const union = new Set<string>();
  for (const observer of observers) {
    for (const runId of observer.liveRunIds()) union.add(runId);
  }
  return union;
}

async function defaultListRunRows(socketPath: string, timeoutMs: number): Promise<readonly DaemonListRunRow[]> {
  const client = await connectIpcClient(socketPath);
  const transport = createRpcTransport(client);
  try {
    const listed = parseListRuns(
      await transport.request(
        "list",
        { sinceMs: 0, limit: Number.MAX_SAFE_INTEGER, includeDismissed: true },
        { timeoutMs },
      ),
    );
    if (listed === undefined) throw new Error("malformed list response");
    return listed.runs;
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
  listRunRows?: (socketPath: string, timeoutMs: number) => Promise<readonly DaemonListRunRow[]>;
  /** Compatibility seam for existing unit tests; production always observes full rows. */
  listLiveRunIds?: (socketPath: string, timeoutMs: number) => Promise<readonly string[]>;
  pollIntervalMs?: number;
  rpcTimeoutMs?: number;
  schedulePollLoop?: SchedulePollLoop;
};

/**
 * Polls a predecessor generation's private endpoint for owner-authoritative run rows, so the
 * successor can compose them without rebuilding owner fields. A liveness probe (cheap, short
 * timeout) gates each tick: `absent`/`stale` means the predecessor's process has actually exited,
 * so observation ends there and the route snapshot clears. A `list` RPC failure while the socket itself
 * still reads `live` — a timeout under load, a malformed reply — is a stall, not a drain: the
 * last confirmed route snapshot is retained and the next tick retries. This is advisory throughout; it
 * never throws out of the polling loop and never fails the caller.
 */
export function observePredecessorDrain(socketPath: string, deps: DrainObserverDeps = {}): DrainObserver {
  const probeLiveness = deps.probeLiveness ?? probeSocketLiveness;
  const listRunRows = deps.listRunRows ?? (deps.listLiveRunIds === undefined ? defaultListRunRows : undefined);
  const pollIntervalMs = deps.pollIntervalMs ?? 500;
  const rpcTimeoutMs = deps.rpcTimeoutMs ?? 1_000;

  let routes: readonly ObservedRunRoute[] = [];
  let stopped = false;
  let loop: PollLoopHandle | undefined;
  let resolveFirstSettlement: (() => void) | undefined;
  const firstSettlement = new Promise<void>((resolve) => {
    resolveFirstSettlement = resolve;
  });
  let firstSettlementResolved = false;
  const markFirstSettlement = (): void => {
    if (firstSettlementResolved) return;
    firstSettlementResolved = true;
    resolveFirstSettlement?.();
  };

  const tick = async (): Promise<void> => {
    if (stopped) return;
    const liveness = await probeLiveness(socketPath);
    if (stopped) return;
    if (drainObservationEndsOnLiveness(liveness)) {
      routes = [];
      stopped = true;
      loop?.clear();
      markFirstSettlement();
      return;
    }
    try {
      const nextRoutes =
        listRunRows === undefined
          ? ((await deps.listLiveRunIds?.(socketPath, rpcTimeoutMs))?.map((runId) => ({ runId, isLive: true })) ?? [])
          : (await listRunRows(socketPath, rpcTimeoutMs)).map((row) => ({ runId: row.runId, isLive: row.isLive, row }));
      if (!stopped) {
        routes = nextRoutes;
        markFirstSettlement();
      }
    } catch {
      // Transient RPC failure while the socket itself is still live: retain the last known set.
    }
  };

  loop = (deps.schedulePollLoop ?? scheduleRealPollLoop)(tick, pollIntervalMs);
  // A drain observed during the very first tick clears the loop before `loop` was assigned, so
  // honour that here rather than leaving a real timer running behind a `stopped` observer.
  if (stopped) loop.clear();

  return {
    runRoutes: () => routes,
    liveRunIds: () => new Set(routes.filter((route) => route.isLive).map((route) => route.runId)),
    stop: () => {
      stopped = true;
      loop?.clear();
    },
    firstSettlement,
  };
}
