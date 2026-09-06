import { rmSync } from "node:fs";
import { createServer, type Server, Socket } from "node:net";
import { promisify } from "node:util";
import { encodeFrame, FrameDecoder } from "./codec.ts";
import type { ErrorFrame, IpcFrame, ResponseFrame, StreamDataFrame, StreamEndFrame } from "./types.ts";

export type RpcHandler = (
  frame: IpcFrame & { kind: "request" },
  signal: AbortSignal,
) =>
  | { kind: "response"; result: unknown }
  | { kind: "error"; code: string; message: string }
  | Promise<{ kind: "response"; result: unknown } | { kind: "error"; code: string; message: string }>;

export type StreamHandler = (
  streamId: string,
  payload: unknown,
  onData: (record: unknown) => void,
  onClose: () => void,
  signal: AbortSignal,
) => Promise<void>;

const VALID_KINDS = new Set(["request", "response", "error", "stream-open", "stream-data", "stream-end"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function frameKind(frame: unknown): string | null {
  if (!isRecord(frame) || typeof frame.kind !== "string") {
    return null;
  }
  return frame.kind;
}

function isValidKind(kind: string | null): kind is IpcFrame["kind"] {
  return kind !== null && VALID_KINDS.has(kind);
}

function responseFrame(id: string, result: unknown): ResponseFrame {
  return { kind: "response", id, result };
}

function errorFrame(id: string, code: string, message: string): ErrorFrame {
  return { kind: "error", id, code, message };
}

function dispatchRequest(
  socket: Socket,
  frame: IpcFrame & { kind: "request" },
  handlers?: Record<string, RpcHandler>,
  activeRequests?: Map<string, AbortController>,
): void {
  const { id, method } = frame;

  const customHandler = handlers?.[method];
  if (customHandler) {
    const abortController = new AbortController();
    activeRequests?.set(id, abortController);
    Promise.resolve(customHandler(frame, abortController.signal))
      .then((response) => {
        if (abortController.signal.aborted || socket.destroyed) return;
        if (response.kind === "response") {
          socket.write(encodeFrame(responseFrame(id, response.result)));
        } else {
          socket.write(encodeFrame(errorFrame(id, response.code, response.message)));
        }
      })
      .catch((err: unknown) => {
        if (abortController.signal.aborted || socket.destroyed) return;
        const message = err instanceof Error ? err.message : "unknown error";
        socket.write(encodeFrame(errorFrame(id, "internal_error", message)));
      })
      .finally(() => {
        activeRequests?.delete(id);
      });
    return;
  }

  socket.write(encodeFrame(errorFrame(id, "unknown_method", `unknown method: ${method}`)));
}

function handleFrame(
  socket: Socket,
  frame: unknown,
  handlers?: Record<string, RpcHandler>,
  streamHandler?: StreamHandler,
  activeStreams?: Map<string, AbortController>,
  activeRequests?: Map<string, AbortController>,
): void {
  const kind = frameKind(frame);
  if (!isValidKind(kind)) {
    socket.destroy();
    return;
  }

  switch (kind) {
    case "request":
      dispatchRequest(socket, frame as IpcFrame & { kind: "request" }, handlers, activeRequests);
      return;
    case "stream-open": {
      const openFrame = frame as IpcFrame & { kind: "stream-open" };
      if (!streamHandler) {
        socket.destroy();
        return;
      }

      const abortController = new AbortController();
      if (activeStreams) {
        activeStreams.set(openFrame.streamId, abortController);
      }

      (async () => {
        try {
          const signal = abortController.signal;

          await streamHandler(
            openFrame.streamId,
            openFrame.payload,
            (record: unknown) => {
              if (!signal.aborted) {
                const dataFrame: StreamDataFrame = {
                  kind: "stream-data",
                  streamId: openFrame.streamId,
                  payload: JSON.stringify(record),
                };
                socket.write(encodeFrame(dataFrame));
              }
            },
            () => {
              const endFrame: StreamEndFrame = {
                kind: "stream-end",
                streamId: openFrame.streamId,
              };
              socket.write(encodeFrame(endFrame));
              if (activeStreams) {
                activeStreams.delete(openFrame.streamId);
              }
            },
            signal,
          );
        } catch (err) {
          const endFrame: StreamEndFrame = {
            kind: "stream-end",
            streamId: openFrame.streamId,
            payload: { error: err instanceof Error ? err.message : "unknown error" },
          };
          socket.write(encodeFrame(endFrame));
          if (activeStreams) {
            activeStreams.delete(openFrame.streamId);
          }
        }
      })();
      return;
    }
    case "stream-data":
      return;
    case "stream-end": {
      const endFrame = frame as IpcFrame & { kind: "stream-end" };
      if (activeStreams?.has(endFrame.streamId)) {
        const controller = activeStreams.get(endFrame.streamId);
        controller?.abort();
        activeStreams.delete(endFrame.streamId);
      }
      return;
    }
    default:
      socket.destroy();
  }
}

function attachSocketHandlers(
  socket: Socket,
  handlers?: Record<string, RpcHandler>,
  streamHandler?: StreamHandler,
): void {
  const decoder = new FrameDecoder();
  const activeStreams = new Map<string, AbortController>();
  const activeRequests = new Map<string, AbortController>();

  socket.on("data", (chunk: Buffer) => {
    try {
      const frames = decoder.push(chunk);
      for (const frame of frames) {
        handleFrame(socket, frame, handlers, streamHandler, activeStreams, activeRequests);
      }
    } catch {
      socket.destroy();
    }
  });

  socket.on("end", () => {
    if (decoder.hasPartialFrame()) {
      socket.destroy();
    }
    for (const controller of activeStreams.values()) {
      controller.abort();
    }
    activeStreams.clear();
    for (const controller of activeRequests.values()) {
      controller.abort();
    }
    activeRequests.clear();
  });

  socket.on("close", () => {
    for (const controller of activeStreams.values()) {
      controller.abort();
    }
    activeStreams.clear();
    for (const controller of activeRequests.values()) {
      controller.abort();
    }
    activeRequests.clear();
  });
}

const DEFAULT_DRAIN_TIMEOUT_MS = 5_000;

function waitForSocketDrain(activeSockets: Set<Socket>, timeoutMs: number): Promise<void> {
  if (activeSockets.size === 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      for (const socket of activeSockets) {
        socket.destroy();
      }
      resolve();
    }, timeoutMs);
    const check = (): void => {
      if (activeSockets.size === 0) {
        clearTimeout(timer);
        resolve();
      }
    };
    for (const socket of activeSockets) {
      socket.once("close", check);
    }
    check();
  });
}

