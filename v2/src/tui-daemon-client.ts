import { homedir } from "node:os";
import { join } from "node:path";
import type { WaitRunCompletionResult } from "./daemon.ts";
import { parseListRuns, parseWaitCompletion, type DaemonListResult } from "./daemon-wire.ts";
import { connectIpcClient, type IpcClient } from "./ipc/client.ts";
import type { ErrorFrame, IpcFrame, ResponseFrame } from "./ipc/types.ts";
import type { WriteLoopInput } from "./write-loop.ts";

/** Operator-facing socket path in unavailable-daemon feedback. */
export const TUI_DAEMON_SOCKET_DISPLAY = "~/.jarvis/daemon.sock";

/** Successful `health` RPC payload from the daemon host. */
export type TuiDaemonHealthResult = { ok: true };

/** Successful IPC `status` RPC payload when the daemon host is live. */
export type TuiDaemonStatusResult = { state: "running" };

/** Successful IPC `start` RPC payload with the spawned run id. */
export type TuiDaemonStartResult = { runId: string };

/** Transport, wire-protocol, or malformed-payload failure while talking to the daemon socket. */
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

/** Correlated daemon `error` frame on any RPC (`health`, `status`, `list`, `wait`, `start`, …). */
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

/** Connected TUI daemon client over one IPC transport: liveness, run list, launch, wait, and close. */
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
  /**
   * Round-trip `list`; reuses the open transport and may overlap other RPCs.
   * @returns Durable runs merged with current liveness.
   * @throws {TuiDaemonConnectionError} On wire or transport failure.
   * @throws {TuiDaemonRpcError} When the daemon returns a correlated `error` frame.
   */
  list(): Promise<DaemonListResult>;
  /**
   * Round-trip IPC `start` with one `WriteLoopInput` payload.
   * @param input Daemon launch payload matching `jarvis run start`.
   * @returns Spawned run id `{ runId }`.
   * @throws {TuiDaemonConnectionError} On wire or transport failure.
   * @throws {TuiDaemonRpcError} When the daemon returns a correlated `error` frame.
   */
  start(input: WriteLoopInput): Promise<TuiDaemonStartResult>;
  /**
   * Round-trip `wait` for one run id; reuses the open transport and may overlap other RPCs.
   * @param runId Durable daemon run id to await.
   * @returns The next completion-boundary result for `runId`.
   * @throws {TuiDaemonConnectionError} On wire or transport failure.
   * @throws {TuiDaemonRpcError} When the daemon returns a correlated `error` frame.
   */
  wait(runId: string): Promise<WaitRunCompletionResult>;
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

type PendingRpc = {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
};

type RpcTransport = {
  request(method: string, params?: unknown, options?: { trackWait?: boolean }): Promise<unknown>;
  close(): void;
};

function createRpcTransport(client: IpcClient): RpcTransport {
  const pending = new Map<string, PendingRpc>();
  const abandoned = new Set<string>();
  let activeWaitId: string | null = null;
  let closed = false;
  let readerStarted = false;

  const abandonRequest = (id: string): void => {
    abandoned.add(id);
    pending.delete(id);
    if (activeWaitId === id) {
      activeWaitId = null;
    }
  };

  const rejectAll = (error: Error): void => {
    closed = true;
    const active = Array.from(pending.values());
    pending.clear();
    abandoned.clear();
    for (const entry of active) {
      entry.reject(error);
    }
  };

  const failProtocol = (message: string): void => {
    client.close();
    rejectAll(new TuiDaemonConnectionError(message));
  };

  const ensureReader = (): void => {
    if (readerStarted) return;
    readerStarted = true;
    void readRpcFrames(client, () => closed, rejectAll, failProtocol, pending, abandoned);
  };

  return {
    request(method: string, params?: unknown, options?: { trackWait?: boolean }): Promise<unknown> {
      if (closed) {
        return Promise.reject(new TuiDaemonConnectionError("IPC connection lost"));
      }

      if (options?.trackWait && activeWaitId !== null) {
        abandonRequest(activeWaitId);
      }

      const id = crypto.randomUUID();
      if (options?.trackWait) {
        activeWaitId = id;
      }

      return new Promise<unknown>((resolve, reject) => {
        pending.set(id, {
          resolve: (result) => {
            if (activeWaitId === id) {
              activeWaitId = null;
            }
            resolve(result);
          },
          reject: (error) => {
            if (activeWaitId === id) {
              activeWaitId = null;
            }
            reject(error);
          },
        });
        ensureReader();
        try {
          client.send({ kind: "request", id, method, ...(params !== undefined ? { params } : {}) });
        } catch (cause) {
          pending.delete(id);
          abandoned.delete(id);
          if (activeWaitId === id) {
            activeWaitId = null;
          }
          reject(new TuiDaemonConnectionError("IPC connection lost", { cause }));
        }
      });
    },
    close(): void {
      if (closed) return;
      client.close();
      rejectAll(new TuiDaemonConnectionError("IPC connection lost"));
    },
  };
}

