import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

async function waitForLogMarkers(logPath: string, markers: string[], timeoutMs = 3_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const content = readFileSync(logPath, "utf-8");
    if (markers.every((marker) => content.includes(marker))) {
      return content;
    }
    await new Promise((resolve) => setImmediate(resolve));
  }
  return readFileSync(logPath, "utf-8");
}

import type { IpcServer, RpcHandler } from "../ipc/server.ts";
import type { Run } from "../persistence/state-store";
import { openStateStore } from "../persistence/state-store.ts";
import { makeIpcClient } from "../testing/cli-test-helpers.ts";
import { flushBackgroundRuns, mockWriteLoopInput } from "../testing/run-control.ts";
import { writeStepFixtures } from "../testing/workflow-step-fixtures.ts";
import { createFakeWriteLoopExecutor } from "../testing/write-loop-executor.ts";
import { listPeerDaemonSockets, startDaemonRuntime } from "./daemon.ts";
import {
  DaemonAlreadyRunningError,
  DaemonReadinessTimeoutError,
  DaemonStopInspectionError,
  DaemonStopRefusedError,
  getDaemonStatus,
  type ProcessProber,
  type SocketProber,
  startDaemon,
  stopDaemon,
} from "./daemon-lifecycle";

function rpcFrame(id: string, method: string, params?: unknown) {
  return { kind: "request" as const, id, method, params };
}

const rpcSignal = () => new AbortController().signal;

function stubIpcServer(onHandlers?: (handlers: Record<string, RpcHandler>) => void) {
  return async (_socketPath: string, handlers?: Record<string, RpcHandler>) => {
    if (handlers) onHandlers?.(handlers);
    return { close: async () => undefined } as IpcServer;
  };
}

const noopProcessExit = (() => 0 as never) as (code: number) => never;

