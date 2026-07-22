import { DaemonAlreadyRunningError } from "../daemon/daemon-lifecycle.ts";
import type { IpcClient } from "../ipc/client.ts";
import { RpcError } from "../ipc/rpc-errors.ts";
import type { CliDeps } from "./deps.ts";
import type { Io } from "./io.ts";
import { formatConnectionError, formatLifecycleError, formatRpcError } from "./ipc.ts";

/** Starts the invoking executable's daemon or reuses the concurrent winner before dispatch. */
export async function withMatchingDaemonDispatch(
  io: Io,
  deps: CliDeps,
  dispatch: (client: IpcClient) => Promise<number>,
): Promise<number> {
  let client: IpcClient | undefined;
  try {
    try {
      await deps.startDaemon(deps.socketPath, { pidPath: deps.pidPath, logPath: deps.logPath });
    } catch (startError) {
      if (!(startError instanceof DaemonAlreadyRunningError)) throw startError;
    }
    client = await deps.connectIpcClient(deps.socketPath);
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
