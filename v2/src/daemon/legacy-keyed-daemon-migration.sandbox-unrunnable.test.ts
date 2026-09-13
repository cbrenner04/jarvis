// Real-socket coverage for adopting a live pre-stable digest-keyed daemon as a legacy outgoing
// generation (see 03-legacy-keyed-daemon-migration.md).

import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connectIpcClient } from "../ipc/client";
import { type IpcServer, startIpcServer } from "../ipc/server";
import type { ResponseFrame } from "../ipc/types";
import { openStateStore } from "../persistence/state-store";
import { listRuns, startRun, toIpcHandlers } from "../testing/run-control";
import { createTestDaemonLifecycle } from "../testing/test-daemon-lifecycle";
import { canUseUnixSockets } from "../testing/unix-socket";
import { createFakeWriteLoopExecutor } from "../testing/write-loop-executor";
import { createRunControlHandlers } from "./daemon";

const socketTest = test.skipIf(!canUseUnixSockets());
const testDaemons = createTestDaemonLifecycle();
const healthHandler = () => ({ kind: "response" as const, result: { ok: true } });

async function health(socketPath: string): Promise<unknown> {
  const client = await connectIpcClient(socketPath);
  try {
    client.send({ kind: "request", id: socketPath, method: "health" });
    const frame = await client.nextFrame();
    expect(frame.kind).toBe("response");
    return (frame as ResponseFrame).result;
  } finally {
    client.close();
  }
}

async function waitFor(predicate: () => boolean | Promise<boolean>, boundMs: number, stepMs = 20): Promise<boolean> {
  const deadline = Date.now() + boundMs;
  for (;;) {
    if (await predicate()) return true;
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, stepMs));
  }
}

/** Whether `socketPath`'s `list` currently reports `runId` as live; `false` on any RPC failure. */
async function isRunLiveAt(socketPath: string, runId: string): Promise<boolean> {
  try {
    const client = await connectIpcClient(socketPath);
    try {
      const rows = await listRuns(client);
      return rows?.find((row) => row.runId === runId)?.isLive === true;
    } finally {
      client.close();
    }
  } catch {
    return false;
  }
}

/** Whether a `start` request against `socketPath` is refused as `daemon_superseded`. */
async function isAdmissionCutOff(socketPath: string): Promise<boolean> {
  try {
    const client = await connectIpcClient(socketPath);
    try {
      client.send({ kind: "request", id: "admission-probe", method: "start", params: { input: {} } });
      const frame = await client.nextFrame();
      return frame.kind === "error" && (frame as { code?: string }).code === "daemon_superseded";
    } finally {
      client.close();
    }
  } catch {
    return false;
  }
}

