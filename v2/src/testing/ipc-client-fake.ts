import type { IpcClient } from "../ipc/client.ts";
import type { IpcFrame } from "../ipc/types.ts";

type FrameWaiter = {
  resolve: (frame: IpcFrame) => void;
  reject: (error: Error) => void;
};

/**
 * Ungated (default): `nextFrame()` drains queued frames immediately regardless of `send()`
 * calls, throwing once empty. `gated`: a frame delivers only once a matching `send()` has
 * occurred — needed by readers that issue multiple `nextFrame()` calls per client that would
 * otherwise race ahead of the test's `send()` calls. `deferred`: an empty queue blocks
 * `nextFrame()` instead of throwing; `push()` feeds it — delivered immediately if a
 * `nextFrame()` is already pending, otherwise queued for the next call.
 */
export function makeIpcClient(
  frames: unknown[],
  options: { gated?: boolean; deferred?: boolean; sent?: unknown[] } = {},
): IpcClient & { push: (frame: IpcFrame) => void } {
  const { gated = false, deferred = false, sent = [] } = options;
  const queue = [...frames] as IpcFrame[];
  let sentCount = 0;
  let deliveredCount = 0;
  let waiter: FrameWaiter | undefined;
  let closed = false;

  const resolveWaiter = (frame: IpcFrame): void => {
    const pending = waiter as FrameWaiter;
    waiter = undefined;
    pending.resolve(frame);
  };
  const deliverable = (): boolean => !gated || deliveredCount < sentCount;

  return {
    push(frame: IpcFrame): void {
      if (closed) return;
      if (waiter && deliverable()) {
        if (gated) deliveredCount += 1;
        resolveWaiter(frame);
        return;
      }
      queue.push(frame);
    },
    send(frame: unknown): void {
      sent.push(frame);
      if (!gated) return;
      sentCount += 1;
      if (waiter && deliveredCount < sentCount) {
        const next = queue.shift();
        if (next !== undefined) {
          deliveredCount += 1;
          resolveWaiter(next);
        }
      }
    },
    async nextFrame(): Promise<IpcFrame> {
      if (deliverable()) {
        const frame = queue.shift();
        if (frame !== undefined) {
          if (gated) deliveredCount += 1;
          return frame;
        }
        if (!deferred) throw new Error("connection closed");
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
