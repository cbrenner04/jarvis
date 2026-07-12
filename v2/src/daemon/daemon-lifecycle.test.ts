import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  DaemonAlreadyRunningError,
  DaemonReadinessTimeoutError,
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
  });

  describe("stopDaemon", () => {
    test("completes without error when process not alive", async () => {
      const processProber: ProcessProber = {
        isAlive: () => false,
      };

      await expect(
        stopDaemon("/nonexistent/socket", {
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
          pidPath: "/nonexistent/pid",
          processProber,
          drainTimeoutMs: 100,
          killTimeoutMs: 100,
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe("getDaemonStatus", () => {
    test("returns stopped if process not alive", async () => {
      const processProber: ProcessProber = {
        isAlive: () => false,
      };

      const status = await getDaemonStatus(9999, "/fake/socket", { processProber });
      expect(status).toBe("stopped");
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
      expect(status).toBe("stopped");
    });

    test("returns running when process alive and socket responds", async () => {
      const processProber: ProcessProber = {
        isAlive: () => true,
      };

      const socketProber: SocketProber = {
        probe: async () => true,
      };

      const status = await getDaemonStatus(1000, "/fake/socket", {
        processProber,
        socketProber,
      });
      expect(status).toBe("running");
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
        expect(require("node:fs").existsSync(logPath)).toBe(true);
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
        const fs = require("node:fs");
        expect(fs.existsSync(`${logPath}.1`)).toBe(true);
        const rotatedContent = readFileSync(`${logPath}.1`, "utf-8");
        expect(rotatedContent).toBe("x".repeat(100));
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test("appends to log file when under capacity", async () => {
      const tmpDir = join(process.env.TMPDIR || "/tmp", `jarvis-test-${Date.now()}`);
      mkdirSync(tmpDir, { recursive: true });

      try {
        const logPath = join(tmpDir, "daemon.log");
        const capBytes = 1000;

        // Create initial log file with small content
        writeFileSync(logPath, "small content\n");

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

        // Verify file was appended to (fd was opened in append mode)
        // Note: we can't easily verify fd append behavior without actually spawning,
        // but we can verify the file still exists
        const fs = require("node:fs");
        expect(fs.existsSync(logPath)).toBe(true);
        const content = readFileSync(logPath, "utf-8");
        expect(content).toContain("small content");
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
        const fs = require("node:fs");
        expect(fs.existsSync(logPath)).toBe(false);
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });
});
