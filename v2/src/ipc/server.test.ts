import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DaemonSocketInUseError, removeStaleSocketPath, type SocketLiveness } from "./server.ts";

function probing(liveness: SocketLiveness) {
  return () => Promise.resolve(liveness);
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
