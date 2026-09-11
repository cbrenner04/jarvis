// Real-socket coverage for the handoff changeover protocol: an incoming generation performs an
// actual handoff exchange against a live outgoing generation over real Unix sockets. Fake-based
// coverage of the changeover handler and the abort-on-failed-handoff path lives in
// `daemon-changeover-handler.test.ts`; this file exercises what only two live generations sharing
// one public address can prove.

import { afterEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connectIpcClient } from "../ipc/client";
import type { ResponseFrame } from "../ipc/types";
import { openStateStore, type StateStore } from "../persistence/state-store";
import { mockWriteLoopInput, startRun } from "../testing/run-control";
import { canUseUnixSockets } from "../testing/unix-socket";
import { createFakeWriteLoopExecutor } from "../testing/write-loop-executor";
import { startDaemonRuntime } from "./daemon";
import { type ChangeoverOutcome, requestChangeoverFromPublicPeer } from "./daemon-peer-socket";

const socketTest = test.skipIf(!canUseUnixSockets());
const openStores: StateStore[] = [];
const runtimes: Array<{ close: () => Promise<void> }> = [];
const artifacts: string[] = [];

function tmpPath(name: string): string {
  const path = join(tmpdir(), `jarvis-changeover-${process.pid}-${Date.now()}-${name}`);
  artifacts.push(path);
  return path;
}

function trackedStore(dbPath: string): StateStore {
  const store = openStateStore(dbPath);
  openStores.push(store);
  return store;
}

afterEach(async () => {
  for (const runtime of runtimes.splice(0)) {
    await runtime.close();
  }
  for (const store of openStores.splice(0)) {
    store.close();
  }
  for (const path of artifacts.splice(0)) {
    rmSync(path, { force: true });
  }
});

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

describe("daemon generation handoff (real sockets)", () => {
  socketTest(
    "an incoming generation takes the public address from a live outgoing generation, which keeps its already-admitted run running and refuses new admission",
    async () => {
      const publicSocketPath = tmpPath("public.sock");
      const outgoingPrivatePath = tmpPath("outgoing-private.sock");
      const incomingPrivatePath = tmpPath("incoming-private.sock");

      const outgoingExecutor = createFakeWriteLoopExecutor();
      const outgoing = await startDaemonRuntime(publicSocketPath, trackedStore(tmpPath("outgoing.sqlite")), undefined, {
        privateSocketPath: outgoingPrivatePath,
        writeLoopExecutor: outgoingExecutor.executor,
      });
      runtimes.push(outgoing);

      // Admit a run at the outgoing generation while it still owns the public address.
      const outgoingClient = await connectIpcClient(publicSocketPath);
      const outgoingRunId = await startRun(outgoingClient, mockWriteLoopInput({ projectName: "held-project" }));
      expect(typeof outgoingRunId).toBe("string");
      outgoingClient.close();

      let capturedOutcome: ChangeoverOutcome | undefined;
      const incomingExecutor = createFakeWriteLoopExecutor();
      const incoming = await startDaemonRuntime(publicSocketPath, trackedStore(tmpPath("incoming.sqlite")), undefined, {
        privateSocketPath: incomingPrivatePath,
        writeLoopExecutor: incomingExecutor.executor,
        requestChangeoverFromPublicPeer: async (socketPath) => {
          capturedOutcome = await requestChangeoverFromPublicPeer(socketPath);
          return capturedOutcome;
        },
      });
      runtimes.push(incoming);

      // The handoff reply named the outgoing generation's private endpoint, and it still answers.
      expect(capturedOutcome).toEqual({ kind: "handoff-complete", privateSocketPath: outgoingPrivatePath });
      expect(await health(outgoingPrivatePath)).toEqual({ ok: true });

      // The public address now answers from the incoming generation, which admits new work there.
      expect(await health(publicSocketPath)).toEqual({ ok: true });
      const incomingClient = await connectIpcClient(publicSocketPath);
      const incomingRunId = await startRun(incomingClient, mockWriteLoopInput({ projectName: "new-project" }));
      expect(typeof incomingRunId).toBe("string");
      incomingClient.close();

      // The outgoing generation refuses new admission at its private endpoint (retiring), while its
      // already-admitted run keeps executing there under exactly one generation.
      const outgoingPrivateClient = await connectIpcClient(outgoingPrivatePath);
      outgoingPrivateClient.send({
        kind: "request",
        id: "s2",
        method: "start",
        params: { input: mockWriteLoopInput() },
      });
      const refusal = await outgoingPrivateClient.nextFrame();
      expect(refusal.kind).toBe("error");
      expect((refusal as { code?: string }).code).toBe("daemon_superseded");
      outgoingPrivateClient.close();

      const listClient = await connectIpcClient(outgoingPrivatePath);
      listClient.send({ kind: "request", id: "l1", method: "list" });
      const listFrame = await listClient.nextFrame();
      const listed = (listFrame as ResponseFrame).result as { runs?: Array<{ runId: string; isLive: boolean }> };
      expect(listed.runs?.find((r) => r.runId === outgoingRunId)?.isLive).toBe(true);
      listClient.close();

      // Deliberately left pending: settling it would flip the outgoing generation idle while
      // retiring, triggering its real auto-shutdown/process-exit path, which this test does not
      // inject a safe stand-in for. `afterEach` tears down both runtimes without needing that run
      // to settle first.
    },
    15_000,
  );
});