describe("legacy keyed-daemon migration (real sockets)", () => {
  socketTest(
    "a live daemon reachable only on a legacy digest-keyed socket is cut off from admission and drained, and its admitted run reaches its normal outcome, when the first stable-address generation starts",
    async () => {
      const tempHome = mkdtempSync(join(tmpdir(), "jarvis-legacy-migration-"));
      const originalJarvisHome = process.env.JARVIS_HOME;
      const publicSocketPath = join(tempHome, "daemon.sock");
      // Matches the pre-stable keyed-socket shape (`daemon-<16hex>.sock`) `enumerateOtherDaemonSockets`
      // recognizes; this daemon predates the handoff protocol and answers no `changeover` RPC.
      const legacyPrivate = join(tempHome, "daemon-1234567890abcdef.sock");
      const successorPrivate = join(tempHome, "daemon-successor-test.sock");
      const dbPath = join(tempHome, "state", "v2.sqlite");
      mkdirSync(join(tempHome, "state"), { recursive: true });

      const legacyStore = openStateStore(dbPath);
      const fakeExecutor = createFakeWriteLoopExecutor();
      const legacyHandlers = createRunControlHandlers({
        stateStore: legacyStore,
        writeLoopExecutor: fakeExecutor.executor,
        failureReporter: () => {},
        hasMemoryHeadroom: () => true,
        settleDelayMs: 0,
      });
      const ipcHandlers = toIpcHandlers(legacyHandlers);
      // No `changeover` handler and no public socket: exactly what a pre-stable daemon answers.
      const supersedeHandler = () => {
        legacyHandlers.setRetiring();
        return { kind: "response" as const, result: { ok: true } };
      };
      const legacyServer: IpcServer = await startIpcServer(legacyPrivate, {
        health: healthHandler,
        supersede: supersedeHandler,
        ...ipcHandlers,
      });

      try {
        const client = await connectIpcClient(legacyPrivate);
        const runId = await startRun(client);
        client.close();
        if (typeof runId !== "string") throw new Error("expected the legacy run to admit");

        process.env.JARVIS_HOME = tempHome;
        // No `predecessorSocketPath` injected: the successor must discover the legacy peer itself.
        const successor = await testDaemons.start(publicSocketPath, {
          privateSocketPath: successorPrivate,
          readinessTimeoutMs: 15_000,
        });
        expect(successor.socketPath).toBe(publicSocketPath);
        expect(await health(publicSocketPath)).toEqual({ ok: true });

        // Admission cutoff: the legacy daemon refuses new work once superseded.
        expect(await waitFor(() => isAdmissionCutOff(legacyPrivate), 3_000)).toBe(true);

        // Drained: the successor's own `list` reports the legacy generation's admitted run live.
        expect(await waitFor(() => isRunLiveAt(publicSocketPath, runId), 3_000)).toBe(true);

        // The already-admitted run keeps executing under the legacy generation and reaches its
        // normal outcome there, undisturbed by the successor now holding the public address.
        fakeExecutor.settleAll();
        expect(await waitFor(() => !legacyHandlers.hasActiveRuns(), 3_000)).toBe(true);
        legacyStore.setRunStatus(runId, "completed");
        expect(legacyStore.loadRun(runId)?.status).toBe("completed");

        // Once drained, the successor stops reporting the run live.
        expect(await waitFor(async () => !(await isRunLiveAt(publicSocketPath, runId)), 3_000)).toBe(true);
      } finally {
        fakeExecutor.abortAll();
        await legacyServer.close();
        legacyStore.close();
        if (originalJarvisHome !== undefined) {
          process.env.JARVIS_HOME = originalJarvisHome;
        } else {
          delete process.env.JARVIS_HOME;
        }
        rmSync(tempHome, { recursive: true, force: true });
      }
    },
    30_000,
  );

  socketTest(
    "an unreachable keyed socket path is skipped: the incoming generation still starts and serves the public address",
    async () => {
      const tempHome = mkdtempSync(join(tmpdir(), "jarvis-legacy-dead-socket-"));
      const originalJarvisHome = process.env.JARVIS_HOME;
      const publicSocketPath = join(tempHome, "daemon.sock");
      const successorPrivate = join(tempHome, "daemon-successor-test.sock");
      // A stale keyed-socket file with nothing listening: matches the discovery filter but answers
      // no RPC. Must not block startup.
      const deadPeerPath = join(tempHome, "daemon-deaddeaddeaddead.sock");
      writeFileSync(deadPeerPath, "");

      try {
        process.env.JARVIS_HOME = tempHome;
        const successor = await testDaemons.start(publicSocketPath, {
          privateSocketPath: successorPrivate,
          readinessTimeoutMs: 15_000,
        });
        expect(successor.socketPath).toBe(publicSocketPath);
        expect(await health(publicSocketPath)).toEqual({ ok: true });
      } finally {
        if (originalJarvisHome !== undefined) {
          process.env.JARVIS_HOME = originalJarvisHome;
        } else {
          delete process.env.JARVIS_HOME;
        }
        rmSync(tempHome, { recursive: true, force: true });
      }
    },
    30_000,
  );
});