describe("daemon-lifecycle", () => {
  describe("startDaemon", () => {
    test("throws DaemonAlreadyRunningError if socket already responds", async () => {
      const socketProber: SocketProber = {
        probe: async () => true,
      };

      await expect(
        startDaemon("/fake/socket", {
          socketProber,
          readinessTimeoutMs: 1000,
        }),
      ).rejects.toThrow(DaemonAlreadyRunningError);
    });

    test("throws DaemonReadinessTimeoutError if socket never becomes ready", async () => {
      const socketProber: SocketProber = {
        probe: async () => false,
      };

      const processProber: ProcessProber = {
        isAlive: () => true,
      };

      await expect(
        startDaemon("/fake/socket", {
          socketProber,
          processProber,
          readinessTimeoutMs: 100,
          daemonScript: "/fake/script",
        }),
      ).rejects.toThrow(DaemonReadinessTimeoutError);
    });

    test("throws if process dies during startup", async () => {
      let aliveCount = 0;
      const processProber: ProcessProber = {
        isAlive: () => {
          aliveCount++;
          return aliveCount <= 2;
        },
      };

      const socketProber: SocketProber = {
        probe: async () => false,
      };

      await expect(
        startDaemon("/fake/socket", {
          socketProber,
          processProber,
          readinessTimeoutMs: 1000,
          daemonScript: "/fake/script",
        }),
      ).rejects.toThrow("died during startup");
    });

    test("returns metadata when socket becomes ready", async () => {
      let probeCount = 0;
      const socketProber: SocketProber = {
        probe: async () => {
          probeCount++;
          return probeCount > 2;
        },
      };

      const processProber: ProcessProber = {
        isAlive: () => true,
      };

      const metadata = await startDaemon("/fake/socket", {
        socketProber,
        processProber,
        readinessTimeoutMs: 1000,
        daemonScript: "/fake/script",
      });

      expect(metadata.socketPath).toBe("/fake/socket");
      expect(typeof metadata.pid).toBe("number");
    });

    test("writes PID to pidPath if provided", async () => {
      const socketProber: SocketProber = {
        probe: async () => false,
      };

      const processProber: ProcessProber = {
        isAlive: () => true,
      };

      const pidPath = "/tmp/nonexistent/daemon.pid";

      await expect(
        startDaemon("/fake/socket", {
          socketProber,
          processProber,
          readinessTimeoutMs: 100,
          pidPath,
          daemonScript: "/fake/script",
        }),
      ).rejects.toThrow("PID file directory does not exist");
    });

    test("writes to logPath when provided", async () => {
      const tmpDir = join(process.env.TMPDIR || "/tmp", `jarvis-test-${Date.now()}`);
      mkdirSync(tmpDir, { recursive: true });

      try {
        const logPath = join(tmpDir, "daemon.log");
        const socketProber: SocketProber = {
          probe: async () => false,
        };

        const processProber: ProcessProber = {
          isAlive: () => true,
        };

        await expect(
          startDaemon("/fake/socket", {
            socketProber,
            processProber,
            readinessTimeoutMs: 100,
            daemonScript: "/fake/script",
            logPath,
          }),
        ).rejects.toThrow("Daemon failed to become ready");

        // Verify the log file was created
        expect(existsSync(logPath)).toBe(true);
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test("throws when logPath directory does not exist", async () => {
      const logPath = "/nonexistent/dir/daemon.log";

      const socketProber: SocketProber = {
        probe: async () => false,
      };

      const processProber: ProcessProber = {
        isAlive: () => true,
      };

      await expect(
        startDaemon("/fake/socket", {
          socketProber,
          processProber,
          readinessTimeoutMs: 100,
          daemonScript: "/fake/script",
          logPath,
        }),
      ).rejects.toThrow("Log file directory does not exist");
    });

    test("throws when logPath cannot be opened for writing", async () => {
      const tmpDir = join(process.env.TMPDIR || "/tmp", `jarvis-test-${Date.now()}`);
      mkdirSync(tmpDir, { recursive: true });

      try {
        // A directory at logPath cannot be opened for writing as a file
        const logPath = join(tmpDir, "daemon.log");
        mkdirSync(logPath);

        const socketProber: SocketProber = {
          probe: async () => false,
        };

        const processProber: ProcessProber = {
          isAlive: () => true,
        };

        await expect(
          startDaemon("/fake/socket", {
            socketProber,
            processProber,
            readinessTimeoutMs: 100,
            daemonScript: "/fake/script",
            logPath,
          }),
        ).rejects.toThrow("Failed to open log file for writing");
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test("rotates log file when at capacity", async () => {
      const tmpDir = join(process.env.TMPDIR || "/tmp", `jarvis-test-${Date.now()}`);
      mkdirSync(tmpDir, { recursive: true });

      try {
        const logPath = join(tmpDir, "daemon.log");
        const capBytes = 50;

        // Create initial log file with content that exceeds cap
        writeFileSync(logPath, "x".repeat(100));

        const socketProber: SocketProber = {
          probe: async () => false,
        };

        const processProber: ProcessProber = {
          isAlive: () => true,
        };

        await expect(
          startDaemon("/fake/socket", {
            socketProber,
            processProber,
            readinessTimeoutMs: 100,
            daemonScript: "/fake/script",
            logPath,
            logCapBytes: capBytes,
          }),
        ).rejects.toThrow("Daemon failed to become ready");

        // Verify rotation happened
        expect(existsSync(`${logPath}.1`)).toBe(true);
        const rotatedContent = readFileSync(`${logPath}.1`, "utf-8");
        expect(rotatedContent).toBe("x".repeat(100));
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test("does not create log file when logPath not provided", async () => {
      const tmpDir = join(process.env.TMPDIR || "/tmp", `jarvis-test-${Date.now()}`);
      mkdirSync(tmpDir, { recursive: true });

      try {
        const logPath = join(tmpDir, "should-not-exist.log");

        const socketProber: SocketProber = {
          probe: async () => false,
        };

        const processProber: ProcessProber = {
          isAlive: () => true,
        };

        await expect(
          startDaemon("/fake/socket", {
            socketProber,
            processProber,
            readinessTimeoutMs: 100,
            daemonScript: "/fake/script",
            // logPath omitted
          }),
        ).rejects.toThrow("Daemon failed to become ready");

        // Verify no log file was created
        expect(existsSync(logPath)).toBe(false);
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test("captures a real child's stdout into logPath", async () => {
      const tmpDir = join(process.env.TMPDIR || "/tmp", `jarvis-test-${Date.now()}`);
      mkdirSync(tmpDir, { recursive: true });

      try {
        const logPath = join(tmpDir, "daemon.log");
        const daemonScript = join(tmpDir, "fake-daemon.ts");
        writeFileSync(daemonScript, `console.log("child-output-marker");\n`);

        const socketProber: SocketProber = {
          probe: async () => false,
        };

        const processProber: ProcessProber = {
          isAlive: () => true,
        };

        await expect(
          startDaemon("/fake/socket", {
            socketProber,
            processProber,
            readinessTimeoutMs: 500,
            daemonScript,
            logPath,
          }),
        ).rejects.toThrow("Daemon failed to become ready");

        const content = await waitForLogMarkers(logPath, ["child-output-marker"]);
        expect(content).toContain("child-output-marker");
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test("appends the new daemon's output alongside a prior daemon's after restart", async () => {
      const tmpDir = join(process.env.TMPDIR || "/tmp", `jarvis-test-${Date.now()}`);
      mkdirSync(tmpDir, { recursive: true });

      try {
        const logPath = join(tmpDir, "daemon.log");

        const socketProber: SocketProber = {
          probe: async () => false,
        };

        const processProber: ProcessProber = {
          isAlive: () => true,
        };

        const firstScript = join(tmpDir, "fake-daemon-1.ts");
        writeFileSync(firstScript, `console.log("first-daemon-marker");\n`);

        await expect(
          startDaemon("/fake/socket", {
            socketProber,
            processProber,
            readinessTimeoutMs: 500,
            daemonScript: firstScript,
            logPath,
          }),
        ).rejects.toThrow("Daemon failed to become ready");

        const secondScript = join(tmpDir, "fake-daemon-2.ts");
        writeFileSync(secondScript, `console.log("second-daemon-marker");\n`);

        await expect(
          startDaemon("/fake/socket", {
            socketProber,
            processProber,
            readinessTimeoutMs: 500,
            daemonScript: secondScript,
            logPath,
          }),
        ).rejects.toThrow("Daemon failed to become ready");

        const content = await waitForLogMarkers(logPath, ["first-daemon-marker", "second-daemon-marker"]);
        expect(content).toContain("first-daemon-marker");
        expect(content).toContain("second-daemon-marker");
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  describe("stopDaemon", () => {
    const run = (id: string, status: Run["status"]): Run => ({
      id,
      project: "demo",
      specRef: "spec.md",
      createdAt: 1,
      status,
      attemptCount: 0,
      worktreePath: "/tmp/worktree",
      branch: "branch",
      specPath: "spec.md",
    });

    test("refuses every non-terminal durable run before shutdown", async () => {
      const processProber: ProcessProber = { isAlive: () => false };
      const stateStore = {
        listRuns: () => [
          run("queued-id", "queued"),
          run("live-id", "in-progress"),
          run("paused-id", "paused"),
          run("non-live-id", "budget-soft-stopped"),
        ],
        close: () => {},
      };

      await expect(stopDaemon("/nonexistent/socket", { stateStore, processProber })).rejects.toEqual(
        new DaemonStopRefusedError(["queued-id", "live-id", "paused-id", "non-live-id"]),
      );
    });

    test("allows all durable terminal statuses and refuses store failures", async () => {
      const processProber: ProcessProber = { isAlive: () => false };
      const stateStore = {
        listRuns: () => [
          run("completed-id", "completed"),
          run("failed-id", "failed"),
          run("blocked-id", "blocked"),
          run("killed-id", "killed"),
        ],
        close: () => {},
      };

      await expect(stopDaemon("/nonexistent/socket", { stateStore, processProber })).resolves.toBeUndefined();
      await expect(
        stopDaemon("/nonexistent/socket", {
          stateStore: {
            listRuns: () => {
              throw new Error("store unavailable");
            },
            close: () => {},
          },
          processProber,
        }),
      ).rejects.toEqual(new DaemonStopInspectionError(new Error("store unavailable")));
    });

    test("completes without error when process not alive", async () => {
      const processProber: ProcessProber = {
        isAlive: () => false,
      };

      await expect(
        stopDaemon("/nonexistent/socket", {
          force: true,
          processProber,
          drainTimeoutMs: 100,
          killTimeoutMs: 100,
        }),
      ).resolves.toBeUndefined();
    });

    test("completes without error when pidPath file missing", async () => {
      const processProber: ProcessProber = {
        isAlive: () => false,
      };

      await expect(
        stopDaemon("/fake/socket", {
          force: true,
          pidPath: "/nonexistent/pid",
          processProber,
          drainTimeoutMs: 100,
          killTimeoutMs: 100,
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe("supersede (retiring daemon)", () => {
    const { createWriteStep } = writeStepFixtures();

    test("idle daemon exits promptly after supersede", async () => {
      const dbPath = join(process.env.TMPDIR || "/tmp", `jarvis-retire-idle-${Date.now()}.sqlite`);
      let exitCalled = false;

      try {
        const store = openStateStore(dbPath);
        const runtime = await startDaemonRuntime(dbPath, store, undefined, {
          startIpcServer: async (_socketPath, handlers) => {
            await new Promise((r) => setImmediate(r));
            await Promise.resolve(
              (handlers as Record<string, RpcHandler>).supersede?.(rpcFrame("s1", "supersede"), rpcSignal()),
            );
            return { close: async () => undefined } as IpcServer;
          },
          processExit: (() => {
            exitCalled = true;
            return 0 as never;
          }) as (code: number) => never,
        });

        await new Promise((r) => setTimeout(r, 300));
        expect(exitCalled).toBe(true);
        await runtime.close().catch(() => undefined);
      } finally {
        rmSync(dbPath, { force: true });
      }
    });

    test("retiring daemon rejects new start requests with daemon_superseded", async () => {
      const dbPath = join(process.env.TMPDIR || "/tmp", `jarvis-retire-reject-start-${Date.now()}.sqlite`);
      try {
        const store = openStateStore(dbPath);
        let startHandler: RpcHandler | undefined;
        let supersedeHandler: RpcHandler | undefined;

        const runtime = await startDaemonRuntime(dbPath, store, undefined, {
          startIpcServer: stubIpcServer((handlers) => {
            startHandler = handlers.start;
            supersedeHandler = handlers.supersede;
          }),
        });

        await new Promise((r) => setImmediate(r));

        if (!supersedeHandler) throw new Error("supersede handler not registered");
        await supersedeHandler(rpcFrame("s1", "supersede"), rpcSignal());

        if (!startHandler) throw new Error("start handler not registered");
        const response = await startHandler(rpcFrame("start1", "start", { input: mockWriteLoopInput() }), rpcSignal());

        expect(response).toMatchObject({ kind: "error", code: "daemon_superseded" });
        expect(store.listRuns()).toEqual([]);

        await runtime.close();
      } finally {
        rmSync(dbPath, { force: true });
      }
    });

    test("retiring daemon rejects resume requests with daemon_superseded", async () => {
      const dbPath = join(process.env.TMPDIR || "/tmp", `jarvis-retire-reject-resume-${Date.now()}.sqlite`);
      try {
        const store = openStateStore(dbPath);
        const runId = store.createRun({
          project: "test",
          specRef: "main",
          worktreePath: "/tmp/test-worktree",
          branch: "test-branch",
          specPath: "spec.md",
          status: "paused",
        });

        let resumeHandler: RpcHandler | undefined;
        let supersedeHandler: RpcHandler | undefined;

        const runtime = await startDaemonRuntime(dbPath, store, undefined, {
          startIpcServer: stubIpcServer((handlers) => {
            resumeHandler = handlers.resume;
            supersedeHandler = handlers.supersede;
          }),
        });

        await new Promise((r) => setImmediate(r));

        if (!supersedeHandler) throw new Error("supersede handler not registered");
        await supersedeHandler(rpcFrame("s1", "supersede"), rpcSignal());

        if (!resumeHandler) throw new Error("resume handler not registered");
        const response = await resumeHandler(rpcFrame("resume1", "resume", { runId }), rpcSignal());

        expect(response).toMatchObject({ kind: "error", code: "daemon_superseded" });
        const run = store.loadRun(runId);
        expect(run?.status).toBe("paused");

        await runtime.close();
      } finally {
        rmSync(dbPath, { force: true });
      }
    });

    test("retiring daemon keeps health/list/wait working after supersede", async () => {
      const dbPath = join(process.env.TMPDIR || "/tmp", `jarvis-retire-keep-working-${Date.now()}.sqlite`);
      try {
        const store = openStateStore(dbPath);
        const runId = store.createRun({
          project: "test",
          specRef: "main",
          worktreePath: "/tmp/test-worktree",
          branch: "test-branch",
          specPath: "spec.md",
          status: "completed",
        });

        let listHandler: RpcHandler | undefined;
        let healthHandler: RpcHandler | undefined;
        let statusHandler: RpcHandler | undefined;
        let supersedeHandler: RpcHandler | undefined;

        const runtime = await startDaemonRuntime(dbPath, store, undefined, {
          startIpcServer: stubIpcServer((handlers) => {
            listHandler = handlers.list;
            healthHandler = handlers.health;
            statusHandler = handlers.status;
            supersedeHandler = handlers.supersede;
          }),
        });

        await new Promise((r) => setImmediate(r));

        if (!supersedeHandler) throw new Error("supersede handler not registered");
        await supersedeHandler(rpcFrame("s1", "supersede"), rpcSignal());

        if (!listHandler || !healthHandler || !statusHandler) throw new Error("handlers not registered");

        const healthResponse = await healthHandler(rpcFrame("h1", "health"), rpcSignal());
        expect(healthResponse).toMatchObject({ kind: "response", result: { ok: true } });

        const statusResponse = await statusHandler(rpcFrame("st1", "status"), rpcSignal());
        expect(statusResponse.kind).toBe("response");

        const listResponse = await listHandler(rpcFrame("l1", "list"), rpcSignal());
        expect(listResponse.kind).toBe("response");
        if (listResponse.kind === "response") {
          const result = listResponse.result as { runs?: unknown[] };
          expect(Array.isArray(result?.runs)).toBe(true);
          const runs = result?.runs || [];
          expect(runs.some((r: unknown) => (r as { runId?: unknown }).runId === runId)).toBe(true);
        }

        await runtime.close();
      } finally {
        rmSync(dbPath, { force: true });
      }
    });

    test("superseded daemon stays up until owned run settles then exits", async () => {
      const dbPath = join(process.env.TMPDIR || "/tmp", `jarvis-retire-active-run-${Date.now()}.sqlite`);
      const fakeExecutor = createFakeWriteLoopExecutor();
      let exitCalled = false;
      let handlers: Record<string, RpcHandler> | undefined;

      try {
        const store = openStateStore(dbPath);
        const runtime = await startDaemonRuntime(dbPath, store, undefined, {
          recoverReconciledRuns: async () => ({ resumed: 0 }),
          writeLoopExecutor: fakeExecutor.executor,
          hasMemoryHeadroom: () => true,
          settleDelayMs: 0,
          startIpcServer: stubIpcServer((h) => {
            handlers = h;
          }),
          processExit: (() => {
            exitCalled = true;
            return 0 as never;
          }) as (code: number) => never,
        });

        await flushBackgroundRuns();
        if (!handlers?.start || !handlers.supersede || !handlers.pause) throw new Error("handlers not registered");

        const startResponse = await handlers.start(
          rpcFrame("start1", "start", { input: mockWriteLoopInput() }),
          rpcSignal(),
        );
        expect(startResponse.kind).toBe("response");
        const runId =
          startResponse.kind === "response"
            ? (startResponse.result as { runId?: string } | undefined)?.runId
            : undefined;
        if (!runId) throw new Error("start did not return runId");
        expect(fakeExecutor.pendingCount()).toBe(1);
        expect(exitCalled).toBe(false);

        const supersedeResponse = await handlers.supersede(rpcFrame("s1", "supersede"), rpcSignal());
        expect(supersedeResponse).toMatchObject({ kind: "response", result: { ok: true } });
        expect(exitCalled).toBe(false);

        const pauseResponse = await handlers.pause(rpcFrame("p1", "pause", { runId }), rpcSignal());
        expect(pauseResponse).toMatchObject({ kind: "response", result: { ok: true } });
        expect(fakeExecutor.isPauseSignalTriggered()).toBe(true);

        const rejectedStart = await handlers.start(
          rpcFrame("start2", "start", {
            input: mockWriteLoopInput({ projectName: "other", branchName: "other" }),
          }),
          rpcSignal(),
        );
        expect(rejectedStart).toMatchObject({ kind: "error", code: "daemon_superseded" });
        expect(store.listRuns()).toHaveLength(1);

        fakeExecutor.settleAll();
        await flushBackgroundRuns();
        await new Promise((r) => setTimeout(r, 300));
        expect(exitCalled).toBe(true);

        await runtime.close().catch(() => undefined);
      } finally {
        rmSync(dbPath, { force: true });
      }
    });

    test("retiring daemon rejects workflow start with daemon_superseded", async () => {
      const dbPath = join(process.env.TMPDIR || "/tmp", `jarvis-retire-reject-workflow-${Date.now()}.sqlite`);
      try {
        const store = openStateStore(dbPath);
        let startHandler: RpcHandler | undefined;
        let supersedeHandler: RpcHandler | undefined;

        const runtime = await startDaemonRuntime(dbPath, store, undefined, {
          recoverReconciledRuns: async () => ({ resumed: 0 }),
          startIpcServer: stubIpcServer((handlers) => {
            startHandler = handlers.start;
            supersedeHandler = handlers.supersede;
          }),
        });

        await flushBackgroundRuns();

        if (!supersedeHandler) throw new Error("supersede handler not registered");
        await supersedeHandler(rpcFrame("s1", "supersede"), rpcSignal());

        if (!startHandler) throw new Error("start handler not registered");
        const response = await startHandler(
          rpcFrame("start1", "start", { steps: [createWriteStep("step-0", "workflow-branch")] }),
          rpcSignal(),
        );

        expect(response).toMatchObject({ kind: "error", code: "daemon_superseded" });
        expect(store.listRuns()).toEqual([]);

        await runtime.close();
      } finally {
        rmSync(dbPath, { force: true });
      }
    });

    test("retiring daemon does not promote queued runs when an active run settles", async () => {
      const dbPath = join(process.env.TMPDIR || "/tmp", `jarvis-retire-no-promote-${Date.now()}.sqlite`);
      const fakeExecutor = createFakeWriteLoopExecutor();

      try {
        const store = openStateStore(dbPath);
        let handlers: Record<string, RpcHandler> | undefined;
        const runtime = await startDaemonRuntime(dbPath, store, undefined, {
          recoverReconciledRuns: async () => ({ resumed: 0 }),
          writeLoopExecutor: fakeExecutor.executor,
          hasMemoryHeadroom: () => true,
          settleDelayMs: 0,
          startIpcServer: stubIpcServer((h) => {
            handlers = h;
          }),
          processExit: noopProcessExit,
        });

        await flushBackgroundRuns();
        if (!handlers?.start || !handlers.supersede) throw new Error("handlers not registered");

        await handlers.start(
          rpcFrame("start1", "start", {
            input: mockWriteLoopInput({
              projectName: "active-project",
              branchName: "active-branch",
            }),
          }),
          rpcSignal(),
        );
        expect(fakeExecutor.pendingCount()).toBe(1);

        await handlers.supersede(rpcFrame("s1", "supersede"), rpcSignal());

        const queuedRunId = store.createRun({
          project: "queued-project",
          specRef: "main",
          worktreePath: "/tmp/queued-project",
          branch: "queued-branch",
          specPath: "spec.md",
          status: "queued",
          queuedInput: mockWriteLoopInput({
            projectName: "queued-project",
            branchName: "queued-branch",
          }),
        });

        fakeExecutor.settleAll();
        await flushBackgroundRuns();

        expect(store.loadRun(queuedRunId)?.status).toBe("queued");
        expect(store.loadRun(queuedRunId)?.queuedInput).not.toBeNull();

        await runtime.close().catch(() => undefined);
      } finally {
        rmSync(dbPath, { force: true });
      }
    });

    test("supersede is idempotent", async () => {
      const dbPath = join(process.env.TMPDIR || "/tmp", `jarvis-retire-idempotent-${Date.now()}.sqlite`);
      try {
        const store = openStateStore(dbPath);
        let supersedeHandler: RpcHandler | undefined;

        const runtime = await startDaemonRuntime(dbPath, store, undefined, {
          recoverReconciledRuns: async () => ({ resumed: 0 }),
          startIpcServer: stubIpcServer((handlers) => {
            supersedeHandler = handlers.supersede;
          }),
          processExit: noopProcessExit,
        });

        await flushBackgroundRuns();
        if (!supersedeHandler) throw new Error("supersede handler not registered");

        const first = await supersedeHandler(rpcFrame("s1", "supersede"), rpcSignal());
        const second = await supersedeHandler(rpcFrame("s2", "supersede"), rpcSignal());

        expect(first).toMatchObject({ kind: "response", result: { ok: true } });
        expect(second).toMatchObject({ kind: "response", result: { ok: true } });

        await runtime.close().catch(() => undefined);
      } finally {
        rmSync(dbPath, { force: true });
      }
    });
  });

  describe("supersede peers at startup", () => {
    const ownSocketPath = "/jarvis-home/daemon-cccccccccccccccc.sock";

    test("sends supersede to every other digest-keyed socket and never to its own", async () => {
      const dbPath = join(process.env.TMPDIR || "/tmp", `jarvis-supersede-peers-${Date.now()}.sqlite`);
      const superseded: string[] = [];
      const tmpDir = join(process.env.TMPDIR || "/tmp", `jarvis-supersede-peers-home-${Date.now()}`);
      const previousHome = process.env.JARVIS_HOME;
      process.env.JARVIS_HOME = tmpDir;
      mkdirSync(tmpDir, { recursive: true });

      try {
        writeFileSync(join(tmpDir, "daemon-aaaaaaaaaaaaaaaa.sock"), "");
        writeFileSync(join(tmpDir, "daemon-bbbbbbbbbbbbbbbb.sock"), "");
        const ownSocket = join(tmpDir, "daemon-cccccccccccccccc.sock");

        const store = openStateStore(dbPath);
        await startDaemonRuntime(ownSocket, store, undefined, {
          recoverReconciledRuns: async () => ({ resumed: 0 }),
          sendSupersede: async (socketPath) => {
            superseded.push(socketPath);
          },
          startIpcServer: async () => ({ close: async () => undefined }) as IpcServer,
        });

        expect(superseded.sort()).toEqual(
          [join(tmpDir, "daemon-aaaaaaaaaaaaaaaa.sock"), join(tmpDir, "daemon-bbbbbbbbbbbbbbbb.sock")].sort(),
        );
        expect(superseded).not.toContain(ownSocket);
      } finally {
        if (previousHome === undefined) delete process.env.JARVIS_HOME;
        else process.env.JARVIS_HOME = previousHome;
        rmSync(tmpDir, { recursive: true, force: true });
        rmSync(dbPath, { force: true });
      }
    });

    test("listPeerDaemonSockets excludes own socket", () => {
      const tmpDir = join(process.env.TMPDIR || "/tmp", `jarvis-supersede-own-${Date.now()}`);
      mkdirSync(tmpDir, { recursive: true });

      try {
        const ownSocket = join(tmpDir, "daemon-bbbbbbbbbbbbbbbb.sock");
        writeFileSync(join(tmpDir, "daemon-aaaaaaaaaaaaaaaa.sock"), "");
        writeFileSync(ownSocket, "");

        expect(listPeerDaemonSockets(tmpDir, ownSocket)).not.toContain(ownSocket);
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test("listPeerDaemonSockets ignores pid, log, and config files", () => {
      const tmpDir = join(process.env.TMPDIR || "/tmp", `jarvis-supersede-filter-${Date.now()}`);
      mkdirSync(tmpDir, { recursive: true });

      try {
        const peerSocket = join(tmpDir, "daemon-aaaaaaaaaaaaaaaa.sock");
        writeFileSync(peerSocket, "");
        writeFileSync(join(tmpDir, "daemon-aaaaaaaaaaaaaaaa.pid"), "1");
        writeFileSync(join(tmpDir, "daemon-aaaaaaaaaaaaaaaa.log"), "log");
        writeFileSync(join(tmpDir, "config.json"), "{}");
        writeFileSync(join(tmpDir, "daemon.sock"), "");
        const ownSocket = join(tmpDir, "daemon-bbbbbbbbbbbbbbbb.sock");

        expect(listPeerDaemonSockets(tmpDir, ownSocket)).toEqual([peerSocket]);
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test("startup never connects to pid, log, or config files in jarvis home", async () => {
      const tmpDir = join(process.env.TMPDIR || "/tmp", `jarvis-supersede-connect-filter-${Date.now()}`);
      const previousHome = process.env.JARVIS_HOME;
      process.env.JARVIS_HOME = tmpDir;
      mkdirSync(tmpDir, { recursive: true });
      const dbPath = join(tmpDir, "state.sqlite");

      try {
        const peerSocket = join(tmpDir, "daemon-aaaaaaaaaaaaaaaa.sock");
        writeFileSync(peerSocket, "");
        writeFileSync(join(tmpDir, "daemon-aaaaaaaaaaaaaaaa.pid"), "1");
        writeFileSync(join(tmpDir, "daemon-aaaaaaaaaaaaaaaa.log"), "log");
        writeFileSync(join(tmpDir, "config.json"), "{}");

        const ownSocket = join(tmpDir, "daemon-bbbbbbbbbbbbbbbb.sock");
        const connected: string[] = [];
        const store = openStateStore(dbPath);
        await startDaemonRuntime(ownSocket, store, undefined, {
          recoverReconciledRuns: async () => ({ resumed: 0 }),
          sendSupersede: async (socketPath) => {
            connected.push(socketPath);
          },
          startIpcServer: async () => ({ close: async () => undefined }) as IpcServer,
        });

        expect(connected).toEqual([peerSocket]);
        expect(connected).not.toContain(join(tmpDir, "daemon-aaaaaaaaaaaaaaaa.pid"));
        expect(connected).not.toContain(join(tmpDir, "daemon-aaaaaaaaaaaaaaaa.log"));
        expect(connected).not.toContain(join(tmpDir, "config.json"));
      } finally {
        if (previousHome === undefined) delete process.env.JARVIS_HOME;
        else process.env.JARVIS_HOME = previousHome;
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test("a failing peer does not block other supersede sends or startup", async () => {
      const dbPath = join(process.env.TMPDIR || "/tmp", `jarvis-supersede-fail-peer-${Date.now()}.sqlite`);
      const superseded: string[] = [];
      let startHandler: RpcHandler | undefined;

      try {
        const store = openStateStore(dbPath);
        await startDaemonRuntime(ownSocketPath, store, undefined, {
          recoverReconciledRuns: async () => ({ resumed: 0 }),
          hasMemoryHeadroom: () => true,
          writeLoopExecutor: createFakeWriteLoopExecutor().executor,
          listPeerDaemonSockets: () => ["/jarvis-home/daemon-dead.sock", "/jarvis-home/daemon-live.sock"],
          sendSupersede: async (socketPath) => {
            superseded.push(socketPath);
            if (socketPath.endsWith("dead.sock")) {
              throw new Error("connect refused");
            }
          },
          startIpcServer: stubIpcServer((handlers) => {
            startHandler = handlers.start;
          }),
        });

        expect(superseded.sort()).toEqual(["/jarvis-home/daemon-dead.sock", "/jarvis-home/daemon-live.sock"].sort());

        if (!startHandler) throw new Error("start handler not registered");
        const response = await startHandler(rpcFrame("start1", "start", { input: mockWriteLoopInput() }), rpcSignal());
        expect(response.kind).toBe("response");
      } finally {
        rmSync(dbPath, { force: true });
      }
    });

    test("missing jarvis home leaves startup unaffected", async () => {
      const dbPath = join(process.env.TMPDIR || "/tmp", `jarvis-supersede-missing-home-${Date.now()}.sqlite`);
      const superseded: string[] = [];

      try {
        const store = openStateStore(dbPath);
        await startDaemonRuntime(ownSocketPath, store, undefined, {
          recoverReconciledRuns: async () => ({ resumed: 0 }),
          listPeerDaemonSockets: (home) => listPeerDaemonSockets(home, ownSocketPath),
          sendSupersede: async (socketPath) => {
            superseded.push(socketPath);
          },
          startIpcServer: async () => ({ close: async () => undefined }) as IpcServer,
        });

        expect(superseded).toEqual([]);
        expect(listPeerDaemonSockets("/nonexistent-jarvis-home", ownSocketPath)).toEqual([]);
      } finally {
        rmSync(dbPath, { force: true });
      }
    });

    test("supersede sends do not gate admission", async () => {
      const dbPath = join(process.env.TMPDIR || "/tmp", `jarvis-supersede-no-gate-${Date.now()}.sqlite`);
      let startHandler: RpcHandler | undefined;
      let releaseSlowPeer: (() => void) | undefined;

      try {
        const store = openStateStore(dbPath);
        const slowPeer = new Promise<void>((resolve) => {
          releaseSlowPeer = resolve;
        });

        const runtime = await startDaemonRuntime(ownSocketPath, store, undefined, {
          recoverReconciledRuns: async () => ({ resumed: 0 }),
          hasMemoryHeadroom: () => true,
          writeLoopExecutor: createFakeWriteLoopExecutor().executor,
          listPeerDaemonSockets: () => ["/jarvis-home/daemon-slow.sock"],
          sendSupersede: async () => {
            await slowPeer;
          },
          startIpcServer: stubIpcServer((handlers) => {
            startHandler = handlers.start;
          }),
        });

        if (!startHandler) throw new Error("start handler not registered");
        const response = await startHandler(rpcFrame("start1", "start", { input: mockWriteLoopInput() }), rpcSignal());
        expect(response.kind).toBe("response");

        releaseSlowPeer?.();
        await runtime.close().catch(() => undefined);
      } finally {
        rmSync(dbPath, { force: true });
      }
    });
  });

  describe("getDaemonStatus", () => {
    test("returns running when executable digests match even if HEAD differs", async () => {
      const processProber: ProcessProber = { isAlive: () => true };
      const socketProber: SocketProber = {
        probe: async () => true,
      };
      const status = await getDaemonStatus(1000, "/fake/socket", {
        processProber,
        socketProber,
        connectIpcClient: async () =>
          makeIpcClient([], {
            statusResult: { loadedRevision: "daemon-head", loadedExecutableDigest: "same-digest" },
          }),
        getCurrentRevision: async () => "cli-head",
        getExecutableDigest: async () => "same-digest",
      });
      expect(status).toEqual({
        state: "running",
        loadedRevision: "daemon-head",
        currentRevision: "cli-head",
      });
    });

    test("returns stale when executable digests differ", async () => {
      const processProber: ProcessProber = { isAlive: () => true };
      const socketProber: SocketProber = {
        probe: async () => true,
      };
      const status = await getDaemonStatus(1000, "/fake/socket", {
        processProber,
        socketProber,
        connectIpcClient: async () =>
          makeIpcClient([], {
            statusResult: { loadedRevision: "daemon-head", loadedExecutableDigest: "daemon-digest" },
          }),
        getCurrentRevision: async () => "cli-head",
        getExecutableDigest: async () => "cli-digest",
      });
      expect(status).toEqual({
        state: "stale",
        loadedRevision: "daemon-head",
        currentRevision: "cli-head",
      });
    });

    test("returns stopped if process not alive", async () => {
      const processProber: ProcessProber = {
        isAlive: () => false,
      };

      const status = await getDaemonStatus(9999, "/fake/socket", { processProber });
      expect(status).toEqual({ state: "stopped" });
    });

    test("returns stopped if socket probe fails", async () => {
      const processProber: ProcessProber = {
        isAlive: () => true,
      };

      const socketProber: SocketProber = {
        probe: async () => false,
      };

      const status = await getDaemonStatus(1000, "/fake/socket", {
        processProber,
        socketProber,
        healthTimeoutMs: 100,
      });
      expect(status).toEqual({ state: "stopped" });
    });
  });
});
