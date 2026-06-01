import { afterEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  acquireLock,
  isProcessAlive,
  releaseLock,
  type WorktreeLock,
} from "./worktree-lock.ts";

const dirs: string[] = [];
function tmp(): string {
  const dir = mkdtempSync(join(tmpdir(), "lock-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

describe("acquireLock", () => {
  test("fresh path: acquires and writes this process's lock", () => {
    const lockPath = join(tmp(), ".jarvis.lock");
    expect(acquireLock(lockPath).kind).toBe("acquired");
    const lock: WorktreeLock = JSON.parse(readFileSync(lockPath, "utf8"));
    expect(lock.pid).toBe(process.pid);
  });

  test("live holder: busy with the existing payload", () => {
    const lockPath = join(tmp(), ".jarvis.lock");
    const existing: WorktreeLock = {
      pid: process.pid,
      started_at: new Date().toISOString(),
      host: "h",
    };
    writeFileSync(lockPath, JSON.stringify(existing));
    const result = acquireLock(lockPath);
    expect(result.kind).toBe("busy");
    if (result.kind === "busy")
      expect(result.existingLock.pid).toBe(process.pid);
  });

  test("dead holder: recovers and rewrites the lock", () => {
    const lockPath = join(tmp(), ".jarvis.lock");
    writeFileSync(
      lockPath,
      JSON.stringify({ pid: 999999, started_at: "x", host: "h" }),
    );
    const result = acquireLock(lockPath);
    expect(result.kind).toBe("recovered");
    if (result.kind === "recovered") expect(result.stalepid).toBe(999999);
    const lock: WorktreeLock = JSON.parse(readFileSync(lockPath, "utf8"));
    expect(lock.pid).toBe(process.pid);
  });

  test("unreadable lock: reclaimed as acquired", () => {
    const lockPath = join(tmp(), ".jarvis.lock");
    writeFileSync(lockPath, "not json");
    expect(acquireLock(lockPath).kind).toBe("acquired");
  });
});

describe("releaseLock", () => {
  test("removes the lock and tolerates a missing one", () => {
    const lockPath = join(tmp(), ".jarvis.lock");
    acquireLock(lockPath);
    releaseLock(lockPath);
    expect(existsSync(lockPath)).toBe(false);
    expect(() => releaseLock(lockPath)).not.toThrow();
  });
});

describe("isProcessAlive", () => {
  test("true for self, false for an unused pid", () => {
    expect(isProcessAlive(process.pid)).toBe(true);
    expect(isProcessAlive(999999)).toBe(false);
  });
});
