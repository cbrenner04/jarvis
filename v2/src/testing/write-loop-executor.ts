import type { WriteLoopInput } from "../execution/write-loop.ts";

type PendingExecutorRun = {
  signal: AbortSignal;
  pauseSignal: AbortSignal;
  release: (mode: "settle" | "abort") => void;
};

export function createFakeWriteLoopExecutor(onStart?: (input: WriteLoopInput) => void) {
  const pending: PendingExecutorRun[] = [];

  const executor = async (input: WriteLoopInput, signal: AbortSignal, pauseSignal: AbortSignal): Promise<void> => {
    onStart?.(input);
    await new Promise<void>((resolve) => {
      let released = false;
      const release = (mode: "settle" | "abort"): void => {
        void mode;
        if (released) {
          return;
        }
        released = true;
        resolve();
      };
      pending.push({ signal, pauseSignal, release });
      signal.addEventListener("abort", () => release("abort"), { once: true });
    });
  };

  const drainPending = (mode: "settle" | "abort"): void => {
    while (pending.length > 0) {
      pending.shift()?.release(mode);
    }
  };

  return {
    executor,
    settleAll: (): void => drainPending("settle"),
    abortAll: (): void => drainPending("abort"),
    settleFirst: (): void => pending.shift()?.release("settle"),
    pendingCount: (): number => pending.length,
    isPauseSignalTriggered: (): boolean => pending.some((run) => run.pauseSignal.aborted),
    isAbortSignalTriggered: (): boolean => pending.some((run) => run.signal.aborted),
  };
}

export type FakeWriteLoopExecutor = ReturnType<typeof createFakeWriteLoopExecutor>;
