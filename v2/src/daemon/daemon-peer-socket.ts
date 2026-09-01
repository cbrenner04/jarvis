import { readdirSync } from "node:fs";
import { join } from "node:path";
import { connectIpcClient } from "../ipc/client.ts";
import { createRpcTransport } from "../ipc/rpc-transport.ts";

export type EnumerateOtherDaemonSockets = (jarvisHomeDir: string, ownSocketPath: string) => string[];

export type SupersedePeerDaemon = (socketPath: string) => Promise<void>;

/**
 * Default implementation: enumerate `daemon-*.sock` files in jarvisHome,
 * excluding the daemon's own socket path.
 */
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

/**
 * Default implementation: connect to a peer daemon socket and send `supersede`.
 * Errors are ignored (socket unreachable, RPC error, etc.).
 */
export async function supersedePeerDaemon(socketPath: string): Promise<void> {
  try {
    const client = await connectIpcClient(socketPath);
    const transport = createRpcTransport(client);
    try {
      await transport.request("supersede", undefined, { timeoutMs: 1_000 });
    } finally {
      transport.close();
    }
  } catch {
    // Ignore all errors: unreachable socket, RPC failure, timeout, etc.
  }
}
