import { expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DaemonSocketBindFailureError,
  DaemonSocketInUseError,
  formatDaemonBindFailureLogLine,
  parseDaemonBindFailureLogLine,
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

test("DaemonSocketBindFailureError and bind-failure log marker round-trip", () => {
  const err = new DaemonSocketBindFailureError("/tmp/daemon-abc.sock", "EADDRINUSE");
  expect(err.socketPath).toBe("/tmp/daemon-abc.sock");
  expect(err.errno).toBe("EADDRINUSE");
  expect(err.message).toContain("/tmp/daemon-abc.sock");
  expect(err.message).toContain("EADDRINUSE");
  expect(err.message).toContain("jarvis cleanup");
  expect(parseDaemonBindFailureLogLine(formatDaemonBindFailureLogLine(err))).toEqual(err);
  expect(parseDaemonBindFailureLogLine("Fatal daemon error: listen EADDRINUSE")).toBeUndefined();
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

// An extended reprobe that is not `live` routes through `removeStaleSocketPath`, which probes once
// more before unlinking. If a daemon came up in that window the removal is refused rather than
// unlinking a socket now being served — the pre-bind path must not be skipped for a non-live verdict.
test("startIpcServer refuses when a peer appears before the stale path is removed", async () => {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-sock-reclaim-"));
  const path = join(dir, "daemon.sock");
  writeFileSync(path, "");
  try {
    await expect(
      startIpcServer(path, undefined, undefined, probingSequence(unanswered("live"), unanswered("stale"), answered())),
    ).rejects.toBeInstanceOf(DaemonSocketInUseError);
    expect(existsSync(path)).toBe(true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// A first probe that times out while the longer reprobe finds a peer that actually answers is a
// live daemon that was merely slow. It must refuse, never bind over the incumbent — this is the
// outage case the extended reprobe exists to distinguish, so `!peerConnected` must stay negated.
test("startIpcServer refuses when the extended reprobe finds an answering peer", async () => {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-sock-reclaim-"));
  const path = join(dir, "daemon.sock");
  writeFileSync(path, "");
  try {
    await expect(
      startIpcServer(path, undefined, undefined, probingSequence(unanswered("live"), answered())),
    ).rejects.toBeInstanceOf(DaemonSocketInUseError);
    expect(existsSync(path)).toBe(true);
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
    ).rejects.toBeInstanceOf(DaemonSocketBindFailureError);
    expect(existsSync(path)).toBe(true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("startIpcServer propagates first-attempt listen errors that never ran occupancy reclaim", async () => {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-sock-bind-"));
  chmodSync(dir, 0o500);
  const path = join(dir, "daemon.sock");
  try {
    await expect(startIpcServer(path)).rejects.not.toBeInstanceOf(DaemonSocketBindFailureError);
  } finally {
    chmodSync(dir, 0o700);
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

// The daemon's own full shutdown may close a server a changeover handler already closed; a second
// call must not re-invoke Node's already-stopped `server.close()` or re-run the unlink race below.
test("close is idempotent", async () => {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-sock-idempotent-"));
  const path = join(dir, "daemon.sock");
  try {
    const server = await startIpcServer(path);
    await server.close();
    expect(await Bun.file(path).exists()).toBe(false);
    await expect(server.close()).resolves.toBeUndefined();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Closing stops accepting connections well before this guard's probe runs, so a successor that has
// since rebound the path answers `live` there. Unlinking on that verdict would delete the
// successor's socket instead of this server's own; inverting the guard (`liveness === "live"`)
// would remove the path here and fail this assertion.
test("close leaves the socket path alone when a peer answers there at release time", async () => {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-sock-idempotent-"));
  const path = join(dir, "daemon.sock");
  try {
    const server = await startIpcServer(
      path,
      undefined,
      undefined,
      probingSequence(unanswered("absent"), unanswered("absent"), answered()),
    );
    await server.close();
    expect(await Bun.file(path).exists()).toBe(true);
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
