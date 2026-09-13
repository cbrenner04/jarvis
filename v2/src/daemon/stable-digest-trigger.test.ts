import { describe, expect, test } from "bun:test";
import {
  isBackingOff,
  type ScheduleDigestSampling,
  selfHandoffBackoffMs,
  shouldSampleNow,
  shouldTriggerHandoff,
  startStableDigestTrigger,
} from "./stable-digest-trigger.ts";

function manualSamplingLoop(): {
  scheduleSampling: ScheduleDigestSampling;
  tick: () => Promise<void>;
  stopped: () => boolean;
} {
  let onTick: (() => Promise<void>) | undefined;
  let stopped = false;
  return {
    scheduleSampling: (tick) => {
      onTick = tick;
      return {
        stop: () => {
          stopped = true;
        },
      };
    },
    tick: async () => {
      if (onTick === undefined) throw new Error("sampling loop was never scheduled");
      await onTick();
    },
    stopped: () => stopped,
  };
}

function sequenceSampler(values: Array<string | Error>): () => Promise<string> {
  return async () => {
    const value = values.shift();
    if (value === undefined) throw new Error("sample sequence exhausted");
    if (value instanceof Error) throw value;
    return value;
  };
}

describe("stable digest predicates", () => {
  test("triggers only for a repeated divergent candidate", () => {
    expect(shouldTriggerHandoff("changed", "loaded", "changed")).toBe(true);
    expect(shouldTriggerHandoff("first", "loaded", "second")).toBe(false);
    expect(shouldTriggerHandoff("loaded", "loaded", "loaded")).toBe(false);
    expect(shouldTriggerHandoff("unknown", "loaded", "unknown")).toBe(false);
  });

  test("backoff is 1m doubling per consecutive failure, capped at 30m", () => {
    expect(selfHandoffBackoffMs(0)).toBe(0);
    expect(selfHandoffBackoffMs(1)).toBe(60_000);
    expect(selfHandoffBackoffMs(2)).toBe(120_000);
    expect(selfHandoffBackoffMs(5)).toBe(960_000);
    expect(selfHandoffBackoffMs(6)).toBe(1_800_000);
    expect(selfHandoffBackoffMs(20)).toBe(1_800_000);
  });

  test("backs off only the failed digest and only until retryAt", () => {
    const failure = { digest: "changed", failures: 1, retryAt: 100 };
    expect(isBackingOff(failure, "changed", 99)).toBe(true);
    expect(isBackingOff(failure, "changed", 100)).toBe(false);
    expect(isBackingOff(failure, "other", 99)).toBe(false);
    expect(isBackingOff(undefined, "changed", 0)).toBe(false);
  });

  test("samples only while no handoff is in flight", () => {
    expect(shouldSampleNow({ handoffInFlight: false })).toBe(true);
    expect(shouldSampleNow({ handoffInFlight: true })).toBe(false);
  });
});

