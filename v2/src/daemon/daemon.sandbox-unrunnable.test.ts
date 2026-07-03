// Minimal smoke test: real detached process start/stop with health and status RPC wire check.
// This requires real OS process spawn, socket I/O, and verification that socket unbinds.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connectIpcClient } from "../ipc/client";
import type { ResponseFrame } from "../ipc/types";
import { canUseUnixSockets, socketProbeErrored } from "../testing/unix-socket";
import { startDaemon, stopDaemon } from "./daemon-lifecycle";

if (socketProbeErrored) {
  process.stderr.write("skip: daemon socket tests require socket support in /tmp\n");
}

const SOCKET_PATH = join(tmpdir(), `jarvis-daemon-test-${process.pid}-${Date.now()}.sock`);
const PID_PATH = join(tmpdir(), `jarvis-daemon-test-${process.pid}-${Date.now()}.pid`);
const socketTest = test.skipIf(!canUseUnixSockets());

beforeEach(() => {
  if (!canUseUnixSockets()) {
    return;
  }
  rmSync(SOCKET_PATH, { force: true });
  rmSync(PID_PATH, { force: true });
});

afterEach(() => {
  if (!canUseUnixSockets()) {
    return;
  }
  rmSync(SOCKET_PATH, { force: true });
  rmSync(PID_PATH, { force: true });
});

describe("daemon (real process)", () => {
  socketTest("detached daemon serves health and status, socket unbinds on stop", async () => {
    const metadata = await startDaemon(SOCKET_PATH, { pidPath: PID_PATH });

    expect(typeof metadata.pid).toBe("number");
    expect(metadata.socketPath).toBe(SOCKET_PATH);
    expect(metadata.pid).toBeGreaterThan(0);

    // Verify health response
    const healthClient = await connectIpcClient(SOCKET_PATH);
    healthClient.send({ kind: "request", id: "h1", method: "health" });
    const healthFrame = await healthClient.nextFrame();
    expect(healthFrame.kind).toBe("response");
    expect((healthFrame as ResponseFrame).result).toEqual({ ok: true });
    healthClient.close();

    // Verify status response
    const statusClient = await connectIpcClient(SOCKET_PATH);
    statusClient.send({ kind: "request", id: "s1", method: "status" });
    const statusFrame = await statusClient.nextFrame();
    expect(statusFrame.kind).toBe("response");
    expect((statusFrame as ResponseFrame).result).toEqual({ state: "running" });
    statusClient.close();

    // Stop daemon and verify socket unbinds
    await stopDaemon(SOCKET_PATH, { pidPath: PID_PATH });

    // Poll up to 10 attempts at 50ms intervals for socket unbind
    let socketUnbound = false;
    for (let i = 0; i < 10; i++) {
      try {
        await connectIpcClient(SOCKET_PATH);
        await new Promise((r) => setTimeout(r, 50));
      } catch {
        socketUnbound = true;
        break;
      }
    }
    expect(socketUnbound).toBe(true);
  });
});
