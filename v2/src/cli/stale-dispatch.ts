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

/** Dispatches work once, bouncing a stale idle daemon at most once. */
export async function withAutoBounceDispatch(
  io: Io,
  deps: CliDeps,
  autoBounce: boolean,
  dispatch: (client: IpcClient) => Promise<number>,
): Promise<number> {
  let client: IpcClient | undefined;
  try {
    client = await deps.connectIpcClient(deps.socketPath);
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
    if (error instanceof RpcError) io.stderr(formatRpcError(error));
    else if (error instanceof Error && error.message.startsWith("malformed RPC")) io.stderr(`${error.message}\n`);
    else if (error instanceof Error && error.message === "invalid daemon response") io.stderr(`${error.message}\n`);
    else if (error instanceof Error && error.message.includes("recovery did not")) io.stderr(`${error.message}\n`);
    else if (client === undefined) io.stderr(formatLifecycleError(error));
    else io.stderr(formatConnectionError(error));
    return 1;
  } finally {
    client?.close();
  }
}
