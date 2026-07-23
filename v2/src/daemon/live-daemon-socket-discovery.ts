import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { connectIpcClient, type IpcClient } from "../ipc/client.ts";
import { createRpcTransport } from "../ipc/rpc-transport.ts";
import { jarvisHome } from "../paths.ts";

/** Prober: injectable connect function for testing. */
export type SocketProber = (socketPath: string, timeoutMs: number) => Promise<boolean>;

/** Default prober: attempts health RPC, returns true if successful. */
export async function defaultSocketProber(socketPath: string, probeTimeoutMs: number): Promise<boolean> {
  let client: IpcClient | undefined;
  try {
    client = await connectIpcClient(socketPath, probeTimeoutMs);
    const transport = createRpcTransport(client);
    await transport.request("health", undefined, { timeoutMs: probeTimeoutMs });
    return true;
  } catch {
    return false;
  } finally {
    client?.close();
  }
}

/**
 * Discover live daemon sockets under a jarvis home directory.
 *
 * Enumerates files matching `daemon-<key>.sock` (where key is 16 hex chars),
 * probes each for liveness (health RPC succeeds within timeout), and returns
 * paths of live sockets in lexicographic order.
 *
 * A missing or unreadable home directory returns an empty array instead of throwing.
 */
export async function discoverLiveDaemonSockets(
  home: string = jarvisHome(),
  prober: SocketProber = defaultSocketProber,
  probeTimeoutMs: number = 2000,
): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(home);
  } catch {
    // Missing/unreadable home directory: return empty result.
    return [];
  }

  const socketPattern = /^daemon-[0-9a-f]{16}\.sock$/;
  const candidatePaths = entries.filter((entry) => socketPattern.test(entry)).map((entry) => join(home, entry));

  const liveSockets: string[] = [];
  for (const socketPath of candidatePaths) {
    const isLive = await prober(socketPath, probeTimeoutMs);
    if (isLive) {
      liveSockets.push(socketPath);
    }
  }

  // Sort lexicographically for deterministic results.
  liveSockets.sort();
  return liveSockets;
}
