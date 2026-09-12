// Real-socket coverage for the stable public daemon address and private successor endpoint.

import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getInvokingExecutableDigest } from "../cli/dispatch-revision";
import { connectIpcClient } from "../ipc/client";
import { type IpcServer, startIpcServer } from "../ipc/server";
import type { ResponseFrame } from "../ipc/types";
import { daemonPathsByDigest } from "../paths";
import { openStateStore } from "../persistence/state-store";
import { listRuns, startRun, toIpcHandlers } from "../testing/run-control";
import { createTestDaemonLifecycle } from "../testing/test-daemon-lifecycle";
import { canUseUnixSockets } from "../testing/unix-socket";
import { createFakeWriteLoopExecutor } from "../testing/write-loop-executor";
import { createChangeoverHandler, createRunControlHandlers } from "./daemon";

const socketTest = test.skipIf(!canUseUnixSockets());
const cliEntrypoint = join(import.meta.dir, "..", "cli.ts");
const capturedPids = new Set<number>();
const testDaemons = createTestDaemonLifecycle();

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

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

async function runCli(args: readonly string[], jarvisHome: string): Promise<{ code: number; stdout: string }> {
  const proc = Bun.spawn([process.execPath, cliEntrypoint, ...args], {
    env: { ...process.env, JARVIS_HOME: jarvisHome },
    stdout: "pipe",
    stderr: "ignore",
  });
  const stdout = await new Response(proc.stdout).text();
  const code = await proc.exited;
  return { code, stdout };
}

afterEach(() => {
  for (const pid of capturedPids) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Already gone or unkillable.
    }
  }
  capturedPids.clear();
});

describe("daemon (stable public address)", () => {
  socketTest(
    "answers on public and private sockets, records its public pid, and reports running publicly",
    async () => {
      const tempHome = mkdtempSync(join(tmpdir(), "jarvis-stable-address-test-"));
      const originalJarvisHome = process.env.JARVIS_HOME;

      try {
        const started = await runCli(["daemon", "start"], tempHome);
        expect(started.code).toBe(0);
        expect(started.stdout).toBeTruthy();
        const result = JSON.parse(started.stdout.trim());
        expect(result.pid).toBeGreaterThan(0);
        capturedPids.add(result.pid);
        expect(isProcessAlive(result.pid)).toBe(true);

        const publicSocketPath = join(tempHome, "daemon.sock");
        expect(result.socketPath).toBe(publicSocketPath);
        expect(result.socketPath).not.toMatch(/daemon-[0-9a-f]{16}\.sock$/);
        expect(await health(publicSocketPath)).toEqual({ ok: true });

        process.env.JARVIS_HOME = tempHome;
        const digest = await getInvokingExecutableDigest();
        const privateSocketPath = daemonPathsByDigest(digest).socketPath;
        expect(privateSocketPath).not.toBe(publicSocketPath);
        expect(await health(privateSocketPath)).toEqual({ ok: true });

        expect(Number(readFileSync(join(tempHome, "daemon.pid"), "utf-8").trim())).toBe(result.pid);

        const status = await runCli(["daemon", "status"], tempHome);
        expect(status.code).toBe(0);
        expect(status.stdout).toContain("running");
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

  // Restores the two-generation coexistence assertion the handoff protocol replaced: fails against
  // the pre-handoff keyed-socket coexistence model, which never lets a second generation take the
  // stable public address at all while a first is admitting work there.
  socketTest(
    "an incoming generation admits new work at the stable address while the outgoing generation's already-admitted run keeps running under it",
    async () => {
      const tempHome = mkdtempSync(join(tmpdir(), "jarvis-handoff-coexist-"));
      const originalJarvisHome = process.env.JARVIS_HOME;
      const publicSocketPath = join(tempHome, "daemon.sock");
      const incumbentPrivate = join(tempHome, "daemon-incumbent-test.sock");
      const successorPrivate = join(tempHome, "daemon-successor-test.sock");
      const dbPath = join(tempHome, "state", "v2.sqlite");
      mkdirSync(join(tempHome, "state"), { recursive: true });

      // No `currentIdentity` override: this store stamps the real test process's own `pid:epoch`,
      // so the successor's real cross-process liveness check correctly finds it alive.
      const incumbentStore = openStateStore(dbPath);
      const fakeExecutor = createFakeWriteLoopExecutor();
      const incumbentHandlers = createRunControlHandlers({
        stateStore: incumbentStore,
        writeLoopExecutor: fakeExecutor.executor,
        failureReporter: () => {},
        hasMemoryHeadroom: () => true,
        settleDelayMs: 0,
      });
      const ipcHandlers = toIpcHandlers(incumbentHandlers);
      const healthHandler = () => ({ kind: "response" as const, result: { ok: true } });

      let incumbentPublicServer: IpcServer;
      const changeoverHandler = createChangeoverHandler({
        getPrivateSocketPath: () => incumbentPrivate,
        setRetiring: incumbentHandlers.setRetiring,
        closePublicServer: () => incumbentPublicServer.close(),
      });
      const incumbentPrivateServer = await startIpcServer(incumbentPrivate, { health: healthHandler, ...ipcHandlers });
      incumbentPublicServer = await startIpcServer(publicSocketPath, {
        health: healthHandler,
        changeover: changeoverHandler,
        ...ipcHandlers,
      });

      try {
        const incumbentClient = await connectIpcClient(incumbentPrivate);
        const incumbentRunId = await startRun(incumbentClient);
        expect(typeof incumbentRunId).toBe("string");
        incumbentClient.close();

        process.env.JARVIS_HOME = tempHome;
        const metadata = await testDaemons.start(publicSocketPath, {
          privateSocketPath: successorPrivate,
          readinessTimeoutMs: 15_000,
        });
        expect(metadata.socketPath).toBe(publicSocketPath);

        const successorClient = await connectIpcClient(publicSocketPath);
        const successorRunId = await startRun(successorClient);
        expect(typeof successorRunId).toBe("string");
        expect(successorRunId).not.toBe(incumbentRunId);
        successorClient.close();

        // The outgoing generation's already-admitted run is still live under it — neither
        // re-dispatched nor force-settled by the incoming generation.
        const listClient = await connectIpcClient(incumbentPrivate);
        const rows = await listRuns(listClient);
        expect(rows?.find((row) => row.runId === incumbentRunId)?.isLive).toBe(true);
        listClient.close();
      } finally {
        fakeExecutor.abortAll();
        await incumbentPrivateServer.close();
        await incumbentPublicServer.close();
        incumbentStore.close();
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
