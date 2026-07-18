// Minimal smoke test: real detached process start/stop with health and status RPC wire check.
// Requires real OS process spawn, socket I/O, and verification that socket unbinds on stop.
// Mocked SocketProber/ProcessProber seams in daemon-lifecycle.test.ts cannot substitute:
// this test validates end-to-end detached daemon spawn, IPC health/status, and socket teardown.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connectIpcClient } from "../ipc/client";
import type { ResponseFrame } from "../ipc/types";
import { openStateStore } from "../persistence/state-store";
import { canUseUnixSockets, socketProbeErrored } from "../testing/unix-socket";
import { startDaemon as startInProcessDaemon } from "./daemon";
import { startDaemon, stopDaemon } from "./daemon-lifecycle";
import { parseListRuns } from "./daemon-wire";

if (socketProbeErrored) {
  process.stderr.write("skip: daemon socket tests require socket support in /tmp\n");
}

const SOCKET_PATH = join(tmpdir(), `jarvis-daemon-test-${process.pid}-${Date.now()}.sock`);
const PID_PATH = join(tmpdir(), `jarvis-daemon-test-${process.pid}-${Date.now()}.pid`);
const LIST_SOCKET_PATH = join(tmpdir(), `jarvis-daemon-list-test-${process.pid}-${Date.now()}.sock`);
const STATE_DB_PATH = join(tmpdir(), `jarvis-daemon-list-test-${process.pid}-${Date.now()}.sqlite`);
const PRIOR_OWNER_IDENTITY = "11111:1000000";
const SWEEP_OWNER_IDENTITY = "22222:2000000";
const socketTest = test.skipIf(!canUseUnixSockets());

beforeEach(() => {
  if (!canUseUnixSockets()) {
    return;
  }
  rmSync(SOCKET_PATH, { force: true });
  rmSync(PID_PATH, { force: true });
  rmSync(LIST_SOCKET_PATH, { force: true });
  rmSync(STATE_DB_PATH, { force: true });
});

afterEach(() => {
  if (!canUseUnixSockets()) {
    return;
  }
  rmSync(SOCKET_PATH, { force: true });
  rmSync(PID_PATH, { force: true });
  rmSync(LIST_SOCKET_PATH, { force: true });
  rmSync(STATE_DB_PATH, { force: true });
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
    const statusResult = (statusFrame as ResponseFrame).result as { state?: string; loadedRevision?: string };
    expect(statusResult.state).toBe("running");
    expect(typeof statusResult.loadedRevision).toBe("string");
    statusClient.close();

    // Stop daemon and verify socket unbinds
    await stopDaemon(SOCKET_PATH, { pidPath: PID_PATH });

    // Poll up to 10 attempts at 50ms intervals for socket unbind
    let socketUnbound = false;
    for (let i = 0; i < 10; i++) {
      try {
        const client = await connectIpcClient(SOCKET_PATH);
        client.close();
        await new Promise((r) => setTimeout(r, 50));
      } catch {
        socketUnbound = true;
        break;
      }
    }
    expect(socketUnbound).toBe(true);
  });

  // Uses the in-process startDaemon (not the detached-spawn startDaemon/stopDaemon above):
  // seeding a run row requires a direct reference to the state store, which only the
  // in-process launcher exposes. The detached spawn has no seam for this.
  socketTest("list runs over IPC against a genuine daemon response frame", async () => {
    const seedStore = openStateStore(STATE_DB_PATH, { currentIdentity: PRIOR_OWNER_IDENTITY });
    const runId = seedStore.createRun({
      project: "p",
      specRef: "spec-ref",
      worktreePath: "/tmp/worktree",
      branch: "b",
      specPath: "/tmp/worktree/spec.md",
    });
    seedStore.close();

    const stateStore = openStateStore(STATE_DB_PATH, {
      currentIdentity: SWEEP_OWNER_IDENTITY,
      isOwnerAlive: async (identity) => identity !== PRIOR_OWNER_IDENTITY,
    });

    await startInProcessDaemon(LIST_SOCKET_PATH, stateStore);

    const client = await connectIpcClient(LIST_SOCKET_PATH);
    client.send({ kind: "request", id: "l1", method: "list" });
    const listFrame = await client.nextFrame();
    expect(listFrame.kind).toBe("response");

    const parsed = parseListRuns((listFrame as ResponseFrame).result);
    expect(parsed).toBeDefined();
    expect(parsed?.runs).toEqual([
      {
        runId,
        project: "p",
        branch: "b",
        status: "killed",
        isLive: false,
        error: { reason: "unsupported_resume_context", retryable: false, nextAction: "stop" },
      },
    ]);
    client.close();

    const shutdownClient = await connectIpcClient(LIST_SOCKET_PATH);
    shutdownClient.send({ kind: "request", id: "sd1", method: "shutdown" });
    await shutdownClient.nextFrame();
    shutdownClient.close();
  });
});
