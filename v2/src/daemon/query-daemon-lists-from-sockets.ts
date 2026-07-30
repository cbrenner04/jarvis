import type { CliDeps } from "../cli/deps.ts";
import { request } from "../cli/ipc.ts";
import type { ListRpcParams } from "../commands/run-list-rpc.ts";
import type { IpcClient } from "../ipc/client.ts";
import { RpcError } from "../ipc/rpc-errors.ts";
import type { DaemonListResult } from "./daemon-wire.ts";
import { parseListRuns } from "./daemon-wire.ts";

export type QueryDaemonListsDeps = Pick<CliDeps, "connectIpcClient" | "socketPath" | "socketDiscovery">;

export async function resolveDaemonListSocketPaths(deps: QueryDaemonListsDeps): Promise<string[]> {
  const discovered = await (deps.socketDiscovery ?? (async () => []))();
  return [...new Set([...discovered, deps.socketPath])].sort();
}

export async function queryDaemonListsFromSocketPaths(
  connectIpcClient: (socketPath: string) => Promise<IpcClient>,
  socketPaths: readonly string[],
  listParams: ListRpcParams | undefined,
  options: { skipOnFailure?: boolean } = {},
): Promise<{ listResults: Array<[string, DaemonListResult | undefined]>; firstError: unknown }> {
  const skipOnFailure = options.skipOnFailure !== false;
  const listResults: Array<[string, DaemonListResult | undefined]> = [];
  let firstError: unknown;
  const fail = (socketPath: string, error: unknown) => {
    listResults.push([socketPath, undefined]);
    firstError ??= error;
  };

  for (const socketPath of socketPaths) {
    try {
      const client = await connectIpcClient(socketPath);
      try {
        let result: unknown;
        try {
          result = await request(client, "list", listParams);
        } catch (error) {
          if (error instanceof RpcError) {
            if (!skipOnFailure) throw error;
            fail(socketPath, error);
            continue;
          }
          throw error;
        }

        const list = parseListRuns(result);
        if (list === undefined) {
          const error = new Error("invalid daemon response");
          if (!skipOnFailure) throw error;
          fail(socketPath, error);
          continue;
        }

        listResults.push([socketPath, list]);
      } finally {
        client.close();
      }
    } catch (error) {
      if (!skipOnFailure) throw error;
      fail(socketPath, error);
    }
  }

  return { listResults, firstError };
}

export async function queryDaemonListsFromSockets(
  deps: QueryDaemonListsDeps,
  listParams: ListRpcParams | undefined,
  options: { skipOnFailure?: boolean } = {},
): Promise<{ listResults: Array<[string, DaemonListResult | undefined]>; firstError: unknown }> {
  const socketPaths = await resolveDaemonListSocketPaths(deps);
  return queryDaemonListsFromSocketPaths(deps.connectIpcClient, socketPaths, listParams, options);
}
