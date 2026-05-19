import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { reviewCommand, type ReviewIo } from "../src/commands/review.ts";
import { getWorktreeLockPath } from "../src/worktree-lock.ts";

function captureIo(): { io: ReviewIo; out: () => string; err: () => string } {
  let out = "";
  let err = "";
  return {
    io: {
      stdout: (s) => {
        out += s;
      },
      stderr: (s) => {
        err += s;
      },
    },
    out: () => out,
    err: () => err,
  };
}

let root: string;
let projectRoot: string;
let worktreeRoot: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "jarvis-review-"));
  projectRoot = join(root, "project");
  worktreeRoot = join(projectRoot, ".worktree");
  mkdirSync(worktreeRoot, { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function createGitWorktree(name: string): string {
  const worktreePath = join(worktreeRoot, name);
  mkdirSync(worktreePath, { recursive: true });
  execSync("git init", { cwd: worktreePath, stdio: "pipe" });
  execSync("git config user.email test@example.com", {
    cwd: worktreePath,
    stdio: "pipe",
  });
  execSync("git config user.name Test", { cwd: worktreePath, stdio: "pipe" });
  writeFileSync(join(worktreePath, "README.md"), "seed\n");
  execSync("git add README.md", { cwd: worktreePath, stdio: "pipe" });
  execSync("git commit -m seed", { cwd: worktreePath, stdio: "pipe" });
  return worktreePath;
}

describe("reviewCommand", () => {
  test("missing worktree exits non-zero with clear name", async () => {
    const cap = captureIo();
    const code = await reviewCommand({
      projectRoot,
      worktreeName: "missing-one",
      io: cap.io,
    });
    expect(code).toBe(1);
    expect(cap.err()).toContain("unknown worktree");
    expect(cap.err()).toContain("missing-one");
  });

  test("plan-* worktree is rejected in v1", async () => {
    createGitWorktree("plan-my-worktree");
    const cap = captureIo();
    const code = await reviewCommand({
      projectRoot,
      worktreeName: "plan-my-worktree",
      io: cap.io,
    });
    expect(code).toBe(1);
    expect(cap.err()).toContain("only supports patch worktrees");
  });

  test("detached HEAD is rejected before gh lookup", async () => {
    const worktreePath = createGitWorktree("detached");
    execSync("git checkout --detach", { cwd: worktreePath, stdio: "pipe" });

    let ghCalled = false;
    const cap = captureIo();
    const code = await reviewCommand({
      projectRoot,
      worktreeName: "detached",
      io: cap.io,
      assertGhReadyFn: async () => {
        ghCalled = true;
      },
    });
    expect(code).toBe(1);
    expect(ghCalled).toBe(false);
    expect(cap.err()).toContain("detached HEAD");
  });

  test("lock contention exits through normal lock failure path", async () => {
    const worktreePath = createGitWorktree("locked");
    const lockPath = getWorktreeLockPath(worktreePath);
    writeFileSync(
      lockPath,
      JSON.stringify({
        pid: process.pid,
        started_at: new Date().toISOString(),
        host: "test",
      }),
    );

    const cap = captureIo();
    const code = await reviewCommand({
      projectRoot,
      worktreeName: "locked",
      io: cap.io,
    });
    expect(code).toBe(9);
    expect(cap.err()).toContain("worktree is in use by process");
  });

  test("dirty-start refusal happens before gh readiness", async () => {
    const worktreePath = createGitWorktree("dirty");
    writeFileSync(join(worktreePath, "dirty.txt"), "dirty\n");

    let ghCalled = false;
    const cap = captureIo();
    const code = await reviewCommand({
      projectRoot,
      worktreeName: "dirty",
      io: cap.io,
      assertGhReadyFn: async () => {
        ghCalled = true;
      },
    });
    expect(code).toBe(1);
    expect(ghCalled).toBe(false);
    expect(cap.err()).toContain("is not clean");
  });

  test("gh readiness failures are surfaced unchanged", async () => {
    const worktreePath = createGitWorktree("gh-failure");
    const cap = captureIo();
    const code = await reviewCommand({
      projectRoot,
      worktreeName: "gh-failure",
      io: cap.io,
      assertGhReadyFn: async () => {
        throw new Error("gh auth failure text");
      },
    });
    expect(code).toBe(1);
    expect(cap.err()).toContain("gh auth failure text");
    expect(existsSync(getWorktreeLockPath(worktreePath))).toBe(false);
  });

  test("lock is released on detached-head early error path", async () => {
    const worktreePath = createGitWorktree("detached-release");
    execSync("git checkout --detach", { cwd: worktreePath, stdio: "pipe" });
    const cap = captureIo();
    await reviewCommand({
      projectRoot,
      worktreeName: "detached-release",
      io: cap.io,
    });
    expect(existsSync(getWorktreeLockPath(worktreePath))).toBe(false);
  });
});
