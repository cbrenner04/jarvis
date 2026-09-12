import { describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type SocketLiveness, startIpcServer } from "../ipc/server.ts";
import { canUseUnixSockets } from "../testing/unix-socket.ts";
import {
  drainObservationEndsOnLiveness,
  observePredecessorDrain,
  type SchedulePollLoop,
  unionLiveRunIds,
} from "./daemon-drain-observer.ts";

const socketTest = test.skipIf(!canUseUnixSockets());

describe("drainObservationEndsOnLiveness", () => {
  test("ends observation when the socket reads absent or stale", () => {
    expect(drainObservationEndsOnLiveness("absent")).toBe(true);
    expect(drainObservationEndsOnLiveness("stale")).toBe(true);
  });

  test("does not end observation while the socket reads live", () => {
    expect(drainObservationEndsOnLiveness("live")).toBe(false);
  });
});

/**
 * Drives the observer's poll loop by hand instead of racing a real timer: `tick()` awaits one
 * complete poll, and `cleared` reports whether the loop was cancelled. The production default
 * (`scheduleRealPollLoop`) runs the first tick eagerly, which this mirrors by exposing it rather
 * than running it.
 */
function manualPollLoop(): { schedulePollLoop: SchedulePollLoop; tick: () => Promise<void>; cleared: () => boolean } {
  let onTick: (() => Promise<void>) | undefined;
  let cleared = false;
  return {
    schedulePollLoop: (fn) => {
      onTick = fn;
      return {
        clear: () => {
          cleared = true;
        },
      };
    },
    tick: async () => {
      if (onTick === undefined) throw new Error("poll loop was never scheduled");
      await onTick();
    },
    cleared: () => cleared,
  };
}

describe("observePredecessorDrain", () => {
  test("reports the predecessor's live run ids from list", async () => {
    const loop = manualPollLoop();
    const observer = observePredecessorDrain("irrelevant.sock", {
      schedulePollLoop: loop.schedulePollLoop,
      probeLiveness: async () => "live",
      listLiveRunIds: async () => ["run-1"],
    });
    try {
      expect(observer.liveRunIds().size).toBe(0);
      await loop.tick();
      expect(observer.liveRunIds().has("run-1")).toBe(true);
    } finally {
      observer.stop();
    }
  });

  test("retains the last known live set across a transient list RPC failure", async () => {
    const loop = manualPollLoop();
    let listCalls = 0;
    const observer = observePredecessorDrain("irrelevant.sock", {
      schedulePollLoop: loop.schedulePollLoop,
      probeLiveness: async () => "live",
      listLiveRunIds: async () => {
        listCalls += 1;
        if (listCalls === 2) throw new Error("timed out");
        return ["run-1"];
      },
    });
    try {
      await loop.tick();
      expect(observer.liveRunIds().has("run-1")).toBe(true);
      // The failed poll (call 2) must not clear the previously observed live set: the socket
      // itself is still live, so this is a stall, not a drain.
      await loop.tick();
      expect(listCalls).toBe(2);
      expect(observer.liveRunIds().has("run-1")).toBe(true);
      await loop.tick();
      expect(listCalls).toBe(3);
      expect(observer.liveRunIds().has("run-1")).toBe(true);
    } finally {
      observer.stop();
    }
  });

  test("ends observation and clears the live set once the predecessor's socket reads absent", async () => {
    const loop = manualPollLoop();
    let liveness: SocketLiveness = "live";
    let listCalls = 0;
    const observer = observePredecessorDrain("irrelevant.sock", {
      schedulePollLoop: loop.schedulePollLoop,
      probeLiveness: async () => liveness,
      listLiveRunIds: async () => {
        listCalls += 1;
        return ["run-1"];
      },
    });
    try {
      await loop.tick();
      expect(observer.liveRunIds().has("run-1")).toBe(true);
      liveness = "absent";
      await loop.tick();
      expect(observer.liveRunIds().size).toBe(0);
      // Polling actually stopped: the loop was cancelled, and a further tick issues no `list`.
      expect(loop.cleared()).toBe(true);
      const callsAtDrain = listCalls;
      await loop.tick();
      expect(listCalls).toBe(callsAtDrain);
    } finally {
      observer.stop();
    }
  });

  test("observing an already-exited endpoint completes without failing: the live set stays empty and no RPC is attempted", async () => {
    const loop = manualPollLoop();
    let listCalls = 0;
    const observer = observePredecessorDrain("irrelevant.sock", {
      schedulePollLoop: loop.schedulePollLoop,
      probeLiveness: async () => "absent",
      listLiveRunIds: async () => {
        listCalls += 1;
        return ["run-1"];
      },
    });
    try {
      await loop.tick();
      expect(observer.liveRunIds().size).toBe(0);
      expect(listCalls).toBe(0);
      expect(loop.cleared()).toBe(true);
    } finally {
      observer.stop();
    }
  });

  test("stop() called while a list RPC is in flight discards that RPC's result", async () => {
    const loop = manualPollLoop();
    let releaseList: ((ids: readonly string[]) => void) | undefined;
    const observer = observePredecessorDrain("irrelevant.sock", {
      schedulePollLoop: loop.schedulePollLoop,
      probeLiveness: async () => "live",
      listLiveRunIds: () =>
        new Promise<readonly string[]>((resolve) => {
          releaseList = resolve;
        }),
    });
    try {
      const inFlight = loop.tick();
      // The tick is parked inside `listLiveRunIds`; stop, then release it and await the same
      // promise, so the continuation is observed without a timer.
      await Promise.resolve();
      expect(releaseList).toBeDefined();
      observer.stop();
      releaseList?.(["run-1"]);
      await inFlight;
      expect(observer.liveRunIds().has("run-1")).toBe(false);
    } finally {
      observer.stop();
    }
  });

  socketTest("parses a real socket's well-formed list response into live run ids", async () => {
    const socketPath = join(tmpdir(), `jarvis-drain-observer-real-list-${process.pid}-${Date.now()}.sock`);
    rmSync(socketPath, { force: true });
    const server = await startIpcServer(socketPath, {
      list: () => ({
        kind: "response",
        result: { runs: [{ runId: "run-1", project: "p", branch: "b", status: "in-progress", isLive: true }] },
      }),
    });
    const loop = manualPollLoop();
    const observer = observePredecessorDrain(socketPath, {
      schedulePollLoop: loop.schedulePollLoop,
      probeLiveness: async () => "live",
    });
    try {
      // Exercises the real `defaultListLiveRunIds`, not an injected stand-in: a well-formed
      // response must parse and surface the run id, not be treated as malformed.
      await loop.tick();
      expect(observer.liveRunIds().has("run-1")).toBe(true);
    } finally {
      observer.stop();
      await server.close();
      rmSync(socketPath, { force: true });
    }
  });

  test("stop() is idempotent and safe to call multiple times", () => {
    const observer = observePredecessorDrain("irrelevant.sock", {
      schedulePollLoop: manualPollLoop().schedulePollLoop,
      probeLiveness: async () => "live",
      listLiveRunIds: async () => [],
    });
    observer.stop();
    observer.stop();
  });
});

describe("unionLiveRunIds", () => {
  test("unions run ids across every observer, deduplicating overlaps", () => {
    const a = { liveRunIds: () => new Set(["run-1", "run-2"]) };
    const b = { liveRunIds: () => new Set(["run-2", "run-3"]) };
    expect(unionLiveRunIds([a, b])).toEqual(new Set(["run-1", "run-2", "run-3"]));
  });

  test("returns an empty set for no observers", () => {
    expect(unionLiveRunIds([])).toEqual(new Set());
  });
});
