import { readdirSync } from "node:fs";
import { join } from "node:path";
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
export async function supersedePeerDaemon(socketPath: string, handoffId?: string): Promise<void> {
  let client: IpcClient | undefined;
  try {
    client = await connectIpcClient(socketPath);
    const transport = createRpcTransport(client);
    await transport.request("supersede", handoffId === undefined ? undefined : { handoffId }, { timeoutMs: 1_000 });
  } catch {
    // Ignore all errors: unreachable socket, RPC failure, timeout, etc.
  } finally {
    client?.close();
  }
}

export type EnumerateOtherDaemonSockets = typeof enumerateOtherDaemonSockets;
export type SupersedePeerDaemon = typeof supersedePeerDaemon;
