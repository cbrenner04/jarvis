import { expect, test } from "bun:test";
import { createChangeoverHandler } from "./daemon.ts";

function requestFrame() {
  return { kind: "request" as const, id: "1", method: "changeover" };
}

test("changeover handler cuts admission before scheduling the public release", async () => {
  const calls: string[] = [];
  const handler = createChangeoverHandler({
    getPrivateSocketPath: () => "/tmp/daemon-priv.sock",
    setRetiring: () => calls.push("retiring"),
    closePublicServer: async () => {
      calls.push("closed");
    },
  });

  const response = handler(requestFrame(), new AbortController().signal);
  // `setRetiring` runs synchronously inside the handler, strictly before the reply is even built —
  // the release is only ever scheduled after this point, never before it.
  expect(calls).toEqual(["retiring"]);
  expect(await response).toEqual({
    kind: "response",
    result: { ok: true, privateSocketPath: "/tmp/daemon-priv.sock" },
  });

  // The release is scheduled for after this tick (`setImmediate`), not run inline.
  expect(calls).toEqual(["retiring"]);
  await new Promise((resolve) => setImmediate(resolve));
  expect(calls).toEqual(["retiring", "closed"]);
});

test("changeover handler refuses without retiring or scheduling a release when it has no private endpoint", async () => {
  const calls: string[] = [];
  const handler = createChangeoverHandler({
    getPrivateSocketPath: () => undefined,
    setRetiring: () => calls.push("retiring"),
    closePublicServer: async () => {
      calls.push("closed");
    },
  });

  const response = handler(requestFrame(), new AbortController().signal);
  expect(await response).toEqual({
    kind: "error",
    code: "no_private_endpoint",
    message: "daemon has no private successor endpoint to hand off to",
  });
  await new Promise((resolve) => setImmediate(resolve));
  expect(calls).toEqual([]);
});

test("changeover handler swallows a release failure rather than throwing into the RPC dispatcher", async () => {
  const handler = createChangeoverHandler({
    getPrivateSocketPath: () => "/tmp/daemon-priv.sock",
    setRetiring: () => {},
    closePublicServer: async () => {
      throw new Error("close failed");
    },
  });

  await handler(requestFrame(), new AbortController().signal);
  await new Promise((resolve) => setImmediate(resolve));
  // Reaching here without an unhandled rejection/throw is the assertion.
  expect(true).toBe(true);
});
