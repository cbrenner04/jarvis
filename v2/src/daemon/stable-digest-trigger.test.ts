import { describe, expect, test } from "bun:test";
import {
  type ScheduleDigestSampling,
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
    startStableDigestTrigger("loaded", {
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
    await loop.tick();
    expect(calls).toBe(1);
    await loop.tick();
    expect(calls).toBe(2);
  });

  test("a rejected handoff resets the candidate and leaves the sampling loop usable", async () => {
    const loop = manualSamplingLoop();
    let calls = 0;
    startStableDigestTrigger("loaded", {
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
});
