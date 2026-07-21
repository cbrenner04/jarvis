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

import type { Run } from "../persistence/state-store";
import { makeIpcClient } from "../testing/cli-test-helpers.ts";
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
            loadedRevision: "daemon-head",
            loadedExecutableDigest: "same-digest",
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
            loadedRevision: "daemon-head",
            loadedExecutableDigest: "daemon-digest",
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
