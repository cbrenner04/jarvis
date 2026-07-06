import type { IpcClient } from "../ipc/client.ts";
import type { IpcFrame } from "../ipc/types.ts";

/**
 * Ungated (default): `nextFrame()` drains queued frames immediately regardless of `send()`
 * calls, throwing once empty. Gated: a frame delivers only once a matching `send()` has
 * occurred — needed by readers that issue multiple `nextFrame()` calls per client that would
 * otherwise race ahead of the test's `send()` calls.
 */
export function makeIpcClient(frames: unknown[], options: { gated?: boolean; sent?: unknown[] } = {}): IpcClient {
  const { gated = false, sent = [] } = options;
  const queue = [...frames] as IpcFrame[];
  let sentCount = 0;
  let deliveredCount = 0;
  let waiter:
    | {
        resolve: (frame: IpcFrame) => void;
        reject: (error: Error) => void;
      }
    | undefined;
  let closed = false;

  return {
    send(frame: unknown): void {
      sent.push(frame);
      if (!gated) return;
      sentCount += 1;
      if (waiter && deliveredCount < sentCount) {
        const next = queue.shift();
        if (next !== undefined) {
          deliveredCount += 1;
          const pending = waiter;
          waiter = undefined;
          pending.resolve(next);
        }
      }
    },
    async nextFrame(): Promise<IpcFrame> {
      if (!gated) {
        const frame = queue.shift();
        if (frame === undefined) throw new Error("connection closed");
        return frame;
      }
      if (deliveredCount < sentCount) {
        const frame = queue.shift();
        if (frame === undefined) throw new Error("connection closed");
        deliveredCount += 1;
        return frame;
      }
      if (closed) throw new Error("connection closed");
      return new Promise<IpcFrame>((resolve, reject) => {
        waiter = { resolve, reject };
      });
    },
    close(): void {
      closed = true;
      waiter?.reject(new Error("connection closed"));
      waiter = undefined;
    },
  };
}

/** Queuing deferred client: a `push`ed frame is delivered immediately if `nextFrame()` is
 * already pending, otherwise queued for the next call. */
export function createDeferredIpcClient(sent: unknown[] = []): { client: IpcClient; push: (frame: IpcFrame) => void } {
  const queue: IpcFrame[] = [];
  let waiter:
    | {
        resolve: (frame: IpcFrame) => void;
        reject: (error: Error) => void;
      }
    | undefined;
  let closed = false;

  const push = (frame: IpcFrame): void => {
    if (closed) return;
    if (waiter) {
      const pending = waiter;
      waiter = undefined;
      pending.resolve(frame);
      return;
    }
    queue.push(frame);
  };

  const client: IpcClient = {
    send(frame: unknown): void {
      sent.push(frame);
    },
    async nextFrame(): Promise<IpcFrame> {
      const frame = queue.shift();
      if (frame) return frame;
      if (closed) throw new Error("connection closed");
      return new Promise<IpcFrame>((resolve, reject) => {
        waiter = { resolve, reject };
      });
    },
    close(): void {
      closed = true;
      waiter?.reject(new Error("connection closed"));
      waiter = undefined;
    },
  };

  return { client, push };
}
