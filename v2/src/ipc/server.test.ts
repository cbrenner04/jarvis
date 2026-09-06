import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DaemonSocketInUseError,
  probeSocketLiveness,
  removeStaleSocketPath,
  type SocketLiveness,
  type SocketProbeDetail,
  startIpcServer,
} from "./server.ts";

function probing(liveness: SocketLiveness) {
  return () => Promise.resolve(liveness);
}

/** A probe verdict where a peer actually answered — a genuinely live daemon. */
function answered(): SocketProbeDetail {
  return { liveness: "live", peerConnected: true };
}

/** A probe verdict reached without any peer connecting: `live` here means the probe timed out. */
function unanswered(liveness: SocketLiveness): SocketProbeDetail {
  return { liveness, peerConnected: false };
}

/**
 * Injected probe returning each verdict in turn, clamping to the last. The seam is the same
 * `DetailedSocketProbe` production uses, so these tests traverse the production bind path rather
 * than a parallel test-only branch.
 */
function probingSequence(...details: SocketProbeDetail[]) {
  let call = 0;
  return () => Promise.resolve(details[Math.min(call++, details.length - 1)] ?? unanswered("absent"));
}

test("removeStaleSocketPath refuses to unlink a path a live daemon is serving", async () => {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-sock-guard-"));
  const path = join(dir, "daemon.sock");
  writeFileSync(path, "");
  try {
    await expect(removeStaleSocketPath(path, probing("live"))).rejects.toBeInstanceOf(DaemonSocketInUseError);
    // The entry survives: unlinking it is what strands a running daemon's clients.
    expect(Bun.file(path).size).toBe(0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("removeStaleSocketPath unlinks a stale path left by a dead daemon", async () => {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-sock-guard-"));
  const path = join(dir, "daemon.sock");
  writeFileSync(path, "");
  try {
    await removeStaleSocketPath(path, probing("stale"));
    expect(await Bun.file(path).exists()).toBe(false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// A caller that cannot resolve the path gets ENOENT for a socket a live daemon is serving, which
// classifies as `absent`. Removing on that false negative is what strands the running daemon, so
// `absent` must leave the path alone — there is by definition nothing there to remove.
test("removeStaleSocketPath leaves the path alone when the probe reports absent", async () => {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-sock-guard-"));
  const path = join(dir, "daemon.sock");
  writeFileSync(path, "");
  try {
    await removeStaleSocketPath(path, probing("absent"));
    expect(await Bun.file(path).exists()).toBe(true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("removeStaleSocketPath proceeds when nothing is at the path", async () => {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-sock-guard-"));
  const path = join(dir, "daemon.sock");
  try {
    await removeStaleSocketPath(path, probing("absent"));
    expect(await Bun.file(path).exists()).toBe(false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("DaemonSocketInUseError names the contested socket path", () => {
  const err = new DaemonSocketInUseError("/tmp/daemon-abc.sock");
  expect(err.socketPath).toBe("/tmp/daemon-abc.sock");
  expect(err.message).toContain("/tmp/daemon-abc.sock");
});

test("probeSocketLiveness reports a missing path absent without consulting the filesystem", async () => {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-sock-probe-"));
  try {
    expect(await probeSocketLiveness(join(dir, "nobody-here.sock"))).toBe("absent");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// The initial probe reports `absent` (nothing accepting), so nothing is removed before `listen`.
// `listen` then proves the path is occupied, and only the post-bind `stale` reprobe reclaims it.
test("startIpcServer reclaims a socket file with no listener bound", async () => {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-sock-reclaim-"));
  const path = join(dir, "daemon.sock");
  writeFileSync(path, "");
  try {
    const server = await startIpcServer(
      path,
      undefined,
      undefined,
      probingSequence(unanswered("absent"), unanswered("absent"), unanswered("stale")),
    );
    await server.close();
    expect(await Bun.file(path).exists()).toBe(false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Both probes time out (`live` with no peer ever connecting). The extended reprobe must decline to
// refuse and let `listen` adjudicate; deleting the extended-reprobe branch turns the first `live`
// into a `DaemonSocketInUseError` and fails this test.
test("startIpcServer proceeds to listen when both probes time out with no accepting peer", async () => {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-sock-reclaim-"));
  const path = join(dir, "daemon.sock");
  writeFileSync(path, "");
  try {
    const server = await startIpcServer(
      path,
      undefined,
      undefined,
      probingSequence(unanswered("live"), unanswered("live"), unanswered("stale")),
    );
    await server.close();
    expect(await Bun.file(path).exists()).toBe(false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// A first probe that times out but whose longer reprobe resolves `stale` is removed on the ordinary
// pre-bind path — machine load must not convert a dead socket into an unrecoverable one.
test("startIpcServer removes a stale path revealed by the extended reprobe", async () => {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-sock-reclaim-"));
  const path = join(dir, "daemon.sock");
  writeFileSync(path, "");
  try {
    const server = await startIpcServer(
      path,
      undefined,
      undefined,
      probingSequence(unanswered("live"), unanswered("stale"), unanswered("stale")),
    );
    await server.close();
    expect(await Bun.file(path).exists()).toBe(false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// The outage guard. A sandboxed caller gets ENOENT (`absent`) for a socket a live daemon is
// serving, so `absent` must never authorize an unlink even when `listen` reports EADDRINUSE.
test("startIpcServer refuses reclaim on EADDRINUSE when reprobe returns absent", async () => {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-sock-reclaim-"));
  const path = join(dir, "daemon.sock");
  writeFileSync(path, "");
  try {
    await expect(
      startIpcServer(path, undefined, undefined, probingSequence(unanswered("absent"))),
    ).rejects.toMatchObject({ code: "EADDRINUSE" });
    expect(existsSync(path)).toBe(true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// A peer that actually answered is live regardless of occupancy: no extended reprobe, no reclaim.
test("startIpcServer refuses immediately when a peer answers the probe", async () => {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-sock-reclaim-"));
  const path = join(dir, "daemon.sock");
  writeFileSync(path, "");
  try {
    await expect(startIpcServer(path, undefined, undefined, probingSequence(answered()))).rejects.toBeInstanceOf(
      DaemonSocketInUseError,
    );
    expect(existsSync(path)).toBe(true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("startIpcServer refuses to unlink a live peer socket", async () => {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-sock-reclaim-"));
  const path = join(dir, "daemon.sock");
  try {
    const incumbent = await startIpcServer(path, {
      health: () => ({ kind: "response", result: { ok: true } }),
    });
    try {
      await expect(startIpcServer(path)).rejects.toBeInstanceOf(DaemonSocketInUseError);
      expect(existsSync(path)).toBe(true);
    } finally {
      await incumbent.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
