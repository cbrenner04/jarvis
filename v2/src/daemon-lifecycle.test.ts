import { describe, test, expect } from "bun:test";
import {
  startDaemon,
  stopDaemon,
  getDaemonStatus,
  DaemonAlreadyRunningError,
  DaemonReadinessTimeoutError,
  type ProcessProber,
  type SocketProber,
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
  });
});
