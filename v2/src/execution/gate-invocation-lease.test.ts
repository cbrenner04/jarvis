import { describe, expect, test } from "bun:test";
import {
  acquireGateInvocationLease,
  awaitGateInvocationLease,
  gateInvocationAdmits,
  liveGateInvocationLeaseCount,
  MAX_CONCURRENT_AGENT_GATE_INVOCATIONS,
  subscribeGateInvocationLeaseReleased,
} from "./gate-invocation-lease.ts";

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
    const firstLease = await first;
    expect(order).toEqual(["first"]);
    firstLease.release();
    const secondLease = await second;
    expect(order).toEqual(["first", "second"]);
    secondLease.release();
    expect(liveGateInvocationLeaseCount()).toBe(0);
  });

  test("an aborted awaitGateInvocationLease rejects and leaves later waiters queued", async () => {
    const holder = acquireGateInvocationLease();
    expect(holder).toBeDefined();
    const abort = new AbortController();
    const aborted = awaitGateInvocationLease({ signal: abort.signal });
    const kept = awaitGateInvocationLease({});
    abort.abort();
    await expect(aborted).rejects.toThrow("gate invocation lease wait aborted");
    holder?.release();
    const lease = await kept;
    expect(lease).toBeDefined();
    lease.release();
    expect(liveGateInvocationLeaseCount()).toBe(0);
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
