import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, readFileSync, rmSync, mkdirSync, writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  acquireWorktreeLock,
  releaseWorktreeLock,
  getWorktreeLockPath,
  isProcessAlive,
  type WorktreeLock,
} from "../src/worktree-lock.ts";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "jarvis-lock-test-"));
});

afterEach(() => {
  if (existsSync(tmpDir)) {
    rmSync(tmpDir, { recursive: true });
  }
});

describe("acquireWorktreeLock", () => {
  it("acquires lock when none exists", () => {
    const result = acquireWorktreeLock(tmpDir);
    expect(result.kind).toBe("acquired");

    const lockPath = getWorktreeLockPath(tmpDir);
    expect(existsSync(lockPath)).toBe(true);

    const lock: WorktreeLock = JSON.parse(readFileSync(lockPath, "utf8"));
    expect(lock.pid).toBe(process.pid);
    expect(lock.started_at).toBeTruthy();
    expect(lock.host).toBeTruthy();
  });

  it("detects live lock", () => {
    const lockPath = getWorktreeLockPath(tmpDir);
    const existingLock: WorktreeLock = {
      pid: process.pid,
      started_at: new Date().toISOString(),
      host: "localhost",
    };
    writeFileSync(lockPath, JSON.stringify(existingLock, null, 2) + "\n");

    const result = acquireWorktreeLock(tmpDir);
    expect(result.kind).toBe("busy");
    if (result.kind === "busy") {
      expect(result.existingLock.pid).toBe(process.pid);
    }
  });

  it("recovers stale lock", () => {
    const lockPath = getWorktreeLockPath(tmpDir);
    const stalePid = 1; // PID 1 is init, guaranteed to exist, but we're claiming it's stale
    const staleLock: WorktreeLock = {
      pid: 99999, // Very likely to not exist
      started_at: new Date().toISOString(),
      host: "localhost",
    };
    writeFileSync(lockPath, JSON.stringify(staleLock, null, 2) + "\n");

    const result = acquireWorktreeLock(tmpDir);
    expect(result.kind).toBe("recovered");
    if (result.kind === "recovered") {
      expect(result.stalepid).toBe(99999);
    }

    // New lock should be created
    expect(existsSync(lockPath)).toBe(true);
    const newLock: WorktreeLock = JSON.parse(readFileSync(lockPath, "utf8"));
    expect(newLock.pid).toBe(process.pid);
  });

  it("handles corrupted lock file", () => {
    const lockPath = getWorktreeLockPath(tmpDir);
    writeFileSync(lockPath, "invalid json");

    const result = acquireWorktreeLock(tmpDir);
    expect(result.kind).toBe("acquired");

    const lock: WorktreeLock = JSON.parse(readFileSync(lockPath, "utf8"));
    expect(lock.pid).toBe(process.pid);
  });
});

describe("releaseWorktreeLock", () => {
  it("removes lock file", () => {
    acquireWorktreeLock(tmpDir);
    const lockPath = getWorktreeLockPath(tmpDir);
    expect(existsSync(lockPath)).toBe(true);

    releaseWorktreeLock(tmpDir);
    expect(existsSync(lockPath)).toBe(false);
  });

  it("handles missing lock file gracefully", () => {
    // Should not throw
    expect(() => releaseWorktreeLock(tmpDir)).not.toThrow();
  });
});

describe("isProcessAlive", () => {
  it("detects running process", () => {
    expect(isProcessAlive(process.pid)).toBe(true);
  });

  it("detects dead process", () => {
    // PID 99999 is very unlikely to exist
    expect(isProcessAlive(99999)).toBe(false);
  });
});
