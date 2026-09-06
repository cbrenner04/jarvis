import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DaemonSocketInUseError,
  probeSocketLiveness,
  removeStaleSocketPath,
  startIpcServer,
  type SocketLiveness,
} from "./server.ts";

function probing(liveness: SocketLiveness) {
  return () => Promise.resolve(liveness);
}

function probingSequence(...livenesses: SocketLiveness[]) {
  let call = 0;
  return () => Promise.resolve(livenesses[Math.min(call++, livenesses.length - 1)] ?? "absent");
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

test("startIpcServer reclaims a socket file with no listener bound", async () => {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-sock-reclaim-"));
  const path = join(dir, "daemon.sock");
  writeFileSync(path, "");
  try {
    const server = await startIpcServer(path, undefined, undefined, probingSequence("absent", "stale"));
    await server.close();
    expect(await Bun.file(path).exists()).toBe(false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("startIpcServer reclaims on EADDRINUSE when post-bind reprobe returns stale", async () => {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-sock-reclaim-"));
  const path = join(dir, "daemon.sock");
  writeFileSync(path, "");
  try {
    const server = await startIpcServer(path, undefined, undefined, probingSequence("absent", "stale"));
    await server.close();
    expect(await Bun.file(path).exists()).toBe(false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("startIpcServer reclaims when probe times out with no accepting peer", async () => {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-sock-reclaim-"));
  const path = join(dir, "daemon.sock");
  writeFileSync(path, "");
  try {
    const server = await startIpcServer(path, undefined, undefined, probingSequence("live", "live", "stale"));
    await server.close();
    expect(await Bun.file(path).exists()).toBe(false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("startIpcServer refuses reclaim on EADDRINUSE when reprobe returns absent", async () => {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-sock-reclaim-"));
  const path = join(dir, "daemon.sock");
  writeFileSync(path, "");
  try {
    await expect(startIpcServer(path, undefined, undefined, probingSequence("absent", "absent"))).rejects.toMatchObject(
      { code: "EADDRINUSE" },
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