export type IpcServer = {
  socketPath: string;
  close(options?: { drainTimeoutMs?: number }): Promise<void>;
};

/** How a socket path responds to a connect probe. */
export type SocketLiveness = "live" | "stale" | "absent";

/** Raised instead of unlinking a socket path a live daemon is still serving. */
export class DaemonSocketInUseError extends Error {
  readonly socketPath: string;

  constructor(socketPath: string) {
    super(
      `A daemon is already listening on ${socketPath}. ` + `Refusing to replace it — stop the running daemon first.`,
    );
    this.name = "DaemonSocketInUseError";
    this.socketPath = socketPath;
  }
}

const LIVENESS_PROBE_TIMEOUT_MS = 250;
const EXTENDED_LIVENESS_PROBE_TIMEOUT_MS = 2_000;

export type SocketProbeDetail = {
  liveness: SocketLiveness;
  peerConnected: boolean;
};

/**
 * The socket-probe seam. Production and tests share one implementation shape so an injected probe
 * traverses exactly the code path `probeSocketDetailed` does — a liveness-only seam cannot express
 * `peerConnected`, which is what distinguishes a probe timeout from a daemon that answered.
 */
export type DetailedSocketProbe = (path: string, timeoutMs: number) => Promise<SocketProbeDetail>;

