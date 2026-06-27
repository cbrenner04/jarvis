import { rmSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { FrameDecoder, encodeFrame } from "./codec.ts";
import type { ErrorFrame, IpcFrame, ResponseFrame } from "./types.ts";

const VALID_KINDS = new Set([
  "request",
  "response",
  "error",
  "stream-open",
  "stream-data",
  "stream-end",
]);

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

function writeFrame(socket: Socket, frame: unknown): void {
  socket.write(encodeFrame(frame));
}

function closeConnection(socket: Socket): void {
  socket.destroy();
}

function dispatchRequest(socket: Socket, frame: IpcFrame & { kind: "request" }): void {
  const { id, method } = frame;
  switch (method) {
    case "health":
      writeFrame(socket, responseFrame(id, { ok: true }));
      return;
    case "status":
      writeFrame(socket, responseFrame(id, { state: "running" }));
      return;
    default:
      writeFrame(socket, errorFrame(id, "unknown_method", `unknown method: ${method}`));
  }
}

function handleFrame(socket: Socket, frame: unknown): void {
  const kind = frameKind(frame);
  if (!isValidKind(kind)) {
    closeConnection(socket);
    return;
  }

  switch (kind) {
    case "request":
      dispatchRequest(socket, frame as IpcFrame & { kind: "request" });
      return;
    case "stream-open":
      return;
    case "stream-data": {
      const streamFrame = frame as IpcFrame & { kind: "stream-data" };
      writeFrame(socket, {
        kind: "stream-data",
        streamId: streamFrame.streamId,
        ...(streamFrame.payload !== undefined ? { payload: streamFrame.payload } : {}),
      });
      return;
    }
    case "stream-end":
      return;
    default:
      closeConnection(socket);
  }
}

function attachSocketHandlers(socket: Socket): void {
  const decoder = new FrameDecoder();

  socket.on("data", (chunk: Buffer) => {
    try {
      const frames = decoder.push(chunk);
      for (const frame of frames) {
        handleFrame(socket, frame);
      }
    } catch {
      closeConnection(socket);
    }
  });

  socket.on("end", () => {
    if (decoder.hasPartialFrame()) {
      closeConnection(socket);
    }
  });
}

/** In-process Unix-socket IPC listener bound at caller-supplied `socketPath`. */
export type IpcServer = {
  socketPath: string;
  close(): Promise<void>;
};

/**
 * Binds a Unix domain socket and serves typed IPC frames.
 * Removes an existing file at `socketPath` before bind.
 */
export function startIpcServer(socketPath: string): Promise<IpcServer> {
  rmSync(socketPath, { force: true });

  const server: Server = createServer((socket) => {
    attachSocketHandlers(socket);
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => {
      server.off("error", reject);
      resolve({
        socketPath,
        close: () =>
          new Promise((closeResolve, closeReject) => {
            server.close((err) => {
              rmSync(socketPath, { force: true });
              if (err) {
                closeReject(err);
                return;
              }
              closeResolve();
            });
          }),
      });
    });
  });
}
