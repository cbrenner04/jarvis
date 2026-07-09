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
import { DAEMON_SOCKET_PATH } from "../paths.ts";
import { TuiDaemonConnectionError } from "./tui-daemon-errors.ts";
import { createTuiDaemonRpcTransport } from "./tui-daemon-rpc-transport.ts";

/** Successful `health` RPC payload from the daemon host. */
type TuiDaemonHealthResult = { ok: true };

/** Successful IPC `status` RPC payload when the daemon host is live. */
type TuiDaemonStatusResult = { state: "running" };

/** Successful IPC `start` RPC payload with the spawned run id. */
type TuiDaemonStartResult = { runId: string };

/**
 * Connected TUI daemon client over one IPC transport: liveness, run list, launch, steering,
 * wait, and close.
 * RPC methods throw {@link TuiDaemonConnectionError} on transport or wire failure and
 * {@link TuiDaemonRpcError} on correlated daemon `error` frames.
 */
export type TuiDaemonClient = {
  health(): Promise<TuiDaemonHealthResult>;
  status(): Promise<TuiDaemonStatusResult>;
  list(): Promise<DaemonListResult>;
  start(input: WriteLoopInput): Promise<TuiDaemonStartResult>;
  /**
   * Signal graceful pause for an active run at the next iteration boundary.
   * @param runId Durable run id to pause.
   * @returns `{ ok: true }` when the daemon accepts the pause.
   * @throws {TuiDaemonRpcError} When the daemon rejects the request (`unknown_run`, `run_not_active`, …).
   * @throws {TuiDaemonConnectionError} When the transport fails or the success payload is malformed.
   */
  pause(runId: string): Promise<TuiDaemonHealthResult>;
  /**
   * Resume a paused or killed run under daemon start guards, or resolve an
   * `awaiting-human` run via `decision`/`prompt`.
   * @param runId Durable run id to resume.
   * @param options Optional human-loop decision (`approve`/`abort`/`revise`) and revise prompt.
   * @returns `{ ok: true }` when the daemon accepts the resume.
   * @throws {TuiDaemonRpcError} When the daemon rejects the request (`unknown_run`, `terminal_run`, `run_in_progress`, `worktree_claimed`, …).
   * @throws {TuiDaemonConnectionError} When the transport fails or the success payload is malformed.
   */
  resume(
    runId: string,
    options?: { decision?: "approve" | "abort" | "revise"; prompt?: string },
  ): Promise<TuiDaemonHealthResult>;
  /**
   * Abort an active run immediately and record durable status `killed`.
   * @param runId Durable run id to kill.
   * @returns `{ ok: true }` when the daemon accepts the kill.
   * @throws {TuiDaemonRpcError} When the daemon rejects the request (`unknown_run`, `run_not_active`, …).
   * @throws {TuiDaemonConnectionError} When the transport fails or the success payload is malformed.
   */
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
  if (!parsed) throw new TuiDaemonConnectionError(message);
  return parsed;
}

/**
 * Open a TUI daemon client on the production or injected socket.
 *
 * @param options Optional socket path and `connectIpcClient` seam.
 * @returns A client exposing `health`, `status`, `list`, `start`, `pause`, `resume`, `kill`, `wait`, and `close` on one connection.
 * @throws {TuiDaemonConnectionError} When the socket is unreachable or RPC wire protocol fails.
 */
export async function connectTuiDaemon(options?: ConnectTuiDaemonOptions): Promise<TuiDaemonClient> {
  const socketPath = options?.socketPath ?? DAEMON_SOCKET_PATH;
  const connectFn = options?.connectIpcClient ?? connectIpcClient;

  let client: IpcClient;
  try {
    client = await connectFn(socketPath);
  } catch (cause) {
    throw new TuiDaemonConnectionError(`cannot connect to daemon socket ${socketPath}`, { cause });
  }

  const transport = createTuiDaemonRpcTransport(client);

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
