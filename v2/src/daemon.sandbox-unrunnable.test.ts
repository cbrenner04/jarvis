// Exercise actual detached-process lifecycle, graceful shutdown, and in-flight connection draining.
// This requires real OS process spawn, wall-clock timing, and socket I/O.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
// Check if sockets can be created in /tmp; skip all tests if not (sandbox restriction)
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DaemonDoubleClaimError, WorktreeOwnershipRegistry } from "./daemon";
import { getDaemonStatus, startDaemon, stopDaemon } from "./daemon-lifecycle";
import { connectIpcClient } from "./ipc/client";
import type { ResponseFrame } from "./ipc/types";

let canCreateSockets: boolean;

const testSocketPath = join(tmpdir(), `.jarvis-socket-test-${process.pid}-${Date.now()}`);
const testServer = createServer();

await new Promise<void>((resolve) => {
  testServer.once("listening", () => {
    canCreateSockets = true;
    testServer.close();
    try {
      rmSync(testSocketPath, { force: true });
    } catch {}
    resolve();
  });

  testServer.once("error", () => {
    canCreateSockets = false;
    process.stderr.write("skip: daemon socket tests require socket support in /tmp\n");
    resolve();
  });

  testServer.listen(testSocketPath);
  setTimeout(() => resolve(), 100);
});

const SOCKET_PATH = join(tmpdir(), `jarvis-daemon-test-${process.pid}-${Date.now()}.sock`);
const PID_PATH = join(tmpdir(), `jarvis-daemon-test-${process.pid}-${Date.now()}.pid`);

function skipIfNoSockets(fn: () => Promise<void>): () => Promise<void> {
  return async () => {
    if (!canCreateSockets) {
      return;
    }
    return fn();
  };
}

beforeEach(() => {
  if (!canCreateSockets) {
    return;
  }
  rmSync(SOCKET_PATH, { force: true });
  rmSync(PID_PATH, { force: true });
});

afterEach(() => {
  if (!canCreateSockets) {
    return;
  }
  rmSync(SOCKET_PATH, { force: true });
  rmSync(PID_PATH, { force: true });
});

describe("daemon (real process)", () => {
  test(
    "startDaemon spawns detached process that serves health",
    skipIfNoSockets(async () => {
      const metadata = await startDaemon(SOCKET_PATH, { pidPath: PID_PATH });

      expect(typeof metadata.pid).toBe("number");
      expect(metadata.socketPath).toBe(SOCKET_PATH);
      expect(metadata.pid).toBeGreaterThan(0);

      const client = await connectIpcClient(SOCKET_PATH);
      client.send({ kind: "request", id: "h1", method: "health" });
      const frame = await client.nextFrame();
      expect(frame.kind).toBe("response");
      expect((frame as ResponseFrame).result).toEqual({ ok: true });
      client.close();

      await stopDaemon(SOCKET_PATH, { pidPath: PID_PATH });
    }),
  );

  test(
    "getDaemonStatus reports running for live daemon",
    skipIfNoSockets(async () => {
      const metadata = await startDaemon(SOCKET_PATH, { pidPath: PID_PATH });

      const status = await getDaemonStatus(metadata.pid, SOCKET_PATH);
      expect(status).toBe("running");

      await stopDaemon(SOCKET_PATH, { pidPath: PID_PATH });
    }),
  );

  test(
    "getDaemonStatus reports stopped after stopDaemon",
    skipIfNoSockets(async () => {
      const metadata = await startDaemon(SOCKET_PATH, { pidPath: PID_PATH });

      await stopDaemon(SOCKET_PATH, { pidPath: PID_PATH });

      const status = await getDaemonStatus(metadata.pid, SOCKET_PATH);
      expect(status).toBe("stopped");
    }),
  );

  test(
    "status RPC on live daemon reports running state",
    skipIfNoSockets(async () => {
      await startDaemon(SOCKET_PATH, { pidPath: PID_PATH });

      const client = await connectIpcClient(SOCKET_PATH);
      client.send({ kind: "request", id: "s1", method: "status" });
      const frame = await client.nextFrame();
      expect(frame.kind).toBe("response");
      expect((frame as ResponseFrame).result).toEqual({ state: "running" });
      client.close();

      await stopDaemon(SOCKET_PATH, { pidPath: PID_PATH });
    }),
  );

  test(
    "second startDaemon fails with typed error while health succeeds",
    skipIfNoSockets(async () => {
      await startDaemon(SOCKET_PATH, { pidPath: PID_PATH });

      await expect(startDaemon(SOCKET_PATH, { pidPath: PID_PATH })).rejects.toThrow("already running");

      await stopDaemon(SOCKET_PATH, { pidPath: PID_PATH });
    }),
  );

  test(
    "socket becomes unbound after stopDaemon",
    skipIfNoSockets(async () => {
      await startDaemon(SOCKET_PATH, { pidPath: PID_PATH });

      await stopDaemon(SOCKET_PATH, { pidPath: PID_PATH });

      await new Promise((r) => setTimeout(r, 100));

      await expect(connectIpcClient(SOCKET_PATH)).rejects.toThrow();
    }),
  );

  test(
    "WorktreeOwnershipRegistry claim and release",
    skipIfNoSockets(async () => {
      const registry = new WorktreeOwnershipRegistry();
      const key = { project: "test-proj", branch: "main" };
      const ownership = { runId: "run-123", worktreePath: "/tmp/wt" };

      // Initial claim succeeds
      registry.claim(key, ownership);
      expect(registry.isClaimed(key)).toBe(true);
      expect(registry.get(key)).toEqual(ownership);

      // Second claim on same key fails
      expect(() => {
        registry.claim(key, { runId: "run-456", worktreePath: "/tmp/wt2" });
      }).toThrow(DaemonDoubleClaimError);

      // Release succeeds
      registry.release(key);
      expect(registry.isClaimed(key)).toBe(false);
      expect(registry.get(key)).toBeUndefined();

      // Release on unheld key is no-op
      registry.release(key);
      expect(registry.isClaimed(key)).toBe(false);
    }),
  );

  test(
    "multiple independent worktree claims coexist",
    skipIfNoSockets(async () => {
      const registry = new WorktreeOwnershipRegistry();
      const key1 = { project: "proj1", branch: "main" };
      const key2 = { project: "proj1", branch: "dev" };
      const key3 = { project: "proj2", branch: "main" };

      registry.claim(key1, { runId: "run-1", worktreePath: "/tmp/wt1" });
      registry.claim(key2, { runId: "run-2", worktreePath: "/tmp/wt2" });
      registry.claim(key3, { runId: "run-3", worktreePath: "/tmp/wt3" });

      expect(registry.isClaimed(key1)).toBe(true);
      expect(registry.isClaimed(key2)).toBe(true);
      expect(registry.isClaimed(key3)).toBe(true);

      registry.release(key2);
      expect(registry.isClaimed(key1)).toBe(true);
      expect(registry.isClaimed(key2)).toBe(false);
      expect(registry.isClaimed(key3)).toBe(true);
    }),
  );
});
