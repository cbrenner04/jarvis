import { Socket } from "node:net";
import { encodeFrame, FrameDecoder } from "./codec.ts";
import type { IpcFrame } from "./types.ts";

export type IpcClient = {
  send(frame: unknown): void;
  nextFrame(timeoutMs?: number): Promise<IpcFrame>;
  close(): void;
};

/** Applied to `nextFrame()` calls that omit `timeoutMs`, so an unresponsive server fails fast instead of hanging. */
export const DEFAULT_NEXT_FRAME_TIMEOUT_MS = 10_000;

export type IpcClientOptions = {
  /** Overrides {@link DEFAULT_NEXT_FRAME_TIMEOUT_MS} for calls to `nextFrame()` that omit `timeoutMs`. */
  defaultTimeoutMs?: number;
};

function connectSocket(socketPath: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = new Socket();
    socket.once("connect", () => resolve(socket));
    socket.once("error", reject);
    socket.connect(socketPath);
  });
}

export async function connectIpcClient(socketPath: string, options?: IpcClientOptions): Promise<IpcClient> {
  const defaultTimeoutMs = options?.defaultTimeoutMs ?? DEFAULT_NEXT_FRAME_TIMEOUT_MS;
  const socket = await connectSocket(socketPath);
  const decoder = new FrameDecoder();
  const pending: IpcFrame[] = [];
  let waiter: ((frame: IpcFrame) => void) | null = null;
  let closed = false;

  const resolveNext = (frame: IpcFrame): void => {
    if (waiter) {
      const resolve = waiter;
      waiter = null;
      resolve(frame);
      return;
    }
    pending.push(frame);
  };

  socket.on("data", (chunk: Buffer) => {
    try {
      const frames = decoder.push(chunk);
      for (const frame of frames) {
        resolveNext(frame);
      }
    } catch {
      socket.destroy();
    }
  });

  socket.on("close", () => {
    closed = true;
  });

  return {
    send(frame: unknown): void {
      socket.write(encodeFrame(frame));
    },
    nextFrame(timeoutMs: number = defaultTimeoutMs): Promise<IpcFrame> {
      const next = pending.shift();
      if (next) {
        return Promise.resolve(next);
      }
      if (closed) {
        return Promise.reject(new Error("connection closed"));
      }
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          waiter = null;
          reject(new Error("timed out waiting for frame"));
        }, timeoutMs);
        waiter = (frame) => {
          clearTimeout(timer);
          resolve(frame);
        };
      });
    },
    close(): void {
      socket.destroy();
    },
  };
}
