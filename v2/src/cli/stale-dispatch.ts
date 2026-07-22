import { DaemonAlreadyRunningError } from "../daemon/daemon-lifecycle.ts";
import type { IpcClient } from "../ipc/client.ts";
import { RpcError } from "../ipc/rpc-errors.ts";
import type { CliDeps } from "./deps.ts";
import type { Io } from "./io.ts";
import { formatConnectionError, formatLifecycleError, formatRpcError } from "./ipc.ts";

const CONNECT_DEADLINE_MS = 5000;
const CONNECT_RETRY_INTERVAL_MS = 50;

/** Connects to the keyed daemon, starting it when nothing is listening. A start that loses the race
 * (`DaemonAlreadyRunningError`) is treated as "the winner is up"; every other `startDaemon` error is
 * re-thrown unchanged. The post-start connect retries against injected `now`/`sleep` until its deadline. */
export async function connectWithAutoStart(deps: CliDeps, socketPath: string): Promise<IpcClient> {
  const now = deps.now ?? (() => Date.now());
  const sleep = deps.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  let lastError: unknown;
  try {
    return await deps.connectIpcClient(socketPath);
  } catch (error) {
    lastError = error;
  }

  try {
    await deps.startDaemon(socketPath, { pidPath: deps.pidPath, logPath: deps.logPath });
  } catch (error) {
    if (!(error instanceof DaemonAlreadyRunningError)) throw error;
    lastError = error;
  }

  const deadline = now() + CONNECT_DEADLINE_MS;
  for (;;) {
    try {
      return await deps.connectIpcClient(socketPath);
    } catch (error) {
      lastError = error;
    }
    if (now() >= deadline) break;
    await sleep(CONNECT_RETRY_INTERVAL_MS);
  }
  throw new Error(
    `Failed to connect to daemon on socket ${socketPath} after starting it (${CONNECT_DEADLINE_MS}ms deadline exceeded)`,
    { cause: lastError },
  );
}

/** Routes a dispatch failure to stderr: daemon-reported errors verbatim, everything else as a
 * connection error once a client existed, or a lifecycle error when the connect itself never landed. */
function reportDispatchError(io: Io, error: unknown, connected: boolean): void {
  if (error instanceof RpcError) {
    io.stderr(formatRpcError(error));
    return;
  }
  const message = error instanceof Error ? error.message : "";
  if (message.startsWith("malformed RPC") || message.includes("Failed to connect to daemon on socket")) {
    io.stderr(`${message}\n`);
    return;
  }
  io.stderr(connected ? formatConnectionError(error) : formatLifecycleError(error));
}

/** Connects to the keyed daemon and dispatches work. Auto-starts the daemon if absent. */
export async function withConnectDispatch(
  io: Io,
  deps: CliDeps,
  dispatch: (client: IpcClient) => Promise<number>,
): Promise<number> {
  let client: IpcClient | undefined;
  try {
    client = await connectWithAutoStart(deps, deps.socketPath);
    return await dispatch(client);
  } catch (error) {
    reportDispatchError(io, error, client !== undefined);
    return 1;
  } finally {
    client?.close();
  }
}
