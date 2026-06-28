import { rmSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { encodeFrame, FrameDecoder } from "./codec.ts";
import type { ErrorFrame, IpcFrame, ResponseFrame } from "./types.ts";

export type RpcHandler = (
  frame: IpcFrame & { kind: "request" },
) => { kind: "response"; result: unknown } | { kind: "error"; code: string; message: string };

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
): void {
  const { id, method } = frame;

  const customHandler = handlers?.[method];
  if (customHandler) {
    const response = customHandler(frame);
    if (response.kind === "response") {
      socket.write(encodeFrame(responseFrame(id, response.result)));
    } else {
      socket.write(encodeFrame(errorFrame(id, response.code, response.message)));
    }
    return;
  }

  switch (method) {
    case "health":
      socket.write(encodeFrame(responseFrame(id, { ok: true })));
      return;
    case "status":
      socket.write(encodeFrame(responseFrame(id, { state: "running" })));
      return;
    default:
      socket.write(encodeFrame(errorFrame(id, "unknown_method", `unknown method: ${method}`)));
  }
}

function handleFrame(socket: Socket, frame: unknown, handlers?: Record<string, RpcHandler>): void {
  const kind = frameKind(frame);
  if (!isValidKind(kind)) {
    socket.destroy();
    return;
  }

  switch (kind) {
    case "request":
      dispatchRequest(socket, frame as IpcFrame & { kind: "request" }, handlers);
      return;
    case "stream-open":
      return;
    case "stream-data": {
      const streamFrame = frame as IpcFrame & { kind: "stream-data" };
      socket.write(
        encodeFrame({
          kind: "stream-data",
          streamId: streamFrame.streamId,
          ...(streamFrame.payload !== undefined ? { payload: streamFrame.payload } : {}),
        }),
      );
      return;
    }
    case "stream-end":
      return;
    default:
      socket.destroy();
  }
}

function attachSocketHandlers(socket: Socket, handlers?: Record<string, RpcHandler>): void {
  const decoder = new FrameDecoder();

  socket.on("data", (chunk: Buffer) => {
    try {
      const frames = decoder.push(chunk);
      for (const frame of frames) {
        handleFrame(socket, frame, handlers);
      }
    } catch {
      socket.destroy();
    }
  });

  socket.on("end", () => {
    if (decoder.hasPartialFrame()) {
      socket.destroy();
    }
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

export function startIpcServer(socketPath: string, handlers?: Record<string, RpcHandler>): Promise<IpcServer> {
  rmSync(socketPath, { force: true });

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
    attachSocketHandlers(socket, handlers);
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => {
      server.off("error", reject);
      resolve({
        socketPath,
        close: (options) =>
          new Promise((closeResolve, closeReject) => {
            acceptingConnections = false;
            const drainTimeoutMs = options?.drainTimeoutMs ?? DEFAULT_DRAIN_TIMEOUT_MS;
            server.close(async (err) => {
              try {
                await waitForSocketDrain(activeSockets, drainTimeoutMs);
                rmSync(socketPath, { force: true });
                if (err) {
                  closeReject(err);
                  return;
                }
                closeResolve();
              } catch (drainErr) {
                closeReject(drainErr);
              }
            });
          }),
      });
    });
  });
}
