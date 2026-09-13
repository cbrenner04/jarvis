// Real-socket coverage for the handoff changeover protocol at the stable public address.

import { describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connectIpcClient } from "../ipc/client";
import { type RpcHandler, startIpcServer } from "../ipc/server";
import type { ResponseFrame } from "../ipc/types";
import { mockWriteLoopInput } from "../testing/run-control";
import { createTestDaemonLifecycle } from "../testing/test-daemon-lifecycle";
import { canUseUnixSockets } from "../testing/unix-socket";
import { startDaemonRuntime } from "./daemon";
import { DaemonHandoffFailedError, startDaemon } from "./daemon-lifecycle";

const socketTest = test.skipIf(!canUseUnixSockets());
const testDaemons = createTestDaemonLifecycle();

function socketPathFor(name: string): string {
  return join(tmpdir(), `jarvis-handoff-${name}-${process.pid}-${Date.now()}.sock`);
}

async function health(socketPath: string): Promise<unknown> {
  const client = await connectIpcClient(socketPath);
  try {
    client.send({ kind: "request", id: "h", method: "health" });
    const frame = await client.nextFrame();
    expect(frame.kind).toBe("response");
    return (frame as ResponseFrame).result;
  } finally {
    client.close();
  }
}

describe("daemon handoff changeover (real sockets)", () => {
  socketTest(
    "an incoming generation completes changeover: the outgoing generation refuses admission before releasing, the incoming generation answers after",
    async () => {
      const publicSocketPath = socketPathFor("public");
      const incumbentPrivate = socketPathFor("incumbent-private");
      const successorPrivate = socketPathFor("successor-private");
      rmSync(publicSocketPath, { force: true });
      rmSync(incumbentPrivate, { force: true });
      rmSync(successorPrivate, { force: true });

      const incumbent = await startDaemonRuntime(publicSocketPath, undefined, undefined, {
        privateSocketPath: incumbentPrivate,
      });
      try {
        const metadata = await testDaemons.start(publicSocketPath, {
          privateSocketPath: successorPrivate,
          readinessTimeoutMs: 15_000,
        });
        expect(metadata.socketPath).toBe(publicSocketPath);

        // The outgoing generation is retiring: its own still-live private endpoint refuses new
        // admission — this pre-fix keyed-daemon coexistence model has no such refusal at all.
        const incumbentClient = await connectIpcClient(incumbentPrivate);
        incumbentClient.send({ kind: "request", id: "s1", method: "start", params: { input: mockWriteLoopInput() } });
        const refused = await incumbentClient.nextFrame();
        expect(refused.kind).toBe("error");
        expect((refused as { code?: string }).code).toBe("daemon_superseded");
        incumbentClient.close();

        // The incoming generation now answers on the public address — the address this test
        // fails against under the pre-fix refusal-on-occupied-address behavior, which never
        // reaches this point at all (`testDaemons.start` above would have thrown).
        expect(await health(publicSocketPath)).toEqual({ ok: true });
      } finally {
        await incumbent.close();
        rmSync(publicSocketPath, { force: true });
        rmSync(incumbentPrivate, { force: true });
        rmSync(successorPrivate, { force: true });
      }
    },
    30_000,
  );

  socketTest(
    "an incoming generation whose handoff request goes unanswered fails startup and leaves the incumbent serving",
    async () => {
      const publicSocketPath = socketPathFor("unanswered-public");
      const successorPrivate = socketPathFor("unanswered-successor-private");
      rmSync(publicSocketPath, { force: true });
      rmSync(successorPrivate, { force: true });

      const handlers: Record<string, RpcHandler> = {
        health: () => ({ kind: "response", result: { ok: true } }),
        // Never resolves: simulates a live peer that accepts the connection but never replies.
        changeover: () => new Promise(() => {}),
      };
      const incumbent = await startIpcServer(publicSocketPath, handlers);
      try {
        await expect(
          startDaemon(publicSocketPath, {
            privateSocketPath: successorPrivate,
            changeoverTimeoutMs: 200,
            readinessTimeoutMs: 5_000,
          }),
        ).rejects.toBeInstanceOf(DaemonHandoffFailedError);

        expect(await health(publicSocketPath)).toEqual({ ok: true });
      } finally {
        await incumbent.close();
        rmSync(publicSocketPath, { force: true });
        rmSync(successorPrivate, { force: true });
      }
    },
    15_000,
  );

  socketTest(
    "the changeover reply names the outgoing generation's private endpoint, which answers after the public address is released",
    async () => {
      const publicSocketPath = socketPathFor("reply-public");
      const privateSocketPath = socketPathFor("reply-private");
      rmSync(publicSocketPath, { force: true });
      rmSync(privateSocketPath, { force: true });

      const incumbent = await startDaemonRuntime(publicSocketPath, undefined, undefined, { privateSocketPath });
      try {
        const client = await connectIpcClient(publicSocketPath);
        client.send({ kind: "request", id: "c1", method: "changeover" });
        const frame = await client.nextFrame();
        expect(frame.kind).toBe("response");
        const result = (frame as ResponseFrame).result as { ok: boolean; privateSocketPath: string };
        expect(result.privateSocketPath).toBe(privateSocketPath);
        client.close();

        let released = false;
        for (let attempt = 0; attempt < 100; attempt++) {
          try {
            const probe = await connectIpcClient(publicSocketPath);
            probe.close();
          } catch {
            released = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        expect(released).toBe(true);

        expect(await health(privateSocketPath)).toEqual({ ok: true });
      } finally {
        await incumbent.close();
        rmSync(publicSocketPath, { force: true });
        rmSync(privateSocketPath, { force: true });
      }
    },
    15_000,
  );
});
