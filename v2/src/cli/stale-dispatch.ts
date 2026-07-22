import { DaemonAlreadyRunningError } from "../daemon/daemon-lifecycle.ts";
import type { IpcClient } from "../ipc/client.ts";
import { RpcError } from "../ipc/rpc-errors.ts";
import type { CliDeps } from "./deps.ts";
import type { Io } from "./io.ts";
import { formatConnectionError, formatLifecycleError, formatRpcError } from "./ipc.ts";

/** Dispatches work through this executable's daemon, starting it when absent. */
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
        await deps.startDaemon(deps.socketPath, { pidPath: deps.pidPath, logPath: deps.logPath });
      } catch (error) {
        if (!(error instanceof DaemonAlreadyRunningError)) throw error;
        const deadline = Date.now() + 5_000;
        while (Date.now() < deadline) {
          try {
            client = await deps.connectIpcClient(deps.socketPath);
            break;
          } catch {
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
        }
      }
      client ??= await deps.connectIpcClient(deps.socketPath);
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
