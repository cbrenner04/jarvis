import { afterEach, expect, test } from "bun:test";
import type { IpcClient } from "../ipc/client.ts";
import type { IpcFrame } from "../ipc/types.ts";
import { drainObservationEndsOnPollFailure, startDrainObservation } from "./daemon-drain-observer.ts";

/** Answers one `list` request per connection with the given run rows, then leaves `nextFrame` pending. */
function fakeListClient(runs: Array<{ runId: string; isLive: boolean }>): IpcClient {
  let resolveNext: ((frame: IpcFrame) => void) | undefined;
  return {
    send(frame) {
      const { id } = frame as { id: string };
      queueMicrotask(() => resolveNext?.({ kind: "response", id, result: { runs } }));
    },
    nextFrame() {
      return new Promise((resolve) => {
        resolveNext = resolve;
      });
    },
    close() {},
  };
}

function unreachableClient(_socketPath: string): Promise<IpcClient> {
  return Promise.reject(new Error("ECONNREFUSED"));
}

const observers: Array<{ stop: () => void }> = [];

afterEach(() => {
  for (const observer of observers.splice(0)) {
    observer.stop();
  }
});

test("drainObservationEndsOnPollFailure: only a failed poll ends observation", () => {
  expect(drainObservationEndsOnPollFailure(true)).toBe(true);
  expect(drainObservationEndsOnPollFailure(false)).toBe(false);
});

test("reports the outgoing generation's live run ids from its private endpoint's list RPC", async () => {
  const observer = startDrainObservation("/fake/private.sock", {
    connectIpcClient: async () =>
      fakeListClient([
        { runId: "held-1", isLive: true },
        { runId: "settled-1", isLive: false },
      ]),
  });
  observers.push(observer);

  await Bun.sleep(0);
  await Bun.sleep(0);

  expect(observer.liveRunIds()).toEqual(new Set(["held-1"]));
});

test("a private endpoint that never answers (predecessor already exited) ends observation without failing", async () => {
  const observer = startDrainObservation("/fake/private.sock", {
    connectIpcClient: unreachableClient,
  });
  observers.push(observer);

  await Bun.sleep(0);
  await Bun.sleep(0);

  expect(observer.liveRunIds()).toEqual(new Set());
});

test("stop() is idempotent and clears the poll interval", () => {
  const observer = startDrainObservation("/fake/private.sock", {
    connectIpcClient: async () => fakeListClient([]),
  });
  observer.stop();
  observer.stop();
  expect(observer.liveRunIds()).toEqual(new Set());
});
