import { connectIpcClient } from "../ipc/client.ts";
import { createRpcTransport } from "../ipc/rpc-transport.ts";
import { probeSocketLiveness, type SocketLiveness } from "../ipc/server.ts";
import { parseListRuns } from "./daemon-wire.ts";

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