async function readRpcFrames(
  client: IpcClient,
  isClosed: () => boolean,
  rejectAll: (error: Error) => void,
  failProtocol: (message: string) => void,
  pending: Map<string, PendingRpc>,
  abandoned: Set<string>,
): Promise<void> {
  while (!isClosed()) {
    const frame = await nextRpcFrame(client, isClosed, rejectAll);
    if (frame === undefined) return;

    const handling = handleRpcFrame(frame, pending, abandoned);
    if (handling.kind === "continue") continue;
    if (handling.kind === "protocol-error") {
      failProtocol(handling.message);
      return;
    }
  }
}

async function nextRpcFrame(
  client: IpcClient,
  isClosed: () => boolean,
  rejectAll: (error: Error) => void,
): Promise<IpcFrame | undefined> {
  try {
    return await client.nextFrame();
  } catch (cause) {
    if (!isClosed()) {
      rejectAll(new TuiDaemonConnectionError("IPC connection lost", { cause }));
    }
    return undefined;
  }
}

function handleRpcFrame(
  frame: IpcFrame,
  pending: Map<string, PendingRpc>,
  abandoned: Set<string>,
): { kind: "continue" } | { kind: "protocol-error"; message: string } {
  if (frame.kind !== "response" && frame.kind !== "error") {
    return { kind: "protocol-error", message: `malformed RPC reply: unexpected frame kind ${frame.kind}` };
  }

  if (!isCorrelatedRpcFrame(frame)) {
    return { kind: "protocol-error", message: "malformed RPC reply: missing correlation id" };
  }

  const entry = pending.get(frame.id);
  if (!entry) {
    if (abandoned.delete(frame.id)) {
      return { kind: "continue" };
    }
    return { kind: "protocol-error", message: "non-correlated RPC reply" };
  }

  pending.delete(frame.id);
  if (frame.kind === "error") {
    entry.reject(new TuiDaemonRpcError(frame.code, frame.message));
    return { kind: "continue" };
  }

  entry.resolve(frame.result);
  return { kind: "continue" };
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

function parseStartResult(result: unknown): TuiDaemonStartResult {
  if (typeof result === "object" && result !== null && typeof (result as { runId?: unknown }).runId === "string") {
    return { runId: (result as { runId: string }).runId };
  }
  throw new TuiDaemonConnectionError("malformed RPC reply: invalid start result");
}

function parseListResult(result: unknown): DaemonListResult {
  const parsed = parseListRuns(result);
  if (!parsed) {
    throw new TuiDaemonConnectionError("malformed RPC reply: invalid list result");
  }
  return parsed;
}

function parseWaitResult(result: unknown): WaitRunCompletionResult {
  const parsed = parseWaitCompletion(result);
  if (!parsed) {
    throw new TuiDaemonConnectionError("malformed RPC reply: invalid wait result");
  }
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

  const transport = createRpcTransport(client);

  return {
    async health(): Promise<TuiDaemonHealthResult> {
      return parseHealthResult(await transport.request("health"));
    },
    async status(): Promise<TuiDaemonStatusResult> {
      return parseStatusResult(await transport.request("status"));
    },
    async list(): Promise<DaemonListResult> {
      return parseListResult(await transport.request("list"));
    },
    async start(input: WriteLoopInput): Promise<TuiDaemonStartResult> {
      return parseStartResult(await transport.request("start", { input }));
    },
    async wait(runId: string): Promise<WaitRunCompletionResult> {
      return parseWaitResult(await transport.request("wait", { runId }, { trackWait: true }));
    },
    close(): void {
      transport.close();
    },
  };
}
