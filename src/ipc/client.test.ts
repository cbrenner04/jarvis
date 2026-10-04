import { afterEach, beforeEach, expect, jest, spyOn, test } from "bun:test";
import { Socket } from "node:net";
import { connectIpcClient } from "./client.ts";
import { encodeFrame } from "./codec.ts";

let sockets: Socket[] = [];
let connectSpy: ReturnType<typeof spyOn>;

beforeEach(() => {
  sockets = [];
  jest.useFakeTimers();
  // Holds connection completion until the test emits `connect`; no real socket is opened.
  connectSpy = spyOn(Socket.prototype, "connect").mockImplementation(function (this: Socket) {
    sockets.push(this);
    return this;
  } as never);
});

afterEach(() => {
  connectSpy.mockRestore();
  jest.useRealTimers();
});

function release(): void {
  sockets[0]?.emit("connect");
}

function settle<T>(promise: Promise<T>): {
  state: () => "pending" | "resolved" | "rejected";
  outcome: Promise<unknown>;
} {
  let state: "pending" | "resolved" | "rejected" = "pending";
  const outcome = promise.then(
    (value) => {
      state = "resolved";
      return value;
    },
    (err: unknown) => {
      state = "rejected";
      return err;
    },
  );
  return { state: () => state, outcome };
}

test("connects under the default budget after 5001 ms", async () => {
  const attempt = settle(connectIpcClient("/x.sock"));
  jest.advanceTimersByTime(5_001);
  await Promise.resolve();
  expect(attempt.state()).toBe("pending");
  release();
  const client = await attempt.outcome;
  expect(attempt.state()).toBe("resolved");
  (client as { close(): void }).close();
});

test("omitted connection budget is 30000 ms exactly", async () => {
  const attempt = settle(connectIpcClient("/x.sock"));
  jest.advanceTimersByTime(29_999);
  await Promise.resolve();
  expect(attempt.state()).toBe("pending");
  jest.advanceTimersByTime(1);
  const err = await attempt.outcome;
  expect(attempt.state()).toBe("rejected");
  expect((err as Error).message).toContain("IPC connect timeout");
  expect((err as Error).message).toContain("30000ms");
});

test("explicit connection budget expiry names the effective budget", async () => {
  const attempt = settle(connectIpcClient("/x.sock", undefined, 10));
  jest.advanceTimersByTime(10);
  const err = await attempt.outcome;
  expect((err as Error).message).toContain("IPC connect timeout");
  expect((err as Error).message).toContain("10ms");
});

test("connection budget does not bound an unbounded nextFrame()", async () => {
  const attempt = connectIpcClient("/x.sock", undefined, 10);
  release();
  const client = await attempt;
  const frame = settle(client.nextFrame());
  jest.advanceTimersByTime(10_000);
  await Promise.resolve();
  expect(frame.state()).toBe("pending");
  sockets[0]?.emit("data", Buffer.from(encodeFrame({ kind: "response", id: "r1", result: { ok: true } })));
  expect(await frame.outcome).toEqual({ kind: "response", id: "r1", result: { ok: true } });
  client.close();
});
