import type { AsyncSubprocessRunner } from "../../../shared/subprocess.ts";

/** Holds the first delegated `runAsync` until `release()`; later calls pass through immediately. */
export function createHoldableAsyncSubprocessRunner(inner: AsyncSubprocessRunner): {
  runner: AsyncSubprocessRunner;
  whenPending: () => Promise<void>;
  release: () => void;
} {
  let releaseHeld: (() => void) | undefined;
  let notifyPending: (() => void) | undefined;
  const pendingPromise = new Promise<void>((resolve) => {
    notifyPending = resolve;
  });
  let holdNext = true;

  const runner: AsyncSubprocessRunner = {
    async runAsync(cmd, args, cwd, options) {
      if (holdNext) {
        holdNext = false;
        await new Promise<void>((resolve) => {
          releaseHeld = resolve;
          notifyPending?.();
          notifyPending = undefined;
        });
      }
      return inner.runAsync(cmd, args, cwd, options);
    },
  };

  return {
    runner,
    whenPending: () => pendingPromise,
    release: () => {
      releaseHeld?.();
      releaseHeld = undefined;
    },
  };
}
