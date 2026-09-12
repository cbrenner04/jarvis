import { expect, test } from "bun:test";
import { withFixedUuid } from "../testing/fixed-uuid.ts";
import { makeIpcClient } from "../testing/ipc-client-fake.ts";
import { requestChangeoverFromPublicPeer } from "./daemon-changeover.ts";

test("requestChangeoverFromPublicPeer returns the peer's private endpoint on success", async () => {
  await withFixedUuid("req-1", async () => {
    const outcome = await requestChangeoverFromPublicPeer("/fake/socket", {
      connect: async () =>
        makeIpcClient([
          { kind: "response", id: "req-1", result: { ok: true, privateSocketPath: "/fake/private.sock" } },
        ]),
    });
    expect(outcome).toEqual({ kind: "changeover", privateSocketPath: "/fake/private.sock" });
  });
});

test("requestChangeoverFromPublicPeer fails closed on a malformed reply", async () => {
  await withFixedUuid("req-1", async () => {
    const outcome = await requestChangeoverFromPublicPeer("/fake/socket", {
      connect: async () => makeIpcClient([{ kind: "response", id: "req-1", result: { ok: true } }]),
    });
    expect(outcome).toEqual({ kind: "handoff-failed" });
  });
});

test("requestChangeoverFromPublicPeer fails closed on an RPC error reply", async () => {
  await withFixedUuid("req-1", async () => {
    const outcome = await requestChangeoverFromPublicPeer("/fake/socket", {
      connect: async () => makeIpcClient([{ kind: "error", id: "req-1", code: "unknown_method", message: "nope" }]),
    });
    expect(outcome).toEqual({ kind: "handoff-failed" });
  });
});

// A live peer was already proven (the caller only calls this after a successful `health` probe), so
// a connect failure here is not "no peer after all" — it must fail closed the same as a timeout or
// RPC error, not be special-cased into proceeding as if nothing were there.
test("requestChangeoverFromPublicPeer fails closed when the connect itself fails", async () => {
  const outcome = await requestChangeoverFromPublicPeer("/fake/socket", {
    connect: async () => {
      throw Object.assign(new Error("ECONNREFUSED"), { code: "ECONNREFUSED" });
    },
  });
  expect(outcome).toEqual({ kind: "handoff-failed" });
});

test("requestChangeoverFromPublicPeer fails closed on timeout", async () => {
  const outcome = await requestChangeoverFromPublicPeer("/fake/socket", {
    timeoutMs: 10,
    connect: async () => makeIpcClient([], { deferred: true }),
  });
  expect(outcome).toEqual({ kind: "handoff-failed" });
});
