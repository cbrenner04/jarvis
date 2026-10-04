import { expect, test } from "bun:test";
import { withFixedUuid } from "../testing/fixed-uuid.ts";
import { makeIpcClient } from "../testing/ipc-client-fake.ts";
import { RpcConnectionError } from "./rpc-errors.ts";
import { createRpcTransport } from "./rpc-transport.ts";

test("timeoutMs abandons and rejects a request that never resolves", async () => {
  await withFixedUuid("req-1", async () => {
    const client = makeIpcClient([], { deferred: true });
    const transport = createRpcTransport(client);

    await expect(transport.request("wait", undefined, { timeoutMs: 5 })).rejects.toBeInstanceOf(RpcConnectionError);
  });
});

test("timeoutMs does not affect a request that resolves before the timeout", async () => {
  await withFixedUuid("req-1", async () => {
    const client = makeIpcClient([], { deferred: true });
    const transport = createRpcTransport(client);

    const result = transport.request("health", undefined, { timeoutMs: 50 });
    client.push({ kind: "response", id: "req-1", result: { ok: true } });

    await expect(result).resolves.toEqual({ ok: true });

    // No dangling timer fires a spurious abandon/rejection after resolution.
    await new Promise((resolve) => setTimeout(resolve, 60));
  });
});
