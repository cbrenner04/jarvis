import { readdirSync } from "node:fs";
import { join } from "node:path";
import { isRecord } from "../../../shared/is-record.ts";
import { connectIpcClient, type IpcClient } from "../ipc/client.ts";
import { createRpcTransport } from "../ipc/rpc-transport.ts";

export function enumerateOtherDaemonSockets(jarvisHomeDir: string, ownSocketPath: string): string[] {
  try {
    const entries = readdirSync(jarvisHomeDir);
    return entries
      .filter((entry) => entry.match(/^daemon-[a-f0-9]{16}\.sock$/))
      .map((entry) => join(jarvisHomeDir, entry))
      .filter((path) => path !== ownSocketPath);
  } catch {
    return [];
  }
}

/** Errors ignored (unreachable socket, RPC failure, timeout, etc.). */
export async function supersedePeerDaemon(socketPath: string): Promise<void> {
  let client: IpcClient | undefined;
  try {
    client = await connectIpcClient(socketPath);
    const transport = createRpcTransport(client);
    await transport.request("supersede", undefined, { timeoutMs: 1_000 });
  } catch {
    // Ignore all errors: unreachable socket, RPC failure, timeout, etc.
  } finally {
    client?.close();
  }
}

export type EnumerateOtherDaemonSockets = typeof enumerateOtherDaemonSockets;
export type SupersedePeerDaemon = typeof supersedePeerDaemon;

export type ChangeoverOutcome =
  | { kind: "no-peer" }
  | { kind: "handoff-complete"; privateSocketPath?: string }
  | { kind: "handoff-failed"; reason: string };

/**
 * Asks a live peer at the public address to hand off: it stops admitting new work, releases the
 * address, and reports its private successor-only endpoint in the reply. `no-peer` means nothing
 * answered at `socketPath` (a fresh start, not a replacement); `handoff-failed` means a peer is
 * there but did not complete the exchange, so the caller must abort startup rather than bind over
 * it — a peer that never replies must never be treated as free to steal from.
 */
export async function requestChangeoverFromPublicPeer(
  socketPath: string,
  timeoutMs = 2_000,
): Promise<ChangeoverOutcome> {
  let client: IpcClient;
  try {
    client = await connectIpcClient(socketPath);
  } catch {
    return { kind: "no-peer" };
  }
  const transport = createRpcTransport(client);
  try {
    const response = await transport.request("changeover", undefined, { timeoutMs });
    const privateSocketPath =
      isRecord(response) && typeof response.privateSocketPath === "string" ? response.privateSocketPath : undefined;
    return { kind: "handoff-complete", ...(privateSocketPath !== undefined ? { privateSocketPath } : {}) };
  } catch (error) {
    return { kind: "handoff-failed", reason: error instanceof Error ? error.message : String(error) };
  } finally {
    transport.close();
  }
}

export type RequestChangeoverFromPublicPeer = typeof requestChangeoverFromPublicPeer;
