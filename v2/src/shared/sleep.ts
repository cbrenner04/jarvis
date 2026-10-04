/**
 * Timer-backed wait that never keeps the process alive and resolves early when `signal` aborts
 * (an already-aborted signal resolves immediately). The one sleep helper for daemon and
 * persistence code; tests inject their own clocks instead of calling this.
 */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const onAbort = (): void => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    timer.unref?.();
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
