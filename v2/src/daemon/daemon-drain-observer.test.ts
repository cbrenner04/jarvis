import { describe, expect, test } from "bun:test";
import type { SocketLiveness } from "../ipc/server.ts";
import { drainObservationEndsOnLiveness, observePredecessorDrain } from "./daemon-drain-observer.ts";

describe("drainObservationEndsOnLiveness", () => {
  test("ends observation when the socket reads absent or stale", () => {
    expect(drainObservationEndsOnLiveness("absent")).toBe(true);
    expect(drainObservationEndsOnLiveness("stale")).toBe(true);
  });

  test("does not end observation while the socket reads live", () => {
    expect(drainObservationEndsOnLiveness("live")).toBe(false);
  });
});

async function waitFor(predicate: () => boolean, boundMs = 2_000): Promise<void> {
  const deadline = Date.now() + boundMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("condition not met within bound");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe("observePredecessorDrain", () => {
  test("reports the predecessor's live run ids from list", async () => {
    const observer = observePredecessorDrain("irrelevant.sock", {
      pollIntervalMs: 10,
      probeLiveness: async () => "live",
      listLiveRunIds: async () => ["run-1"],
    });
    try {
      await waitFor(() => observer.liveRunIds().has("run-1"));
    } finally {
      observer.stop();
    }
  });

  test("retains the last known live set across a transient list RPC failure", async () => {
    let listCalls = 0;
    const observer = observePredecessorDrain("irrelevant.sock", {
      pollIntervalMs: 10,
      probeLiveness: async () => "live",
      listLiveRunIds: async () => {
        listCalls += 1;
        if (listCalls === 2) throw new Error("timed out");
        return ["run-1"];
      },
    });
    try {
      await waitFor(() => observer.liveRunIds().has("run-1"));
      await waitFor(() => listCalls >= 2);
      // The failed poll (call 2) must not have cleared the previously observed live set: the
      // socket itself is still live, so this is a stall, not a drain.
      expect(observer.liveRunIds().has("run-1")).toBe(true);
      await waitFor(() => listCalls >= 3);
      expect(observer.liveRunIds().has("run-1")).toBe(true);
    } finally {
      observer.stop();
    }
  });

  test("ends observation and clears the live set once the predecessor's socket reads absent", async () => {
    let liveness: SocketLiveness = "live";
    let listCalls = 0;
    const observer = observePredecessorDrain("irrelevant.sock", {
      pollIntervalMs: 10,
      probeLiveness: async () => liveness,
      listLiveRunIds: async () => {
        listCalls += 1;
        return ["run-1"];
      },
    });
    try {
      await waitFor(() => observer.liveRunIds().has("run-1"));
      liveness = "absent";
      await waitFor(() => observer.liveRunIds().size === 0);
      const callsAtDrain = listCalls;
      await new Promise((resolve) => setTimeout(resolve, 50));
      // Polling actually stopped: no further `list` calls after the socket read absent.
      expect(listCalls).toBe(callsAtDrain);
    } finally {
      observer.stop();
    }
  });

  test("observing an already-exited endpoint completes without failing: the live set stays empty and no RPC is attempted", async () => {
    let listCalls = 0;
    const observer = observePredecessorDrain("irrelevant.sock", {
      pollIntervalMs: 10,
      probeLiveness: async () => "absent",
      listLiveRunIds: async () => {
        listCalls += 1;
        return ["run-1"];
      },
    });
    try {
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(observer.liveRunIds().size).toBe(0);
      expect(listCalls).toBe(0);
    } finally {
      observer.stop();
    }
  });

  test("stop() called while a list RPC is in flight discards that RPC's result", async () => {
    let releaseList: ((ids: readonly string[]) => void) | undefined;
    const observer = observePredecessorDrain("irrelevant.sock", {
      pollIntervalMs: 10,
      probeLiveness: async () => "live",
      listLiveRunIds: () =>
        new Promise<readonly string[]>((resolve) => {
          releaseList = resolve;
        }),
    });
    try {
      await waitFor(() => releaseList !== undefined);
      observer.stop();
      releaseList?.(["run-1"]);
      // Let the resolved promise's continuation run before asserting.
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(observer.liveRunIds().has("run-1")).toBe(false);
    } finally {
      observer.stop();
    }
  });

  test("stop() is idempotent and safe to call multiple times", () => {
    const observer = observePredecessorDrain("irrelevant.sock", {
      pollIntervalMs: 10,
      probeLiveness: async () => "live",
      listLiveRunIds: async () => [],
    });
    observer.stop();
    observer.stop();
  });
});