describe("startStableDigestTrigger", () => {
  test("starts one handoff after two consecutive samples of the same divergent digest", async () => {
    const loop = manualSamplingLoop();
    const calls: Array<[string, string]> = [];
    const trigger = startStableDigestTrigger("loaded", {
      sample: sequenceSampler(["changed", "changed"]),
      startHandoff: async (loaded, observed) => {
        calls.push([loaded, observed]);
        return "committed";
      },
      scheduleSampling: loop.scheduleSampling,
    });

    await loop.tick();
    await loop.tick();

    expect(calls).toEqual([["loaded", "changed"]]);
    trigger.stop();
    expect(loop.stopped()).toBe(true);
  });

  test("a divergent sample followed by the loaded digest does not start a handoff", async () => {
    const loop = manualSamplingLoop();
    let calls = 0;
    startStableDigestTrigger("loaded", {
      sample: sequenceSampler(["changed", "loaded"]),
      startHandoff: async () => {
        calls += 1;
        return "committed";
      },
      scheduleSampling: loop.scheduleSampling,
    });

    await loop.tick();
    await loop.tick();

    expect(calls).toBe(0);
  });

  test("different divergent samples require the newest value to repeat consecutively", async () => {
    const loop = manualSamplingLoop();
    const observed: string[] = [];
    startStableDigestTrigger("loaded", {
      sample: sequenceSampler(["first", "second", "second"]),
      startHandoff: async (_loaded, digest) => {
        observed.push(digest);
        return "committed";
      },
      scheduleSampling: loop.scheduleSampling,
    });

    await loop.tick();
    await loop.tick();
    expect(observed).toEqual([]);
    await loop.tick();
    expect(observed).toEqual(["second"]);
  });

  test("does not start another handoff while the first is unresolved", async () => {
    const loop = manualSamplingLoop();
    let calls = 0;
    let resolveHandoff: ((outcome: "committed") => void) | undefined;
    startStableDigestTrigger("loaded", {
      sample: async () => "changed",
      startHandoff: () => {
        calls += 1;
        return new Promise((resolve) => {
          resolveHandoff = resolve;
        });
      },
      scheduleSampling: loop.scheduleSampling,
    });

    await loop.tick();
    const inFlight = loop.tick();
    await Promise.resolve();
    expect(calls).toBe(1);
    await loop.tick();
    await loop.tick();
    expect(calls).toBe(1);
    resolveHandoff?.("committed");
    await inFlight;
  });

  test("a rollback requires two fresh matching samples before retry", async () => {
    const loop = manualSamplingLoop();
    let calls = 0;
    let clock = 0;
    startStableDigestTrigger("loaded", {
      now: () => clock,
      sample: async () => "changed",
      startHandoff: async () => {
        calls += 1;
        return "rolled_back";
      },
      scheduleSampling: loop.scheduleSampling,
    });

    await loop.tick();
    await loop.tick();
    expect(calls).toBe(1);
    clock = selfHandoffBackoffMs(1);
    await loop.tick();
    expect(calls).toBe(1);
    await loop.tick();
    expect(calls).toBe(2);
  });

  test("a rejected handoff resets the candidate and leaves the sampling loop usable", async () => {
    const loop = manualSamplingLoop();
    let calls = 0;
    let clock = 0;
    startStableDigestTrigger("loaded", {
      now: () => clock,
      sample: async () => "changed",
      startHandoff: async () => {
        calls += 1;
        if (calls === 1) throw new Error("spawn failed");
        return "committed";
      },
      scheduleSampling: loop.scheduleSampling,
    });

    await loop.tick();
    await loop.tick();
    expect(calls).toBe(1);
    clock = selfHandoffBackoffMs(1);
    await loop.tick();
    expect(calls).toBe(1);
    await loop.tick();
    expect(calls).toBe(2);
  });

  test("failed and unknown samples clear the pending candidate without triggering", async () => {
    const loop = manualSamplingLoop();
    let calls = 0;
    startStableDigestTrigger("loaded", {
      sample: sequenceSampler(["changed", new Error("unreadable"), "changed", "unknown", "changed"]),
      startHandoff: async () => {
        calls += 1;
        return "committed";
      },
      scheduleSampling: loop.scheduleSampling,
    });

    await loop.tick();
    await loop.tick();
    await loop.tick();
    expect(calls).toBe(0);
    await loop.tick();
    await loop.tick();
    expect(calls).toBe(0);
  });

  test("a failed digest waits out exponential backoff even with fresh matching samples, then retries", async () => {
    const loop = manualSamplingLoop();
    let calls = 0;
    let clock = 0;
    startStableDigestTrigger("loaded", {
      now: () => clock,
      sample: async () => "changed",
      startHandoff: async () => {
        calls += 1;
        return "rolled_back";
      },
      scheduleSampling: loop.scheduleSampling,
    });

    await loop.tick();
    await loop.tick();
    expect(calls).toBe(1);

    // Two fresh matching samples inside the 1m window do not retry.
    clock = 59_999;
    await loop.tick();
    await loop.tick();
    expect(calls).toBe(1);

    clock = 60_000;
    await loop.tick();
    expect(calls).toBe(2);

    // Second failure doubles the window from the failure time.
    clock = 60_000 + 119_999;
    await loop.tick();
    await loop.tick();
    expect(calls).toBe(2);
    clock = 60_000 + 120_000;
    await loop.tick();
    expect(calls).toBe(3);
  });

  test("a different divergent digest is not held by another digest's backoff", async () => {
    const loop = manualSamplingLoop();
    const observed: string[] = [];
    startStableDigestTrigger("loaded", {
      now: () => 0,
      sample: sequenceSampler(["first", "first", "second", "second"]),
      startHandoff: async (_loaded, digest) => {
        observed.push(digest);
        return "rolled_back";
      },
      scheduleSampling: loop.scheduleSampling,
    });

    for (let i = 0; i < 4; i++) await loop.tick();
    expect(observed).toEqual(["first", "second"]);
  });
});
