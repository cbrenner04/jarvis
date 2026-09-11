// Real-socket coverage for outgoing-generation drain and exit: an incoming generation observes an
// outgoing generation's already-admitted run over the handoff channel, a second registered
// project's run admitted at the incoming generation is unaffected, and the outgoing generation
// exits on its own once idle — leaving no public socket behind. Fake-based coverage of the `list`
// merge lives in `daemon-list-drain-observed-liveness.test.ts`; poll mechanics live in
// `daemon-drain-observer.test.ts`. Public PID ownership is a CLI-lifecycle (`daemon-lifecycle.ts`)
// concern outside `startDaemonRuntime`, which never reads or writes a pid path — nothing here can
// leave one behind by construction.

import { afterEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connectIpcClient } from "../ipc/client";
import { openStateStore, type StateStore } from "../persistence/state-store";
import { listRuns, mockWriteLoopInput, startRun } from "../testing/run-control";
import { canUseUnixSockets } from "../testing/unix-socket";
import { createFakeWriteLoopExecutor } from "../testing/write-loop-executor";
import { startDaemonRuntime } from "./daemon";
import { startDrainObservation } from "./daemon-drain-observer";

const socketTest = test.skipIf(!canUseUnixSockets());
const openStores: StateStore[] = [];
const runtimes: Array<{ close: () => Promise<void> }> = [];
const artifacts: string[] = [];

function tmpPath(name: string): string {
  const path = join(tmpdir(), `jarvis-drain-${process.pid}-${Date.now()}-${name}`);
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

async function health(socketPath: string): Promise<boolean> {
  try {
    const client = await connectIpcClient(socketPath);
    try {
      client.send({ kind: "request", id: "h", method: "health" });
      const frame = await client.nextFrame(500);
      return frame.kind === "response";
    } finally {
      client.close();
    }
  } catch {
    return false;
  }
}

async function pollUntil(check: () => Promise<boolean> | boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await check()) return true;
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

describe("outgoing generation drain and exit (real sockets)", () => {
  socketTest(
    "the incoming generation reports an outgoing-held run live and unrelated project admission stays unaffected, until the outgoing generation drains and exits",
    async () => {
      const publicSocketPath = tmpPath("public.sock");
      const outgoingPrivatePath = tmpPath("outgoing-private.sock");
      const incomingPrivatePath = tmpPath("incoming-private.sock");

      const exitCalls: number[] = [];
      const outgoingExecutor = createFakeWriteLoopExecutor();
      const outgoing = await startDaemonRuntime(publicSocketPath, trackedStore(tmpPath("outgoing.sqlite")), undefined, {
        privateSocketPath: outgoingPrivatePath,
        writeLoopExecutor: outgoingExecutor.executor,
        // A non-throwing stand-in: the outgoing generation's own interval calls this once retiring
        // and idle. Recording the call (rather than letting `process.exit` run for real, or
        // throwing through the `.then().catch()` shutdown chain) proves the auto-exit path fires
        // without tearing down the test process.
        processExit: ((code: number) => {
          exitCalls.push(code);
          return undefined as never;
        }) as (code: number) => never,
      });
      runtimes.push(outgoing);

      const outgoingClient = await connectIpcClient(publicSocketPath);
      const outgoingRunId = await startRun(outgoingClient, mockWriteLoopInput({ projectName: "held-project" }));
      expect(typeof outgoingRunId).toBe("string");
      outgoingClient.close();

      const incomingExecutor = createFakeWriteLoopExecutor();
      const incoming = await startDaemonRuntime(publicSocketPath, trackedStore(tmpPath("incoming.sqlite")), undefined, {
        privateSocketPath: incomingPrivatePath,
        writeLoopExecutor: incomingExecutor.executor,
        // Real polling, sped up so the test does not wait out the production 500ms cadence.
        startDrainObservation: (privateSocketPath) => startDrainObservation(privateSocketPath, { intervalMs: 25 }),
      });
      runtimes.push(incoming);

      const incomingClient = await connectIpcClient(publicSocketPath);
      runtimes.push({ close: async () => incomingClient.close() });

      // The outgoing generation's run is reported live at the public address via drain observation,
      // even though the incoming generation never admitted it itself.
      const heldLive = await pollUntil(async () => {
        const rows = await listRuns(incomingClient);
        return rows?.find((row) => row.runId === outgoingRunId)?.isLive === true;
      }, 2_000);
      expect(heldLive).toBe(true);

      // Admitting a second registered project's run at the incoming generation does not disturb the
      // first project's in-flight run under the outgoing generation.
      const incomingRunId = await startRun(incomingClient, mockWriteLoopInput({ projectName: "new-project" }));
      expect(typeof incomingRunId).toBe("string");
      const rowsAfterAdmission = await listRuns(incomingClient);
      expect(rowsAfterAdmission?.find((row) => row.runId === outgoingRunId)?.isLive).toBe(true);
      expect(rowsAfterAdmission?.find((row) => row.runId === incomingRunId)?.isLive).toBe(true);

      // Settling the outgoing generation's only run drains it: it stops admitting (already
      // retiring), goes idle, and exits on its own — leaving no public socket behind (the public
      // address already answers from the incoming generation) and no private socket either.
      outgoingExecutor.settleAll();
      const exited = await pollUntil(() => exitCalls.length > 0, 3_000);
      expect(exited).toBe(true);
      expect(exitCalls).toEqual([0]);

      const outgoingPrivateStillServing = await pollUntil(() => health(outgoingPrivatePath), 500);
      expect(outgoingPrivateStillServing).toBe(false);

      // Drain observation against the now-exited private endpoint completes without failing the
      // incoming generation: it keeps serving and stops reporting the drained run as live.
      expect(await health(publicSocketPath)).toBe(true);
      const drained = await pollUntil(async () => {
        const rows = await listRuns(incomingClient);
        return rows?.find((row) => row.runId === outgoingRunId)?.isLive === false;
      }, 2_000);
      expect(drained).toBe(true);
    },
    15_000,
  );
});
