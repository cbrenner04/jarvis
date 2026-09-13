import { connectIpcClient, type IpcClient } from "../ipc/client.ts";
import { createRpcTransport } from "../ipc/rpc-transport.ts";
import { parseChangeoverResult } from "./daemon-wire.ts";

/** Outcome of asking a live public-address peer to hand off. */
type ChangeoverRequestOutcome =
  | { kind: "changeover"; privateSocketPath: string; handoffId: string }
  | { kind: "handoff-failed" };

export type RequestChangeover = (
  socketPath: string,
  options?: { timeoutMs?: number },
) => Promise<ChangeoverRequestOutcome>;

const DEFAULT_CHANGEOVER_TIMEOUT_MS = 2_000;
/** Successor startup budget, shared by `startDaemon` and the incumbent's fallback deadline. */
export const DEFAULT_CHANGEOVER_RELEASE_TIMEOUT_MS = 5_000;
export const DEFAULT_DAEMON_READINESS_TIMEOUT_MS = 5_000;
export const HANDOFF_RESOLUTION_TIMEOUT_MS = 2_000;

/**
 * Default incumbent fallback deadline: beyond the successor's worst-case budget after the accepted
 * reply (release wait + readiness wait + settlement RPC) plus slack, so the fallback never rolls back
 * a successor still inside its own startup bound.
 */
export const DEFAULT_HANDOFF_FALLBACK_MS =
  DEFAULT_CHANGEOVER_RELEASE_TIMEOUT_MS + DEFAULT_DAEMON_READINESS_TIMEOUT_MS + HANDOFF_RESOLUTION_TIMEOUT_MS + 1_000;

/**
 * Requests changeover from whatever is answering `socketPath`. Called only after the caller has
 * already confirmed a peer is live there (a `health` RPC succeeded), so any failure here — connect
 * error, timeout, or an error reply — fails closed as `handoff-failed` rather than being
 * reinterpreted as "no peer after all": a peer was just proven live, and something now prevents a
 * safe handoff. Connect failure gets no special "no peer" carve-out; it fails closed the same as a
 * timeout or RPC error.
 */
export async function requestChangeoverFromPublicPeer(
  socketPath: string,
  options?: { timeoutMs?: number; connect?: typeof connectIpcClient },
): Promise<ChangeoverRequestOutcome> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_CHANGEOVER_TIMEOUT_MS;
  const connect = options?.connect ?? connectIpcClient;
  let client: IpcClient | undefined;
  try {
    client = await connect(socketPath);
    const transport = createRpcTransport(client);
    try {
      const response = await transport.request("changeover", undefined, { timeoutMs });
      const parsed = parseChangeoverResult(response);
      if (parsed === undefined) return { kind: "handoff-failed" };
      return { kind: "changeover", privateSocketPath: parsed.privateSocketPath, handoffId: parsed.handoffId };
    } finally {
      transport.close();
    }
  } catch {
    return { kind: "handoff-failed" };
  } finally {
    client?.close();
  }
}