/**
 * Map a connect failure to a liveness verdict.
 *
 * Only a definitive "nothing is accepting here" (ECONNREFUSED — a dead daemon's leftover entry)
 * or "nothing is here" (ENOENT) permits removal. Every other failure is inconclusive and must
 * read as live: unlinking on an inconclusive probe is exactly what strands a running daemon.
 */
export function classifySocketConnectError(err: NodeJS.ErrnoException): SocketLiveness {
  if (err.code === "ENOENT") {
    return "absent";
  }
  return err.code === "ECONNREFUSED" ? "stale" : "live";
}

function probeSocketDetailed(socketPath: string, timeoutMs: number): Promise<SocketProbeDetail> {
  // Deliberately no `existsSync` short-circuit. A denied or failing `stat` returns false, which
  // would classify a live peer's socket as absent and unlink it — the exact outage this guard
  // exists to prevent. `connect()` reports a genuinely missing path as ENOENT, so the connect
  // probe alone is both sufficient and the only check that cannot false-negative into deletion.
  return new Promise((resolve) => {
    // Handlers are attached before connecting: bun surfaces ENOENT on the socket rather than as
    // a return value, and a handler registered after `connect()` can miss it and let the error
    // escape as an uncaught exception — which would block every daemon start on a clean machine.
    const socket = new Socket();
    let settled = false;
    let peerConnected = false;
    const settle = (liveness: SocketLiveness): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve({ liveness, peerConnected });
    };
    const timer = setTimeout(() => settle("live"), timeoutMs);
    socket.once("connect", () => {
      peerConnected = true;
      settle("live");
    });
    socket.once("error", (err: NodeJS.ErrnoException) => settle(classifySocketConnectError(err)));
    socket.connect(socketPath);
  });
}

/**
 * Classify a socket path by attempting a connection.
 *
 * `absent` when nothing is at the path, `stale` when the entry exists but nothing accepts
 * (ECONNREFUSED — a dead daemon's leftover), `live` when a peer accepts or is too busy to answer
 * within the probe timeout.
 */
export function probeSocketLiveness(socketPath: string): Promise<SocketLiveness> {
  return probeSocketDetailed(socketPath, LIVENESS_PROBE_TIMEOUT_MS).then((detail) => detail.liveness);
}

async function prepareSocketPathForBind(socketPath: string, probeDetailed: DetailedSocketProbe): Promise<void> {
  const initial = await probeDetailed(socketPath, LIVENESS_PROBE_TIMEOUT_MS);
  // A `live` verdict with no peer actually connected is the probe timing out, not a daemon
  // answering. On a loaded machine that would otherwise convert a dead socket into a permanently
  // unrecoverable one, so re-probe with a longer bound before believing it.
  if (initial.liveness === "live" && !initial.peerConnected) {
    const extended = await probeDetailed(socketPath, EXTENDED_LIVENESS_PROBE_TIMEOUT_MS);
    if (extended.liveness === "live" && !extended.peerConnected) {
      // Still no peer. Removing here would unlink on an inconclusive answer, so leave the path
      // alone and let `listen` decide: occupancy reclaim runs only on a real EADDRINUSE.
      return;
    }
  }
  await removeStaleSocketPath(socketPath, (path) =>
    probeDetailed(path, LIVENESS_PROBE_TIMEOUT_MS).then((detail) => detail.liveness),
  );
}

function isAddrInUseError(error: unknown): error is NodeJS.ErrnoException {
  return isRecord(error) && error.code === "EADDRINUSE";
}

/**
 * Remove a socket path only when no live daemon is listening on it.
 *
 * Unlinking unconditionally makes a healthy peer permanently unreachable: it keeps the bound
 * inode and serves existing connections, but every later `connect()` resolves by path and gets
 * ENOENT. A connect probe that times out is treated as live (fail-safe) — a saturated daemon is
 * still serving, and must not be unlinked out of existence.
 */
