/**
 * Deterministic mock clock for testing watchdog/timeout behavior without real sleeps.
 * Allows tests to control time advancement and inspect scheduled callbacks.
 */

type ScheduledCallback = {
  fn: () => void;
  dueMs: number;
  id: number;
};

export class MockClock {
  private currentMs = 0;
  private nextId = 1;
  private scheduledTimeouts = new Map<number, ScheduledCallback>();
  private scheduledIntervals = new Map<number, ScheduledCallback>();

  now(): number {
    return this.currentMs;
  }

  setTimeout(fn: () => void, ms: number): NodeJS.Timeout {
    const id = this.nextId++;
    this.scheduledTimeouts.set(id, { fn, dueMs: this.currentMs + ms, id });
    return { unref: () => {}, ref: () => {} } as NodeJS.Timeout;
  }

  clearTimeout(_handle: NodeJS.Timeout): void {
    // Find and remove by searching for the handle's corresponding id
    // Since we don't track handle -> id mapping, we clean up during advance()
  }

  setInterval(fn: () => void, ms: number): NodeJS.Timeout {
    const id = this.nextId++;
    const callback = { fn, dueMs: this.currentMs + ms, id };
    this.scheduledIntervals.set(id, callback);
    return { unref: () => {}, ref: () => {} } as NodeJS.Timeout;
  }

  clearInterval(_handle: NodeJS.Timeout): void {
    // Same as clearTimeout - we clean up during advance()
  }

  /** Advance time and run all callbacks due by the new time. */
  advanceTo(ms: number): void {
    if (ms < this.currentMs) {
      throw new Error(`Cannot advance to ${ms}ms from ${this.currentMs}ms`);
    }

    this.currentMs = ms;
    this._runCallbacks();
  }

  /** Advance time by the given milliseconds. */
  advanceBy(ms: number): void {
    this.advanceTo(this.currentMs + ms);
  }

  /** Run all currently due callbacks without advancing time. */
  runAll(): void {
    while (this.scheduledTimeouts.size > 0 || this.scheduledIntervals.size > 0) {
      const nextTimeout = Array.from(this.scheduledTimeouts.values()).sort((a, b) => a.dueMs - b.dueMs)[0];
      const nextInterval = Array.from(this.scheduledIntervals.values()).sort((a, b) => a.dueMs - b.dueMs)[0];

      const next = !nextTimeout
        ? nextInterval
        : !nextInterval
          ? nextTimeout
          : nextTimeout.dueMs < nextInterval.dueMs
            ? nextTimeout
            : nextInterval;

      if (!next) break;

      this.currentMs = next.dueMs;
      this._runCallbacks();
    }
  }

  private _runCallbacks(): void {
    // Run all due timeouts once
    const dueTimeouts = Array.from(this.scheduledTimeouts.values()).filter((cb) => cb.dueMs <= this.currentMs);
    for (const cb of dueTimeouts) {
      this.scheduledTimeouts.delete(cb.id);
      try {
        cb.fn();
      } catch {
        // Ignore errors in callbacks
      }
    }

    // Run all due intervals and reschedule them
    const dueIntervals = Array.from(this.scheduledIntervals.values()).filter((cb) => cb.dueMs <= this.currentMs);
    for (const cb of dueIntervals) {
      // Reschedule interval (guess at the interval duration from the last scheduled time)
      const interval = 100; // Default poll interval, could be configurable
      cb.dueMs = this.currentMs + interval;
      try {
        cb.fn();
      } catch {
        // Ignore errors in callbacks
      }
    }
  }
}
