import { Socket } from "node:net";
import { encodeFrame, FrameDecoder } from "./codec.ts";
import type { IpcFrame } from "./types.ts";

export type IpcClient = {
  send(frame: unknown): void;
  nextFrame(timeoutMs?: number): Promise<IpcFrame>;
  close(): void;
};

const DEFAULT_CONNECT_TIMEOUT_MS = 30_000;

/**
 * Bounds the connection-establishment step itself (distinct from `nextFrame()`,
 * which stays legitimately unbounded by default for long-running production
 * waits). The clock starts before `socket.connect`.
 */
function connectSocket(socketPath: string, timeoutMs: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = new Socket();
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`IPC connect timeout: socket "${socketPath}" not connected within ${timeoutMs}ms`));
    }, timeoutMs);
    socket.once("connect", () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    socket.connect(socketPath);
  });
}

/**
 * `defaultTimeoutMs`, when set, bounds `nextFrame()` calls that omit their own `timeoutMs` so an
 * unresponsive server fails fast instead of hanging. Left unset (the default), those calls wait
 * unbounded, matching this client's original behavior — production callers rely on that for
 * long-running waits (e.g. `wait` for a run to finish, RPC/log-tail read loops).
 *
 * `connectTimeoutMs` bounds connection establishment only (default 30000 ms) and never applies to
 * `nextFrame()`. Exhaustion rejects with an `IPC connect timeout` error naming the budget.
 */
export async function connectIpcClient(
  socketPath: string,
  defaultTimeoutMs?: number,
  connectTimeoutMs: number = DEFAULT_CONNECT_TIMEOUT_MS,
): Promise<IpcClient> {
  const socket = await connectSocket(socketPath, connectTimeoutMs);
  const decoder = new FrameDecoder();
  const pending: IpcFrame[] = [];
  let waiter: {
    resolve: (frame: IpcFrame) => void;
    reject: (err: Error) => void;
    timer?: ReturnType<typeof setTimeout>;
  } | null = null;
  let closed = false;

  const resolveNext = (frame: IpcFrame): void => {
    if (waiter) {
      const { resolve } = waiter;
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
    if (waiter) {
      const { reject, timer } = waiter;
      waiter = null;
      if (timer) {
        clearTimeout(timer);
      }
      reject(new Error("connection closed"));
    }
  });

  return {
    send(frame: unknown): void {
      socket.write(encodeFrame(frame));
    },
    nextFrame(timeoutMs: number | undefined = defaultTimeoutMs): Promise<IpcFrame> {
      const next = pending.shift();
      if (next) {
        return Promise.resolve(next);
      }
      if (closed) {
        return Promise.reject(new Error("connection closed"));
      }
      if (timeoutMs === undefined) {
        return new Promise((resolve, reject) => {
          waiter = { resolve, reject };
        });
      }
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          waiter = null;
          reject(new Error("timed out waiting for frame"));
        }, timeoutMs);
        waiter = {
          resolve: (frame) => {
            clearTimeout(timer);
            resolve(frame);
          },
          reject,
          timer,
        };
      });
    },
    close(): void {
      socket.destroy();
    },
  };
}
