import { describe, expect, spyOn, test } from "bun:test";
import {
  acquireGateInvocationLease,
  awaitGateInvocationLease,
  gateInvocationAdmits,
  liveGateInvocationLeaseCount,
  MAX_CONCURRENT_AGENT_GATE_INVOCATIONS,
  subscribeGateInvocationLeaseReleased,
} from "./gate-invocation-lease.ts";

/** Settle pending microtasks so a missed grant fails the assertion instead of hanging an unbounded await. */
async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
}

describe("gate-invocation-lease", () => {
  test("acquireGateInvocationLease refuses when the cap is held", () => {
    const holder = acquireGateInvocationLease();
    expect(holder).toBeDefined();
    expect(acquireGateInvocationLease()).toBeUndefined();
    holder?.release();
    expect(liveGateInvocationLeaseCount()).toBe(0);
  });

  test("gateInvocationAdmits bounds admission by the limit it is given", () => {
    expect(gateInvocationAdmits(0, 2)).toBe(true);
    expect(gateInvocationAdmits(1, 2)).toBe(true);
    expect(gateInvocationAdmits(2, 2)).toBe(false);
    const leases: Array<ReturnType<typeof acquireGateInvocationLease>> = [];
    for (let i = 0; i < MAX_CONCURRENT_AGENT_GATE_INVOCATIONS; i += 1) {
      const lease = acquireGateInvocationLease();
      expect(lease).toBeDefined();
      leases.push(lease);
    }
    expect(acquireGateInvocationLease()).toBeUndefined();
    for (const lease of leases) lease?.release();
    expect(liveGateInvocationLeaseCount()).toBe(0);
  });

  test("awaitGateInvocationLease grants waiters in FIFO order", async () => {
    const holder = acquireGateInvocationLease();
    expect(holder).toBeDefined();
    const order: string[] = [];
    const first = awaitGateInvocationLease({}).then((lease) => {
      order.push("first");
      return lease;
    });
    const second = awaitGateInvocationLease({}).then((lease) => {
      order.push("second");
      return lease;
    });
    await Promise.resolve();
    expect(order).toEqual([]);
    holder?.release();
    await flushMicrotasks();
    expect(order).toEqual(["first"]);
    const firstLease = await first;
    firstLease.release();
    await flushMicrotasks();
    expect(order).toEqual(["first", "second"]);
    const secondLease = await second;
    secondLease.release();
    expect(liveGateInvocationLeaseCount()).toBe(0);
  });

  test("an aborted awaitGateInvocationLease rejects and leaves later waiters queued", async () => {
    const holder = acquireGateInvocationLease();
    expect(holder).toBeDefined();
    const abort = new AbortController();
    const aborted = awaitGateInvocationLease({ signal: abort.signal });
    let granted = false;
    const kept = awaitGateInvocationLease({}).then((lease) => {
      granted = true;
      return lease;
    });
    abort.abort();
    await expect(aborted).rejects.toThrow("gate invocation lease wait aborted");
    holder?.release();
    await flushMicrotasks();
    expect(granted).toBe(true);
    const lease = await kept;
    expect(lease).toBeDefined();
    lease.release();
    expect(liveGateInvocationLeaseCount()).toBe(0);
  });

  test("an aborted waiter is dequeued so cap release does not grant the settled waiter", async () => {
    const holder = acquireGateInvocationLease();
    expect(holder).toBeDefined();
    let releaseNotifications = 0;
    const unsubscribe = subscribeGateInvocationLeaseReleased(() => {
      releaseNotifications += 1;
    });
    try {
      const abort = new AbortController();
      const aborted = awaitGateInvocationLease({ signal: abort.signal });
      await Promise.resolve();
      abort.abort();
      await expect(aborted).rejects.toThrow("gate invocation lease wait aborted");

      const notificationsBeforeRelease = releaseNotifications;
      holder?.release();
      await flushMicrotasks();
      expect(releaseNotifications - notificationsBeforeRelease).toBe(1);
      expect(liveGateInvocationLeaseCount()).toBe(0);
    } finally {
      unsubscribe();
    }
  });

  test("awaitGateInvocationLease rejects when timeoutMs elapses", async () => {
    const holder = acquireGateInvocationLease();
    expect(holder).toBeDefined();
    await expect(awaitGateInvocationLease({ timeoutMs: 5 })).rejects.toThrow(
      "gate invocation lease wait timed out after 5ms",
    );
    holder?.release();
    expect(liveGateInvocationLeaseCount()).toBe(0);
  });

  test("awaitGateInvocationLease removes its abort listener when the wait settles after a signal was registered", async () => {
    const holder = acquireGateInvocationLease();
    expect(holder).toBeDefined();
    const abort = new AbortController();
    const removeListenerSpy = spyOn(abort.signal, "removeEventListener");
    try {
      const granted = awaitGateInvocationLease({ signal: abort.signal });
      holder?.release();
      const lease = await granted;
      expect(removeListenerSpy.mock.calls.length).toBe(1);
      lease.release();
    } finally {
      removeListenerSpy.mockRestore();
      holder?.release();
      expect(liveGateInvocationLeaseCount()).toBe(0);
    }
  });

  test("awaitGateInvocationLease clears its timeout when granted before expiry", async () => {
    const holder = acquireGateInvocationLease();
    expect(holder).toBeDefined();
    const clearTimeoutSpy = spyOn(globalThis, "clearTimeout");
    try {
      let grantedLease: Awaited<ReturnType<typeof awaitGateInvocationLease>> | undefined;
      const granted = awaitGateInvocationLease({ timeoutMs: 60_000 }).then((lease) => {
        grantedLease = lease;
        return lease;
      });
      holder?.release();
      await flushMicrotasks();
      expect(grantedLease).toBeDefined();
      const lease = await granted;
      expect(clearTimeoutSpy).toHaveBeenCalled();
      lease.release();
    } finally {
      clearTimeoutSpy.mockRestore();
      holder?.release();
      expect(liveGateInvocationLeaseCount()).toBe(0);
    }
  });

  test("a release notifies subscribers once, asynchronously, after the lease is deleted", async () => {
    const observed: number[] = [];
    const unsubscribe = subscribeGateInvocationLeaseReleased(() => {
      observed.push(liveGateInvocationLeaseCount());
    });
    try {
      const lease = acquireGateInvocationLease();
      expect(lease).toBeDefined();
      lease?.release();
      expect(observed).toEqual([]);
      await Promise.resolve();
      expect(observed).toEqual([0]);
      lease?.release();
      await Promise.resolve();
      expect(observed).toEqual([0]);
    } finally {
      unsubscribe();
    }
  });
});
