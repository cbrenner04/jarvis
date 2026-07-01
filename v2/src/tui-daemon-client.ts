import { homedir } from "node:os";
import { join } from "node:path";
import type { WaitRunCompletionResult } from "./daemon.ts";
import {
  type DaemonListResult,
  parseHealthResult,
  parseListRuns,
  parseStartResult,
  parseStatusResult,
  parseWaitCompletion,
} from "./daemon-wire.ts";
import { connectIpcClient, type IpcClient } from "./ipc/client.ts";
import { TuiDaemonConnectionError } from "./tui-daemon-errors.ts";
import { createTuiDaemonRpcTransport } from "./tui-daemon-rpc-transport.ts";
import type { WriteLoopInput } from "./write-loop.ts";

/** Successful `health` RPC payload from the daemon host. */
export type TuiDaemonHealthResult = { ok: true };

/** Successful IPC `status` RPC payload when the daemon host is live. */
export type TuiDaemonStatusResult = { state: "running" };

/** Successful IPC `start` RPC payload with the spawned run id. */
export type TuiDaemonStartResult = { runId: string };

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
   * Resume a paused or killed run under daemon start guards.
   * @param runId Durable run id to resume.
   * @returns `{ ok: true }` when the daemon accepts the resume.
   * @throws {TuiDaemonRpcError} When the daemon rejects the request (`unknown_run`, `terminal_run`, `run_in_progress`, `worktree_claimed`, …).
   * @throws {TuiDaemonConnectionError} When the transport fails or the success payload is malformed.
   */
  resume(runId: string): Promise<TuiDaemonHealthResult>;
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

const DEFAULT_SOCKET_PATH = join(homedir(), ".jarvis", "daemon.sock");

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
  const socketPath = options?.socketPath ?? DEFAULT_SOCKET_PATH;
  const connectFn = options?.connectIpcClient ?? connectIpcClient;

  let client: IpcClient;
  try {
    client = await connectFn(socketPath);
  } catch (cause) {
    throw new TuiDaemonConnectionError(`cannot connect to daemon socket ${socketPath}`, { cause });
  }

  const transport = createTuiDaemonRpcTransport(client);

  const okRunRpc = async (method: "pause" | "resume" | "kill", runId: string): Promise<TuiDaemonHealthResult> =>
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
      return parseOrThrow(parseListRuns(await transport.request("list")), "malformed RPC reply: invalid list result");
    },
    async start(input) {
      return parseOrThrow(
        parseStartResult(await transport.request("start", { input })),
        "malformed RPC reply: invalid start result",
      );
    },
    pause: (runId) => okRunRpc("pause", runId),
    resume: (runId) => okRunRpc("resume", runId),
    kill: (runId) => okRunRpc("kill", runId),
    async wait(runId) {
      return parseOrThrow(
        parseWaitCompletion(await transport.request("wait", { runId }, { trackWait: true })),
        "malformed RPC reply: invalid wait result",
      );
    },
    close() {
      transport.close();
    },
  };
}
