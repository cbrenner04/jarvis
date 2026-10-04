import { describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type SocketLiveness, startIpcServer } from "../ipc/server.ts";
import { canUseUnixSockets } from "../testing/unix-socket.ts";
import {
  drainObservationEndsOnLiveness,
  observePredecessorDrain,
  observeRunOwnership,
  type SchedulePollLoop,
  unionLiveRunIds,
} from "./daemon-drain-observer.ts";
import type { DaemonListRunRow } from "./daemon-wire.ts";

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

  socketTest("prefers a real socket's live_run_ids over its full list projection", async () => {
    const socketPath = join(tmpdir(), `jarvis-drain-observer-live-ids-${process.pid}-${Date.now()}.sock`);
    rmSync(socketPath, { force: true });
    let listCalls = 0;
    const server = await startIpcServer(socketPath, {
      live_run_ids: () => ({ kind: "response", result: { runIds: ["run-live"] } }),
      list: () => {
        listCalls++;
        return { kind: "response", result: { runs: [] } };
      },
    });
    const loop = manualPollLoop();
    const observer = observePredecessorDrain(socketPath, {
      schedulePollLoop: loop.schedulePollLoop,
      probeLiveness: async () => "live",
    });
    try {
      await loop.tick();
      expect(observer.liveRunIds().has("run-live")).toBe(true);
      expect(listCalls).toBe(0);
    } finally {
      observer.stop();
      await server.close();
      rmSync(socketPath, { force: true });
    }
  });

  // A server without `live_run_ids` (legacy keyed peer) exercises the `list` fallback.
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

/** Minimal `list_owned` row fixture — only the fields these tests inspect matter. */
function ownedRow(runId: string): DaemonListRunRow {
  return { runId, project: "p", branch: "b", status: "in-progress", isLive: true, createdAt: 0 };
}

