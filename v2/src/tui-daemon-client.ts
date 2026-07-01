import { homedir } from "node:os";
import { join } from "node:path";
import type { WaitRunCompletionResult } from "./daemon.ts";
import {
  parseHealthResult,
  parseListRuns,
  parseStartResult,
  parseStatusResult,
  parseWaitCompletion,
  type DaemonListResult,
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
 * Connected TUI daemon client over one IPC transport: liveness, run list, launch, wait, and close.
 * RPC methods throw {@link TuiDaemonConnectionError} on transport or wire failure and
 * {@link TuiDaemonRpcError} on correlated daemon `error` frames.
 */
export type TuiDaemonClient = {
  health(): Promise<TuiDaemonHealthResult>;
  status(): Promise<TuiDaemonStatusResult>;
  list(): Promise<DaemonListResult>;
  start(input: WriteLoopInput): Promise<TuiDaemonStartResult>;
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
 * @returns A client exposing `health`, `status`, `list`, `start`, `wait`, and `close` on one connection.
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

  return {
    async health() {
      return parseOrThrow(parseHealthResult(await transport.request("health")), "malformed RPC reply: invalid health result");
    },
    async status() {
      return parseOrThrow(parseStatusResult(await transport.request("status")), "malformed RPC reply: invalid status result");
    },
    async list() {
      return parseOrThrow(parseListRuns(await transport.request("list")), "malformed RPC reply: invalid list result");
    },
    async start(input) {
      return parseOrThrow(parseStartResult(await transport.request("start", { input })), "malformed RPC reply: invalid start result");
    },
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
