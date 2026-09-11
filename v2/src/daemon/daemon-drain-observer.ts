import { connectIpcClient } from "../ipc/client.ts";
import { createRpcTransport } from "../ipc/rpc-transport.ts";
import { parseListRuns } from "./daemon-wire.ts";

export const DRAIN_OBSERVATION_INTERVAL_MS = 500;

export type DrainObservation = {
  /** Run ids the outgoing generation currently reports live; empty once observation has ended. */
  liveRunIds: () => ReadonlySet<string>;
  /** Stops polling. Idempotent. */
  stop: () => void;
};

/** Whether a poll failure should end observation rather than retry. Always true: the private
 * endpoint is successor-only, so any failure to reach it (RPC error, timeout, socket gone) means
 * the outgoing generation is unreachable or has already exited — a drained predecessor is the
 * normal case, not an error, and retrying against a socket that is gone would just repeat it. */
export function drainObservationEndsOnPollFailure(pollFailed: boolean): boolean {
  return pollFailed;
}

/**
 * Polls the outgoing generation's private endpoint over its existing `list` RPC so the incoming
 * generation can report runs it still holds as live. Advisory: a private endpoint that stops
 * answering (predecessor already exited) ends observation silently rather than failing the
 * incoming generation.
 */
export function startDrainObservation(
  privateSocketPath: string,
  deps: { connectIpcClient?: typeof connectIpcClient; intervalMs?: number; timeoutMs?: number } = {},
): DrainObservation {
  const connect = deps.connectIpcClient ?? connectIpcClient;
  const intervalMs = deps.intervalMs ?? DRAIN_OBSERVATION_INTERVAL_MS;
  const timeoutMs = deps.timeoutMs ?? 1_000;
  let liveRunIds: ReadonlySet<string> = new Set();
  let stopped = false;

  const poll = async (): Promise<void> => {
    if (stopped) return;
    let pollFailed = false;
    try {
      const client = await connect(privateSocketPath);
      const transport = createRpcTransport(client);
      try {
        const listed = parseListRuns(await transport.request("list", undefined, { timeoutMs }));
        if (listed === undefined) {
          pollFailed = true;
        } else {
          liveRunIds = new Set(listed.runs.filter((row) => row.isLive).map((row) => row.runId));
        }
      } finally {
        transport.close();
      }
    } catch {
      pollFailed = true;
    }
    if (drainObservationEndsOnPollFailure(pollFailed)) {
      stopped = true;
      liveRunIds = new Set();
      clearInterval(timer);
    }
  };

  const timer = setInterval(() => {
    void poll();
  }, intervalMs);
  timer.unref();
  void poll();

  return {
    liveRunIds: () => liveRunIds,
    stop: () => {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
    },
  };
}
