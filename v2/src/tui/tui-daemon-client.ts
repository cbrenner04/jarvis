import type { WaitRunCompletionResult } from "../daemon/daemon.ts";
import {
  type DaemonListResult,
  parseHealthResult,
  parseListRuns,
  parseStartResult,
  parseStatusResult,
  parseWaitCompletion,
} from "../daemon/daemon-wire.ts";
import type { WriteLoopInput } from "../execution/write-loop.ts";
import { connectIpcClient, type IpcClient } from "../ipc/client.ts";
import { RpcConnectionError } from "../ipc/rpc-errors.ts";
import { createRpcTransport } from "../ipc/rpc-transport.ts";
import { DAEMON_SOCKET_PATH } from "../paths.ts";

/** Successful `health` RPC payload from the daemon host. */
type TuiDaemonHealthResult = { ok: true };

/** Successful IPC `status` RPC payload when the daemon host is live. */
type TuiDaemonStatusResult = { state: "running" };

/** Successful IPC `start` RPC payload with the spawned run id. */
type TuiDaemonStartResult = { runId: string };

/**
 * Connected TUI daemon client over one IPC transport: liveness, run list, launch, steering,
 * wait, and close.
 * RPC methods throw {@link RpcConnectionError} on transport or wire failure and
 * {@link RpcError} on correlated daemon `error` frames.
 */
export type TuiDaemonClient = {
  health(): Promise<TuiDaemonHealthResult>;
  status(): Promise<TuiDaemonStatusResult>;
  list(): Promise<DaemonListResult>;
  start(input: WriteLoopInput): Promise<TuiDaemonStartResult>;
  /** Signal graceful pause for an active run at the next iteration boundary; rejects with `unknown_run`/`run_not_active`. */
  pause(runId: string): Promise<TuiDaemonHealthResult>;
  /**
   * Resume a paused or killed run under daemon start guards, or resolve an
   * `awaiting-human` run via `decision`/`prompt`; rejects with `unknown_run`, `terminal_run`,
   * `run_in_progress`, `worktree_claimed`, …
   */
  resume(
    runId: string,
    options?: { decision?: "approve" | "abort" | "revise"; prompt?: string },
  ): Promise<TuiDaemonHealthResult>;
  /** Abort an active run immediately and record durable status `killed`; rejects with `unknown_run`/`run_not_active`. */
  kill(runId: string): Promise<TuiDaemonHealthResult>;
  wait(runId: string): Promise<WaitRunCompletionResult>;
  close(): void;
};

/** Options for {@link connectTuiDaemon}; production defaults apply when omitted. */
export type ConnectTuiDaemonOptions = {
  /** Unix socket path; defaults to `~/.jarvis/daemon.sock`. */
  socketPath?: string;
  /** Injectable IPC transport seam for tests and callers. */
  connectIpcClient?: (socketPath: string) => Promise<IpcClient>;
};

function parseOrThrow<T>(parsed: T | undefined, message: string): T {
  if (!parsed) throw new RpcConnectionError(message);
  return parsed;
}

/**
 * Open a TUI daemon client on the production or injected socket.
 *
 * @param options Optional socket path and `connectIpcClient` seam.
 * @returns A client exposing `health`, `status`, `list`, `start`, `pause`, `resume`, `kill`, `wait`, and `close` on one connection.
 * @throws {RpcConnectionError} When the socket is unreachable or RPC wire protocol fails.
 */
export async function connectTuiDaemon(options?: ConnectTuiDaemonOptions): Promise<TuiDaemonClient> {
  const socketPath = options?.socketPath ?? DAEMON_SOCKET_PATH;
  const connectFn = options?.connectIpcClient ?? connectIpcClient;

  let client: IpcClient;
  try {
    client = await connectFn(socketPath);
  } catch (cause) {
    throw new RpcConnectionError(`cannot connect to daemon socket ${socketPath}`, { cause });
  }

  const transport = createRpcTransport(client);

  const okRunRpc = async (method: "pause" | "kill", runId: string): Promise<TuiDaemonHealthResult> =>
    parseOrThrow(
      parseHealthResult(await transport.request(method, { runId })),
      `malformed RPC reply: invalid ${method} result`,
    );

  return {
    async health() {
      return parseOrThrow(
        parseHealthResult(await transport.request("health")),
        "malformed RPC reply: invalid health result",
      );
    },
    async status() {
      return parseOrThrow(
        parseStatusResult(await transport.request("status")),
        "malformed RPC reply: invalid status result",
      );
    },
    async list() {
      return parseListRuns(await transport.request("list")) as DaemonListResult;
    },
    async start(input) {
      return parseOrThrow(
        parseStartResult(await transport.request("start", { input })),
        "malformed RPC reply: invalid start result",
      );
    },
    pause: (runId) => okRunRpc("pause", runId),
    async resume(runId, options) {
      return parseOrThrow(
        parseHealthResult(await transport.request("resume", { runId, ...options })),
        "malformed RPC reply: invalid resume result",
      );
    },
    kill: (runId) => okRunRpc("kill", runId),
    async wait(runId) {
      return parseWaitCompletion(
        await transport.request("wait", { runId }, { trackWait: true }),
      ) as WaitRunCompletionResult;
    },
    close() {
      transport.close();
    },
  };
}
