import type { IpcClient } from "../ipc/client.ts";
import { RpcError } from "../ipc/rpc-errors.ts";
import type { CliDeps } from "./deps.ts";
import { DaemonAlreadyRunningError } from "../daemon/daemon-lifecycle.ts";
import type { Io } from "./io.ts";
import { formatConnectionError, formatLifecycleError, formatRpcError, request } from "./ipc.ts";

async function connectWhenReady(deps: CliDeps, timeoutMs = 5_000): Promise<IpcClient> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      return await deps.connectIpcClient(deps.socketPath);
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  throw lastError ?? new Error(`Daemon did not become ready: ${deps.socketPath}`);
}

/** Connect to the selected daemon, starting it on demand when absent. */
export async function withDaemonDispatch(
  io: Io,
  deps: CliDeps,
  dispatch: (client: IpcClient) => Promise<number>,
): Promise<number> {
  let client: IpcClient | undefined;
  try {
    try {
      client = await deps.connectIpcClient(deps.socketPath);
    } catch {
      try {
        await deps.startDaemon(deps.socketPath, {
          pidPath: deps.pidPath,
          logPath: deps.logPath,
          statePath: deps.statePath,
          logsPath: deps.logsPath,
        });
      } catch (error) {
        if (!(error instanceof DaemonAlreadyRunningError)) throw error;
      }
      client = await connectWhenReady(deps);
    }
    return await dispatch(client);
  } catch (error) {
    if (error instanceof RpcError) io.stderr(formatRpcError(error));
    else if (client === undefined) io.stderr(formatLifecycleError(error));
    else io.stderr(formatConnectionError(error));
    return 1;
  } finally {
    client?.close();
  }
}
