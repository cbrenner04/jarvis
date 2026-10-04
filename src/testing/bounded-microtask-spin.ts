/** Yield via microtasks until `condition` is true or `maxIterations` is exhausted. */
export async function spinUntilMicrotask(
  condition: () => boolean,
  label: string,
  maxIterations = 10_000,
): Promise<void> {
  for (let i = 0; i < maxIterations; i += 1) {
    if (condition()) return;
    await Promise.resolve();
  }
  throw new Error(`spinUntilMicrotask: condition "${label}" not met after ${maxIterations} iterations`);
}
