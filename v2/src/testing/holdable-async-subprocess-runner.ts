import type { AsyncSubprocessRunner } from "../../../shared/subprocess.ts";

/** Holds the first call to `inner` until `release()`; later calls pass through immediately. */
export function createHoldableAsyncFn<A extends unknown[], R>(
  inner: (...args: A) => Promise<R>,
): {
  fn: (...args: A) => Promise<R>;
  whenPending: () => Promise<void>;
  release: () => void;
} {
  let releaseHeld: (() => void) | undefined;
  let notifyPending: (() => void) | undefined;
  const pendingPromise = new Promise<void>((resolve) => {
    notifyPending = resolve;
  });
  let holdNext = true;

  const fn = async (...args: A): Promise<R> => {
    if (holdNext) {
      holdNext = false;
      await new Promise<void>((resolve) => {
        releaseHeld = resolve;
        notifyPending?.();
        notifyPending = undefined;
      });
    }
    return inner(...args);
  };

  return {
    fn,
    whenPending: () => pendingPromise,
    release: () => {
      releaseHeld?.();
      releaseHeld = undefined;
    },
  };
}

/** Holds the first delegated `runAsync` until `release()`; later calls pass through immediately. */
export function createHoldableAsyncSubprocessRunner(inner: AsyncSubprocessRunner): {
  runner: AsyncSubprocessRunner;
  whenPending: () => Promise<void>;
  release: () => void;
} {
  const holdable = createHoldableAsyncFn(inner.runAsync.bind(inner));
  return {
    runner: { runAsync: holdable.fn },
    whenPending: holdable.whenPending,
    release: holdable.release,
  };
}