export async function removeStaleSocketPath(
  socketPath: string,
  probe: (path: string) => Promise<SocketLiveness> = probeSocketLiveness,
): Promise<void> {
  const liveness = await probe(socketPath);
  if (liveness === "live") {
    throw new DaemonSocketInUseError(socketPath);
  }
  // Only a proven-stale entry is removed. `absent` means the probe found nothing to remove, so
  // unlinking there can never be necessary and is the one path by which a live socket can be
  // deleted: a sandboxed caller that cannot resolve the path gets ENOENT for a socket a daemon
  // is actively serving, which classifies as `absent`. Deleting on that false negative strands
  // the running daemon behind a bound-but-unlinked inode.
  if (liveness === "stale") {
    rmSync(socketPath, { force: true });
  }
}

function createIpcServerClose(
  socketPath: string,
  server: Server,
  activeSockets: Set<Socket>,
  setAcceptingConnections: (accepting: boolean) => void,
): IpcServer["close"] {
  return async (options) => {
    setAcceptingConnections(false);
    const drainTimeoutMs = options?.drainTimeoutMs ?? DEFAULT_DRAIN_TIMEOUT_MS;
    try {
      const [closeResult, drainResult] = await Promise.allSettled([
        promisify(server.close.bind(server))(),
        waitForSocketDrain(activeSockets, drainTimeoutMs),
      ]);
      if (closeResult.status === "rejected") {
        throw closeResult.reason;
      }
      if (drainResult.status === "rejected") {
        throw drainResult.reason;
      }
    } finally {
      // Note: `server.close()` already unlinks by path, and node keys that on the path
      // rather than the inode it created — so a socket force-rebound by a successor is
      // removed by node before this runs. Guarding here would be inert; the durable
      // protection is the start-side liveness check, which stops the replacement from
      // happening at all.
      // @mutate-equivalent mutation="skip-destructive: rmSync(" reason="node unlinks the socket path inside server.close() before this finally runs, so removing this defensive cleanup has no observable effect on any reachable path; a killing test would have to assert node's own unlink did not happen"
      rmSync(socketPath, { force: true });
    }
  };
}

function listenForIpcServer(
  server: Server,
  socketPath: string,
  probeDetailed: DetailedSocketProbe,
  onListening: () => IpcServer,
): Promise<IpcServer> {
  return new Promise((resolve, reject) => {
    const attemptListen = (allowOccupancyReclaim: boolean): void => {
      server.once("error", (error: unknown) => {
        void (async () => {
          if (allowOccupancyReclaim && isAddrInUseError(error)) {
            // EADDRINUSE proves the path is occupied; the reprobe decides whether anything is
            // accepting on it. Only a proven-`stale` reprobe authorizes the unlink — `absent` is
            // the sandboxed-caller false negative and must never reclaim.
            const reprobe = (await probeDetailed(socketPath, LIVENESS_PROBE_TIMEOUT_MS)).liveness;
            if (reprobe === "stale") {
              rmSync(socketPath, { force: true });
              attemptListen(false);
              return;
            }
          }
          reject(error);
        })();
      });
      server.listen(socketPath, () => {
        server.removeAllListeners("error");
        resolve(onListening());
      });
    };
    attemptListen(true);
  });
}

export async function startIpcServer(
  socketPath: string,
  handlers?: Record<string, RpcHandler>,
  streamHandler?: StreamHandler,
  probeDetailed: DetailedSocketProbe = probeSocketDetailed,
): Promise<IpcServer> {
  await prepareSocketPathForBind(socketPath, probeDetailed);

  const activeSockets = new Set<Socket>();
  let acceptingConnections = true;

  const server: Server = createServer((socket) => {
    if (!acceptingConnections) {
      socket.destroy();
      return;
    }
    activeSockets.add(socket);
    socket.once("close", () => {
      activeSockets.delete(socket);
    });
    attachSocketHandlers(socket, handlers, streamHandler);
  });

  return listenForIpcServer(server, socketPath, probeDetailed, () => ({
    socketPath,
    close: createIpcServerClose(socketPath, server, activeSockets, (accepting) => {
      acceptingConnections = accepting;
    }),
  }));
}
