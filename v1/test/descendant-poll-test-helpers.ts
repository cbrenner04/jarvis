/** Harmless PID for onSpawned wiring tests — never use process.pid (timeouts kill -pgid). */
export const FAKE_AGENT_SPAWN_PID = 2_147_483_647;

/** Wait until `getCount()` reaches `minimum` (driven by poll callbacks, not wall-clock sleeps). */
export function waitForPollCount(getCount: () => number, minimum: number): Promise<void> {
  if (getCount() >= minimum) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const id = setInterval(() => {
      if (getCount() >= minimum) {
        clearInterval(id);
        resolve();
      }
    }, 1);
    id.unref?.();
  });
}
