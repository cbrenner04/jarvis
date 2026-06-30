import { homedir } from "node:os";
import { join } from "node:path";
import { connectIpcClient, type IpcClient } from "./ipc/client.ts";
import type { ErrorFrame, IpcFrame, ResponseFrame } from "./ipc/types.ts";

/** Successful `health` RPC payload from the daemon host. */
export type TuiDaemonHealthResult = { ok: true };

/** Successful `status` RPC payload when the daemon host is live. */
export type TuiDaemonStatusResult = { state: "running" };

/** Transport or wire-protocol failure while talking to the daemon socket. */
export class TuiDaemonConnectionError extends Error {
  /**
   * @param message Operator- or caller-facing summary of the transport failure.
   * @param options Optional `cause` from the underlying connect or frame read.
   */
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "TuiDaemonConnectionError";
  }
}

/** Correlated daemon `error` frame on `health` or `status`. */
export class TuiDaemonRpcError extends Error {
  /** Daemon error code from the correlated `error` frame. */
  readonly code: string;

  /**
   * @param code Daemon error code from the correlated `error` frame.
   * @param message Daemon error message from the correlated `error` frame.
   */
  constructor(code: string, message: string) {
    super(message);
    this.name = "TuiDaemonRpcError";
    this.code = code;
  }
}

/** Connected TUI daemon client: `health`, `status`, and `close` over one IPC transport. */
export type TuiDaemonClient = {
  /**
   * Round-trip `health`; reuses the open transport.
   * @returns Daemon liveness payload `{ ok: true }`.
   * @throws {TuiDaemonConnectionError} On wire or transport failure.
   * @throws {TuiDaemonRpcError} When the daemon returns a correlated `error` frame.
   */
  health(): Promise<TuiDaemonHealthResult>;
  /**
   * Round-trip `status`; reuses the open transport.
   * @returns Daemon host state `{ state: "running" }`.
   * @throws {TuiDaemonConnectionError} On wire or transport failure.
   * @throws {TuiDaemonRpcError} When the daemon returns a correlated `error` frame.
   */
  status(): Promise<TuiDaemonStatusResult>;
  /** Tear down the underlying IPC transport; does not throw. */
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

function isCorrelatedRpcFrame(frame: IpcFrame): frame is ResponseFrame | ErrorFrame {
  return (frame.kind === "response" || frame.kind === "error") && typeof frame.id === "string";
}

async function rpcRequest(client: IpcClient, method: string): Promise<unknown> {
  const id = crypto.randomUUID();
  client.send({ kind: "request", id, method });

  while (true) {
    let frame: IpcFrame;
    try {
      frame = await client.nextFrame();
    } catch (cause) {
      throw new TuiDaemonConnectionError("IPC connection lost", { cause });
    }

    if (frame.kind !== "response" && frame.kind !== "error") {
      throw new TuiDaemonConnectionError(`malformed RPC reply: unexpected frame kind ${frame.kind}`);
    }

    if (!isCorrelatedRpcFrame(frame)) {
      throw new TuiDaemonConnectionError("malformed RPC reply: missing correlation id");
    }

    if (frame.id !== id) {
      throw new TuiDaemonConnectionError("non-correlated RPC reply");
    }

    if (frame.kind === "error") {
      throw new TuiDaemonRpcError(frame.code, frame.message);
    }

    return frame.result;
  }
}

function parseHealthResult(result: unknown): TuiDaemonHealthResult {
  if (typeof result === "object" && result !== null && (result as { ok?: unknown }).ok === true) {
    return { ok: true };
  }
  throw new TuiDaemonConnectionError("malformed RPC reply: invalid health result");
}

function parseStatusResult(result: unknown): TuiDaemonStatusResult {
  if (typeof result === "object" && result !== null && (result as { state?: unknown }).state === "running") {
    return { state: "running" };
  }
  throw new TuiDaemonConnectionError("malformed RPC reply: invalid status result");
}

/**
 * Open a TUI daemon client on the production or injected socket.
 *
 * @param options Optional socket path and `connectIpcClient` seam.
 * @returns A client exposing `health`, `status`, and `close` on one connection.
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

  return {
    async health(): Promise<TuiDaemonHealthResult> {
      return parseHealthResult(await rpcRequest(client, "health"));
    },
    async status(): Promise<TuiDaemonStatusResult> {
      return parseStatusResult(await rpcRequest(client, "status"));
    },
    close(): void {
      client.close();
    },
  };
}
