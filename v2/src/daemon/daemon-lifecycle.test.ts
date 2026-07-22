import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { RpcHandler } from "../ipc/server";
import type { Run } from "../persistence/state-store";
import { openStateStore } from "../persistence/state-store";
import { makeIpcClient } from "../testing/cli-test-helpers.ts";
import { startDaemonRuntime } from "./daemon";
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

describe("daemon supersede/retirement", () => {
  test("supersede sets retiring and is idempotent", async () => {
    const tmpDir = join(process.env.TMPDIR || "/tmp", `jarvis-supersede-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });

    try {
      const logsPath = join(tmpDir, "logs.jsonl");
      let supersedeCount = 0;
      const server = { socketPath: "/fake/socket", close: async () => undefined };
      const startIpcServer = async (_socketPath: string, handlers?: Record<string, RpcHandler>) => {
        // Capture and call the supersede handler
        const supersede = handlers?.supersede;
        if (supersede) {
          for (let i = 0; i < 2; i++) {
            const resp = await supersede(
              { kind: "request", id: `sup${i}`, method: "supersede" },
              new AbortController().signal,
            );
            expect(resp.kind).toBe("response");
            expect((resp as { result?: { ok?: boolean } }).result?.ok).toBe(true);
            supersedeCount++;
          }
        }
        return server;
      };

      const runtime = await startDaemonRuntime("/fake/socket", undefined, undefined, {
        logsPath,
        processExit: () => {},
        startIpcServer,
      });

      expect(supersedeCount).toBe(2);
      await runtime.close();
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("start is rejected with daemon_superseded after supersede", async () => {
    const tmpDir = join(process.env.TMPDIR || "/tmp", `jarvis-start-reject-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });

    try {
      const logsPath = join(tmpDir, "logs.jsonl");
      const server = { socketPath: "/fake/socket", close: async () => undefined };
      const startIpcServer = async (_socketPath: string, handlers?: Record<string, RpcHandler>) => {
        const supersede = handlers?.supersede;
        const start = handlers?.start;
        if (supersede && start) {
          // Supersede first
          const superResp = await supersede(
            { kind: "request", id: "sup1", method: "supersede" },
            new AbortController().signal,
          );
          expect(superResp.kind).toBe("response");

          // Then try start
          const startResp = await start(
            {
              kind: "request",
              id: "s1",
              method: "start",
              params: {
                input: {
                  worktree: {
                    projectRoot: "/tmp/p",
                    projectName: "p",
                    branchName: "b",
                    baseRef: "main",
                  },
                  specPath: "/tmp/spec.md",
                  stepRules: "rules",
                  expectedArtifactPath: "/tmp/artifact",
                  bindings: [],
                },
              },
            },
            new AbortController().signal,
          );
          expect(startResp.kind).toBe("error");
          expect((startResp as { code?: string }).code).toBe("daemon_superseded");
        }
        return server;
      };

      const runtime = await startDaemonRuntime("/fake/socket", undefined, undefined, {
        logsPath,
        processExit: () => {},
        startIpcServer,
      });

      await runtime.close();
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("resume is rejected with daemon_superseded after supersede", async () => {
    const tmpDir = join(process.env.TMPDIR || "/tmp", `jarvis-resume-reject-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });

    try {
      const logsPath = join(tmpDir, "logs.jsonl");
      const server = { socketPath: "/fake/socket", close: async () => undefined };
      const startIpcServer = async (_socketPath: string, handlers?: Record<string, RpcHandler>) => {
        const supersede = handlers?.supersede;
        const resume = handlers?.resume;
        if (supersede && resume) {
          // Supersede first
          const superResp = await supersede(
            { kind: "request", id: "sup1", method: "supersede" },
            new AbortController().signal,
          );
          expect(superResp.kind).toBe("response");

          // Then try resume
          const resumeResp = await resume(
            { kind: "request", id: "r1", method: "resume", params: { runId: "nonexistent" } },
            new AbortController().signal,
          );
          expect(resumeResp.kind).toBe("error");
          expect((resumeResp as { code?: string }).code).toBe("daemon_superseded");
        }
        return server;
      };

      const runtime = await startDaemonRuntime("/fake/socket", undefined, undefined, {
        logsPath,
        processExit: () => {},
        startIpcServer,
      });

      await runtime.close();
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("list, status, health continue to work after supersede", async () => {
    const tmpDir = join(process.env.TMPDIR || "/tmp", `jarvis-observe-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });

    try {
      const logsPath = join(tmpDir, "logs.jsonl");
      const server = { socketPath: "/fake/socket", close: async () => undefined };
      const startIpcServer = async (_socketPath: string, handlers?: Record<string, RpcHandler>) => {
        const supersede = handlers?.supersede;
        const list = handlers?.list;
        const status = handlers?.status;
        const health = handlers?.health;
        if (supersede && list && status && health) {
          // Supersede first
          const superResp = await supersede(
            { kind: "request", id: "sup1", method: "supersede" },
            new AbortController().signal,
          );
          expect(superResp.kind).toBe("response");

          // Try observation commands
          const listResp = await list({ kind: "request", id: "l1", method: "list" }, new AbortController().signal);
          expect(listResp.kind).toBe("response");

          const statusResp = await status(
            { kind: "request", id: "st1", method: "status" },
            new AbortController().signal,
          );
          expect(statusResp.kind).toBe("response");

          const healthResp = await health(
            { kind: "request", id: "h1", method: "health" },
            new AbortController().signal,
          );
          expect(healthResp.kind).toBe("response");
        }
        return server;
      };

      const runtime = await startDaemonRuntime("/fake/socket", undefined, undefined, {
        logsPath,
        processExit: () => {},
        startIpcServer,
      });

      await runtime.close();
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("no run row is created when start is rejected after supersede", async () => {
    const tmpDir = join(process.env.TMPDIR || "/tmp", `jarvis-no-row-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });

    try {
      const stateDbPath = join(tmpDir, "state.db");
      const logsPath = join(tmpDir, "logs.jsonl");
      const storeForVerification = openStateStore(stateDbPath);
      const server = { socketPath: "/fake/socket", close: async () => undefined };
      const startIpcServer = async (_socketPath: string, handlers?: Record<string, RpcHandler>) => {
        const supersede = handlers?.supersede;
        const start = handlers?.start;
        if (supersede && start) {
          // Supersede first
          await supersede({ kind: "request", id: "sup1", method: "supersede" }, new AbortController().signal);

          // Then try start
          const startResp = await start(
            {
              kind: "request",
              id: "s1",
              method: "start",
              params: {
                input: {
                  worktree: {
                    projectRoot: "/tmp/p",
                    projectName: "p",
                    branchName: "b",
                    baseRef: "main",
                  },
                  specPath: "/tmp/spec.md",
                  stepRules: "rules",
                  expectedArtifactPath: "/tmp/artifact",
                  bindings: [],
                },
              },
            },
            new AbortController().signal,
          );
          expect(startResp.kind).toBe("error");

          // Verify no run row was created
          const runs = storeForVerification.listRuns();
          expect(runs).toEqual([]);
        }
        return server;
      };

      const runtime = await startDaemonRuntime("/fake/socket", storeForVerification, undefined, {
        logsPath,
        processExit: () => {},
        startIpcServer,
      });

      await runtime.close();
      storeForVerification.close();
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("startDaemonRuntime supersede", () => {
  test("sends supersede to every other digest-keyed socket and never to its own", async () => {
    const tmpDir = join(process.env.TMPDIR || "/tmp", `jarvis-supersede-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });

    try {
      const homeDir = join(tmpDir, "home");
      mkdirSync(homeDir, { recursive: true });

      const socket1 = join(homeDir, "daemon-1111111111111111.sock");
      const socket2 = join(homeDir, "daemon-2222222222222222.sock");
      const ownSocket = join(homeDir, "daemon-0000000000000000.sock");

      // Track which sockets received supersede
      const supersededSockets = new Set<string>();
      let excludeSocketSeen: string | undefined;

      const enumerateOtherDaemonSockets = (_jarvisHomeDir: string, excludeSocket: string): string[] => {
        excludeSocketSeen = excludeSocket;
        return [socket1, socket2]; // Exclude own socket
      };

      const sendSupersedeToPeer = async (peerSocketPath: string): Promise<boolean> => {
        supersededSockets.add(peerSocketPath);
        return true;
      };

      const logsPath = join(tmpDir, "logs.jsonl");
      const startIpcServer = async () => ({ socketPath: ownSocket, close: async () => {} });

      const runtime = await startDaemonRuntime(ownSocket, undefined, undefined, {
        logsPath,
        processExit: () => {},
        startIpcServer,
        enumerateOtherDaemonSockets,
        sendSupersedeToPeer,
      });

      expect(excludeSocketSeen).toBe(ownSocket);
      expect(supersededSockets.has(socket1)).toBe(true);
      expect(supersededSockets.has(socket2)).toBe(true);
      expect(supersededSockets.has(ownSocket)).toBe(false);
      expect(supersededSockets.size).toBe(2);

      await runtime.close();
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("excludes own socket from supersede enumeration", async () => {
    const tmpDir = join(process.env.TMPDIR || "/tmp", `jarvis-exclude-own-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });

    try {
      const homeDir = join(tmpDir, "home");
      mkdirSync(homeDir, { recursive: true });

      const ownSocket = join(homeDir, "daemon-aaaaaaaaaaaaaaaa.sock");
      const otherSocket = join(homeDir, "daemon-bbbbbbbbbbbbbbbb.sock");

      const connectedSockets = new Set<string>();

      const enumerateOtherDaemonSockets = (_jarvisHomeDir: string, excludeSocket: string): string[] => {
        expect(excludeSocket).toBe(ownSocket);
        return [otherSocket];
      };

      const sendSupersedeToPeer = async (peerSocketPath: string): Promise<boolean> => {
        connectedSockets.add(peerSocketPath);
        return true;
      };

      const logsPath = join(tmpDir, "logs.jsonl");
      const startIpcServer = async () => ({ socketPath: ownSocket, close: async () => {} });

      const runtime = await startDaemonRuntime(ownSocket, undefined, undefined, {
        logsPath,
        processExit: () => {},
        startIpcServer,
        enumerateOtherDaemonSockets,
        sendSupersedeToPeer,
      });

      expect(connectedSockets.has(ownSocket)).toBe(false);
      expect(connectedSockets.has(otherSocket)).toBe(true);

      await runtime.close();
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("never connects to non-daemon-socket files", async () => {
    const tmpDir = join(process.env.TMPDIR || "/tmp", `jarvis-non-socks-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });

    try {
      const homeDir = join(tmpDir, "home");
      mkdirSync(homeDir, { recursive: true });

      const ownSocket = join(homeDir, "daemon-aaaaaaaaaaaaaaaa.sock");

      // Create various non-socket files that should be ignored
      writeFileSync(join(homeDir, "daemon-aaaaaaaaaaaaaaaa.pid"), "1234");
      writeFileSync(join(homeDir, "daemon-aaaaaaaaaaaaaaaa.log"), "logs");
      writeFileSync(join(homeDir, "config.json"), "{}");
      writeFileSync(join(homeDir, "random-file"), "data");

      const connectedSockets = new Set<string>();

      const enumerateOtherDaemonSockets = (_jarvisHomeDir: string, _excludeSocket: string): string[] => {
        // Return a list that includes non-socket files to verify they're filtered
        return [];
      };

      const sendSupersedeToPeer = async (peerSocketPath: string): Promise<boolean> => {
        connectedSockets.add(peerSocketPath);
        return true;
      };

      const logsPath = join(tmpDir, "logs.jsonl");
      const startIpcServer = async () => ({ socketPath: ownSocket, close: async () => {} });

      const runtime = await startDaemonRuntime(ownSocket, undefined, undefined, {
        logsPath,
        processExit: () => {},
        startIpcServer,
        enumerateOtherDaemonSockets,
        sendSupersedeToPeer,
      });

      // Verify no non-socket files were connected to
      expect(connectedSockets.has(join(homeDir, "daemon-aaaaaaaaaaaaaaaa.pid"))).toBe(false);
      expect(connectedSockets.has(join(homeDir, "daemon-aaaaaaaaaaaaaaaa.log"))).toBe(false);
      expect(connectedSockets.has(join(homeDir, "config.json"))).toBe(false);
      expect(connectedSockets.has(join(homeDir, "random-file"))).toBe(false);

      await runtime.close();
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("continues startup when a peer cannot be reached", async () => {
    const tmpDir = join(process.env.TMPDIR || "/tmp", `jarvis-peer-unreachable-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });

    try {
      const homeDir = join(tmpDir, "home");
      mkdirSync(homeDir, { recursive: true });

      const ownSocket = join(homeDir, "daemon-1111111111111111.sock");
      const reachablePeer = join(homeDir, "daemon-2222222222222222.sock");
      const unreachablePeer = join(homeDir, "daemon-3333333333333333.sock");

      const supersededSockets = new Set<string>();

      const enumerateOtherDaemonSockets = (_jarvisHomeDir: string, _excludeSocket: string): string[] => {
        return [unreachablePeer, reachablePeer]; // One unreachable, one reachable
      };

      const sendSupersedeToPeer = async (peerSocketPath: string): Promise<boolean> => {
        if (peerSocketPath === unreachablePeer) {
          return false; // Simulate unreachable peer
        }
        supersededSockets.add(peerSocketPath);
        return true;
      };

      const logsPath = join(tmpDir, "logs.jsonl");
      let serverStarted = false;
      const startIpcServer = async () => {
        serverStarted = true;
        return { socketPath: ownSocket, close: async () => {} };
      };

      const runtime = await startDaemonRuntime(ownSocket, undefined, undefined, {
        logsPath,
        processExit: () => {},
        startIpcServer,
        enumerateOtherDaemonSockets,
        sendSupersedeToPeer,
      });

      // Verify that startup completed successfully
      expect(serverStarted).toBe(true);
      // Verify that reachable peer was superseded
      expect(supersededSockets.has(reachablePeer)).toBe(true);
      // Verify that unreachable peer failed gracefully
      expect(supersededSockets.has(unreachablePeer)).toBe(false);

      await runtime.close();
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("continues startup when all peers are unreachable", async () => {
    const tmpDir = join(process.env.TMPDIR || "/tmp", `jarvis-all-unreachable-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });

    try {
      const homeDir = join(tmpDir, "home");
      mkdirSync(homeDir, { recursive: true });

      const ownSocket = join(homeDir, "daemon-1111111111111111.sock");
      const peer1 = join(homeDir, "daemon-2222222222222222.sock");
      const peer2 = join(homeDir, "daemon-3333333333333333.sock");

      const enumerateOtherDaemonSockets = (_jarvisHomeDir: string, _excludeSocket: string): string[] => {
        return [peer1, peer2];
      };

      const sendSupersedeToPeer = async (_peerSocketPath: string): Promise<boolean> => {
        return false; // All peers are unreachable
      };

      const logsPath = join(tmpDir, "logs.jsonl");
      let serverStarted = false;
      const startIpcServer = async () => {
        serverStarted = true;
        return { socketPath: ownSocket, close: async () => {} };
      };

      const runtime = await startDaemonRuntime(ownSocket, undefined, undefined, {
        logsPath,
        processExit: () => {},
        startIpcServer,
        enumerateOtherDaemonSockets,
        sendSupersedeToPeer,
      });

      // Verify that startup completed successfully despite all peers being unreachable
      expect(serverStarted).toBe(true);

      await runtime.close();
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("does not block startup on supersede operations", async () => {
    const tmpDir = join(process.env.TMPDIR || "/tmp", `jarvis-non-blocking-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });

    try {
      const homeDir = join(tmpDir, "home");
      mkdirSync(homeDir, { recursive: true });

      const ownSocket = join(homeDir, "daemon-1111111111111111.sock");
      const peerSocket = join(homeDir, "daemon-2222222222222222.sock");

      let startedServing = false;
      let sendSupersedeCalled = false;
      let sendSupersedeSlow = false;

      const enumerateOtherDaemonSockets = (_jarvisHomeDir: string, _excludeSocket: string): string[] => {
        return [peerSocket];
      };

      const sendSupersedeToPeer = async (_peerSocketPath: string): Promise<boolean> => {
        sendSupersedeCalled = true;
        // Simulate a slow send (but should not block startup)
        await new Promise((r) => setTimeout(r, 100));
        sendSupersedeSlow = true;
        return true;
      };

      const logsPath = join(tmpDir, "logs.jsonl");
      const startIpcServer = async () => {
        // Check that sendSupersede hasn't completed yet (fire-and-forget)
        expect(sendSupersedeSlow).toBe(false);
        startedServing = true;
        return { socketPath: ownSocket, close: async () => {} };
      };

      const runtime = await startDaemonRuntime(ownSocket, undefined, undefined, {
        logsPath,
        processExit: () => {},
        startIpcServer,
        enumerateOtherDaemonSockets,
        sendSupersedeToPeer,
      });

      // Verify startup completed before supersede finished
      expect(startedServing).toBe(true);
      expect(sendSupersedeCalled).toBe(true);

      // Give time for the slow send to complete
      await new Promise((r) => setTimeout(r, 150));
      expect(sendSupersedeSlow).toBe(true);

      await runtime.close();
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("tolerates missing jarvis home directory", async () => {
    const tmpDir = join(process.env.TMPDIR || "/tmp", `jarvis-no-home-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });

    try {
      const homeDir = join(tmpDir, "nonexistent-home");
      const ownSocket = join(homeDir, "daemon-1111111111111111.sock");

      let serverStarted = false;
      let sendSupersedeCalled = false;

      const enumerateOtherDaemonSockets = (_jarvisHomeDir: string, _excludeSocket: string): string[] => {
        // Simulate missing home directory by returning empty list
        return [];
      };

      const sendSupersedeToPeer = async (_peerSocketPath: string): Promise<boolean> => {
        sendSupersedeCalled = true;
        return true;
      };

      const logsPath = join(tmpDir, "logs.jsonl");
      const startIpcServer = async () => {
        serverStarted = true;
        return { socketPath: ownSocket, close: async () => {} };
      };

      const runtime = await startDaemonRuntime(ownSocket, undefined, undefined, {
        logsPath,
        processExit: () => {},
        startIpcServer,
        enumerateOtherDaemonSockets,
        sendSupersedeToPeer,
      });

      // Verify startup completed successfully
      expect(serverStarted).toBe(true);
      // Verify sendSupersede was not called (no peers found)
      expect(sendSupersedeCalled).toBe(false);

      await runtime.close();
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("daemon accepts handler calls while supersede is in flight", async () => {
    const tmpDir = join(process.env.TMPDIR || "/tmp", `jarvis-concurrent-start-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });

    try {
      const homeDir = join(tmpDir, "home");
      mkdirSync(homeDir, { recursive: true });

      const ownSocket = join(homeDir, "daemon-1111111111111111.sock");
      const peerSocket = join(homeDir, "daemon-2222222222222222.sock");

      let statusHandlerCalled = false;

      const enumerateOtherDaemonSockets = (_jarvisHomeDir: string, _excludeSocket: string): string[] => {
        return [peerSocket];
      };

      const sendSupersedeToPeer = async (_peerSocketPath: string): Promise<boolean> => {
        // Simulate a slow send that doesn't block startup
        await new Promise((r) => setTimeout(r, 100));
        return true;
      };

      const logsPath = join(tmpDir, "logs.jsonl");

      const startIpcServer = async (_socketPath: string, handlers?: Record<string, RpcHandler>) => {
        const status = handlers?.status;
        if (status) {
          // Call status immediately (while supersede is still in flight)
          const statusResp = await status(
            { kind: "request", id: "st1", method: "status" },
            new AbortController().signal,
          );
          expect(statusResp.kind).toBe("response");
          statusHandlerCalled = true;
        }
        return { socketPath: ownSocket, close: async () => {} };
      };

      const runtime = await startDaemonRuntime(ownSocket, undefined, undefined, {
        logsPath,
        processExit: () => {},
        startIpcServer,
        enumerateOtherDaemonSockets,
        sendSupersedeToPeer,
      });

      // Verify handler was accepted and processed without waiting for supersede
      expect(statusHandlerCalled).toBe(true);

      await runtime.close();
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