describe("observeRunOwnership", () => {
  test("holds a run's owner row only while the predecessor's poll reports it live", async () => {
    const loop = manualPollLoop();
    const directory = observeRunOwnership("irrelevant.sock", {
      schedulePollLoop: loop.schedulePollLoop,
      probeLiveness: async () => "live",
      listOwnedRuns: async () => [ownedRow("run-1")],
    });
    try {
      expect(directory.ownerRow("run-1")).toBeUndefined();
      await loop.tick();
      expect(directory.ownerRow("run-1")?.runId).toBe("run-1");
    } finally {
      directory.stop();
    }
  });

  test("clears a run's entry once the predecessor no longer reports it in list_owned", async () => {
    const loop = manualPollLoop();
    let rows: DaemonListRunRow[] = [ownedRow("run-1")];
    const directory = observeRunOwnership("irrelevant.sock", {
      schedulePollLoop: loop.schedulePollLoop,
      probeLiveness: async () => "live",
      listOwnedRuns: async () => rows,
    });
    try {
      await loop.tick();
      expect(directory.ownerRow("run-1")).toBeDefined();
      rows = [];
      await loop.tick();
      expect(directory.ownerRow("run-1")).toBeUndefined();
    } finally {
      directory.stop();
    }
  });

  test("a slow older reply landing after a newer clearing reply does not resurrect the row", async () => {
    const loop = manualPollLoop();
    const replies: ((rows: DaemonListRunRow[]) => void)[] = [];
    const directory = observeRunOwnership("irrelevant.sock", {
      schedulePollLoop: loop.schedulePollLoop,
      probeLiveness: async () => "live",
      listOwnedRuns: () => new Promise((resolve) => replies.push(resolve)),
    });
    try {
      const older = loop.tick();
      const newer = loop.tick();
      while (replies.length < 2) await Promise.resolve();
      replies[1]?.([]);
      await newer;
      replies[0]?.([ownedRow("run-1")]);
      await older;
      expect(directory.ownerRow("run-1")).toBeUndefined();
    } finally {
      directory.stop();
    }
  });

  // Contrast with `observePredecessorDrain`'s advisory `unionLiveRunIds`, which carries no row
  // data and retains its last known live set across a transient `list` RPC failure (see the
  // "retains the last known live set" test above): a poll failure here must never leave a stale
  // owner row observable, so this directory clears everything instead.
  test("clears every cached row on a list_owned RPC failure, unlike the advisory live-id observer's retention", async () => {
    const loop = manualPollLoop();
    let listCalls = 0;
    const directory = observeRunOwnership("irrelevant.sock", {
      schedulePollLoop: loop.schedulePollLoop,
      probeLiveness: async () => "live",
      listOwnedRuns: async () => {
        listCalls += 1;
        if (listCalls === 2) throw new Error("timed out");
        return [ownedRow("run-1")];
      },
    });
    try {
      await loop.tick();
      expect(directory.ownerRow("run-1")).toBeDefined();
      await loop.tick();
      expect(listCalls).toBe(2);
      expect(directory.ownerRow("run-1")).toBeUndefined();
    } finally {
      directory.stop();
    }
  });

  test("clears every cached row once the predecessor's socket reads absent or stale", async () => {
    const loop = manualPollLoop();
    let liveness: SocketLiveness = "live";
    const directory = observeRunOwnership("irrelevant.sock", {
      schedulePollLoop: loop.schedulePollLoop,
      probeLiveness: async () => liveness,
      listOwnedRuns: async () => [ownedRow("run-1")],
    });
    try {
      await loop.tick();
      expect(directory.ownerRow("run-1")).toBeDefined();
      liveness = "absent";
      await loop.tick();
      expect(directory.ownerRow("run-1")).toBeUndefined();
      expect(loop.cleared()).toBe(true);
    } finally {
      directory.stop();
    }
  });

  test("stop() called while a list_owned RPC is in flight discards that RPC's result", async () => {
    const loop = manualPollLoop();
    let releaseList: ((rows: readonly DaemonListRunRow[]) => void) | undefined;
    const directory = observeRunOwnership("irrelevant.sock", {
      schedulePollLoop: loop.schedulePollLoop,
      probeLiveness: async () => "live",
      listOwnedRuns: () =>
        new Promise<readonly DaemonListRunRow[]>((resolve) => {
          releaseList = resolve;
        }),
    });
    try {
      const inFlight = loop.tick();
      await Promise.resolve();
      expect(releaseList).toBeDefined();
      directory.stop();
      releaseList?.([ownedRow("run-1")]);
      await inFlight;
      expect(directory.ownerRow("run-1")).toBeUndefined();
    } finally {
      directory.stop();
    }
  });

  test("with no predecessor socket path, holds no row and never polls", () => {
    let scheduled = false;
    const directory = observeRunOwnership(undefined, {
      schedulePollLoop: () => {
        scheduled = true;
        return { clear: () => undefined };
      },
    });
    expect(directory.ownerRow("run-1")).toBeUndefined();
    expect(scheduled).toBe(false);
    directory.stop();
  });

  test("stop() is idempotent and safe to call multiple times", () => {
    const directory = observeRunOwnership("irrelevant.sock", {
      schedulePollLoop: manualPollLoop().schedulePollLoop,
      probeLiveness: async () => "live",
      listOwnedRuns: async () => [],
    });
    directory.stop();
    directory.stop();
  });

  test("resolveOwner refreshes initial and failed snapshots but trusts a successful empty snapshot", async () => {
    const loop = manualPollLoop();
    let calls = 0;
    const directory = observeRunOwnership("irrelevant.sock", {
      schedulePollLoop: loop.schedulePollLoop,
      probeLiveness: async () => "live",
      listOwnedRuns: async () => {
        calls += 1;
        if (calls === 2) throw new Error("transient failure");
        return calls === 1 ? [ownedRow("run-1")] : [];
      },
    });
    try {
      expect(await directory.resolveOwner?.("run-1")).toBe(true);
      expect(calls).toBe(1);
      expect(await directory.resolveOwner?.("absent-run")).toBe(false);
      expect(calls).toBe(1);
      await loop.tick();
      await expect(directory.resolveOwner?.("run-1")).resolves.toBe(false);
      expect(calls).toBe(3);
    } finally {
      directory.stop();
    }
  });

  test("resolveOwner propagates a failed authoritative refresh", async () => {
    const directory = observeRunOwnership("irrelevant.sock", {
      schedulePollLoop: manualPollLoop().schedulePollLoop,
      probeLiveness: async () => "live",
      listOwnedRuns: async () => {
        throw new Error("refresh failed");
      },
    });
    try {
      await expect(directory.resolveOwner?.("run-1")).rejects.toThrow("refresh failed");
    } finally {
      directory.stop();
    }
  });

  test("resolveOwner fails closed when a newer failed refresh supersedes its successful reply", async () => {
    const loop = manualPollLoop();
    const replies: Array<{
      resolve: (rows: readonly DaemonListRunRow[]) => void;
      reject: (error: Error) => void;
    }> = [];
    const directory = observeRunOwnership("irrelevant.sock", {
      schedulePollLoop: loop.schedulePollLoop,
      probeLiveness: async () => "live",
      listOwnedRuns: () =>
        new Promise((resolve, reject) => {
          replies.push({ resolve, reject });
        }),
    });
    try {
      const routed = directory.resolveOwner?.("run-1");
      const newer = loop.tick();
      while (replies.length < 2) await Promise.resolve();
      replies[1]?.reject(new Error("newer refresh failed"));
      await newer;
      replies[0]?.resolve([ownedRow("run-1")]);
      await expect(routed).rejects.toThrow("superseded before resolution");
      expect(directory.ownerRow("run-1")).toBeUndefined();
    } finally {
      directory.stop();
    }
  });

  test("resolveOwner stays local after observation stops", async () => {
    const directory = observeRunOwnership("irrelevant.sock", {
      schedulePollLoop: manualPollLoop().schedulePollLoop,
      probeLiveness: async () => "live",
      listOwnedRuns: async () => [ownedRow("run-1")],
    });
    directory.stop();
    expect(await directory.resolveOwner?.("run-1")).toBe(false);
  });

  test("resolveOwnerForKey matches an owned row by project and branch, not by run id", async () => {
    const loop = manualPollLoop();
    const directory = observeRunOwnership("irrelevant.sock", {
      schedulePollLoop: loop.schedulePollLoop,
      probeLiveness: async () => "live",
      listOwnedRuns: async () => [ownedRow("run-1")],
    });
    try {
      await loop.tick();
      expect(await directory.resolveOwnerForKey({ project: "p", branch: "b" })).toBe(true);
      expect(await directory.resolveOwnerForKey({ project: "p", branch: "other-branch" })).toBe(false);
      expect(await directory.resolveOwnerForKey({ project: "other-project", branch: "b" })).toBe(false);
    } finally {
      directory.stop();
    }
  });

  test("resolveOwnerForKey refreshes an initial snapshot before answering", async () => {
    const loop = manualPollLoop();
    let calls = 0;
    const directory = observeRunOwnership("irrelevant.sock", {
      schedulePollLoop: loop.schedulePollLoop,
      probeLiveness: async () => "live",
      listOwnedRuns: async () => {
        calls += 1;
        return [ownedRow("run-1")];
      },
    });
    try {
      expect(await directory.resolveOwnerForKey({ project: "p", branch: "b" })).toBe(true);
      expect(calls).toBe(1);
    } finally {
      directory.stop();
    }
  });

  test("resolveOwnerForKey with no predecessor socket path always resolves false", async () => {
    const directory = observeRunOwnership(undefined);
    expect(await directory.resolveOwnerForKey({ project: "p", branch: "b" })).toBe(false);
    directory.stop();
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
