import { DaemonAlreadyRunningError } from "../daemon/daemon-lifecycle.ts";
import { parseListRuns, parseStatusResult } from "../daemon/daemon-wire.ts";
import type { IpcClient } from "../ipc/client.ts";
import { RpcError } from "../ipc/rpc-errors.ts";
import type { CliDeps } from "./deps.ts";
import { guardWorkDispatch } from "./dispatch-revision.ts";
import type { Io } from "./io.ts";
import { formatConnectionError, formatLifecycleError, formatRpcError, request } from "./ipc.ts";

export function stripAutoBounceFlag(argv: readonly string[]): { argv: string[]; autoBounce: boolean } {
  return { argv: argv.filter((arg) => arg !== "--no-auto-bounce"), autoBounce: !argv.includes("--no-auto-bounce") };
}

async function waitForRecovery(client: IpcClient): Promise<{ reconciled: number; resumed: number }> {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const status = parseStatusResult(await request(client, "status"));
    if (status?.recovery === undefined) throw new Error("malformed RPC reply: invalid daemon recovery status");
    if (!status.recovery.pending) return status.recovery;
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("daemon startup recovery did not complete");
}

const CONNECT_DEADLINE_MS = 5000;
const CONNECT_RETRY_INTERVAL_MS = 50;

/** Connects to the keyed daemon, starting it when nothing is listening. A start that loses the race
 * (`DaemonAlreadyRunningError`) is treated as "the winner is up"; every other `startDaemon` error is
 * re-thrown unchanged. Whichever CLI started it, the daemon may not accept connections immediately,
 * so the post-start connect retries against injected `now`/`sleep` until its deadline. */
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
  if (
    message.startsWith("malformed RPC") ||
    message === "invalid daemon response" ||
    message.includes("recovery did not") ||
    message.includes("Failed to connect to daemon on socket")
  ) {
    io.stderr(`${message}\n`);
    return;
  }
  io.stderr(connected ? formatConnectionError(error) : formatLifecycleError(error));
}

/** Dispatches work once, bouncing a stale idle daemon at most once. Every mutating dispatch auto-starts
 * the keyed daemon when absent; `autoBounce` governs only the stale-daemon restart. */
export async function withAutoBounceDispatch(
  io: Io,
  deps: CliDeps,
  autoBounce: boolean,
  dispatch: (client: IpcClient) => Promise<number>,
): Promise<number> {
  let client: IpcClient | undefined;
  try {
    client = await connectWithAutoStart(deps, deps.socketPath);

    const mismatch = await guardWorkDispatch(client, deps.getCurrentRevision, deps.getExecutableDigest);
    if (mismatch === undefined) return await dispatch(client);
    if (!autoBounce) {
      io.stderr(mismatch);
      return 1;
    }
    const [loaded] = /loaded=([^ ]+)/.exec(mismatch)?.slice(1) ?? ["unknown"];
    const [current] = /current=([^;]+)/.exec(mismatch)?.slice(1) ?? ["unknown"];
    const list = parseListRuns(await request(client, "list"));
    if (list === undefined) throw new Error("invalid daemon response");
    const live = list.runs.filter((run) => run.isLive).map((run) => run.runId);
    if (live.length > 0) {
      io.stderr(
        `daemon revision mismatch: loaded=${loaded} current=${current}; cannot restart while live runs: ${live.join(", ")}\n`,
      );
      return 1;
    }
    client.close();
    client = undefined;
    await deps.stopDaemon(deps.socketPath, { pidPath: deps.pidPath, force: true });
    await deps.startDaemon(deps.socketPath, { pidPath: deps.pidPath, logPath: deps.logPath });
    client = await deps.connectIpcClient(deps.socketPath);
    const recovery = await waitForRecovery(client);
    io.stderr(
      `daemon revision mismatch: loaded=${loaded} current=${current}; restarted; recovery reconciled=${recovery.reconciled} resumed=${recovery.resumed}; retrying original dispatch\n`,
    );
    const secondMismatch = await guardWorkDispatch(client, deps.getCurrentRevision, deps.getExecutableDigest);
    if (secondMismatch !== undefined) {
      io.stderr(secondMismatch);
      return 1;
    }
    return await dispatch(client);
  } catch (error) {
    reportDispatchError(io, error, client !== undefined);
    return 1;
  } finally {
    client?.close();
  }
}
