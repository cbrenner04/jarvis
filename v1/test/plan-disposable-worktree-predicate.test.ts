import { describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isDisposablePlanWorktree } from "../src/modes/plan/run.ts";

describe("isDisposablePlanWorktree predicate", () => {
  function setupGitRepo(opts?: { commitInitial?: boolean }) {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-disposable-pred-"));
    const originPath = join(dir, "origin");
    mkdirSync(originPath);
    execSync("git init --bare", { cwd: originPath });

    execSync("git init -b main", { cwd: dir });
    execSync("git config user.email 'test@example.com'", { cwd: dir });
    execSync("git config user.name 'Test User'", { cwd: dir });
    execSync(`git remote add origin ${originPath}`, { cwd: dir });

    if (opts?.commitInitial !== false) {
      writeFileSync(join(dir, "README.md"), "seed\n");
      execSync("git add README.md", { cwd: dir });
      execSync("git commit -m 'seed'", { cwd: dir });
      execSync("git push -u origin main", { cwd: dir });
    }

    return dir;
  }

  test("clean run with no surviving state is non-disposable", () => {
    const dir = setupGitRepo();
    try {
      // Fresh repo, no plan branch/worktree
      const result = isDisposablePlanWorktree({
        projectRoot: dir,
        planName: "test-name",
        targetDir: "spec",
        specTimestamp: false,
      });
      expect(result).toBe(false); // No surviving state → non-disposable
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("local-only branch with no commits beyond merge-base is disposable", () => {
    const dir = setupGitRepo();
    try {
      // Create a plan branch pointing to HEAD (no new commits)
      execSync("git branch plan/test-name", { cwd: dir });

      const result = isDisposablePlanWorktree({
        projectRoot: dir,
        planName: "test-name",
        targetDir: "spec",
        specTimestamp: false,
      });
      expect(result).toBe(true); // Branch exists, no commits beyond base → disposable
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("local worktree with no commits beyond merge-base is disposable", () => {
    const dir = setupGitRepo();
    try {
      // Create a worktree directory
      const worktreePath = join(dir, ".worktree", "plan-test-name");
      mkdirSync(worktreePath, { recursive: true });

      // Create a matching branch with no commits beyond base
      execSync("git branch plan/test-name", { cwd: dir });

      const result = isDisposablePlanWorktree({
        projectRoot: dir,
        planName: "test-name",
        targetDir: "spec",
        specTimestamp: false,
      });
      expect(result).toBe(true); // Worktree/branch exist, no commits → disposable
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("dirty/uncommitted worktree is disposable", () => {
    const dir = setupGitRepo();
    try {
      // Create worktree and branch
      const worktreePath = join(dir, ".worktree", "plan-test-name");
      mkdirSync(worktreePath, { recursive: true });
      execSync("git branch plan/test-name", { cwd: dir });

      // Add untracked/uncommitted files (dirty working tree)
      writeFileSync(join(worktreePath, "dirty.txt"), "unsaved work");

      const result = isDisposablePlanWorktree({
        projectRoot: dir,
        planName: "test-name",
        targetDir: "spec",
        specTimestamp: false,
      });
      expect(result).toBe(true); // Dirty state but no commits beyond base → disposable
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("branch with commits beyond merge-base is not disposable", () => {
    const dir = setupGitRepo();
    try {
      // Create a plan branch and add a commit
      execSync("git checkout -b plan/test-with-commits", { cwd: dir });
      writeFileSync(join(dir, "file.txt"), "content");
      execSync("git add file.txt", { cwd: dir });
      execSync("git commit -m 'plan commit'", { cwd: dir });
      execSync("git checkout main", { cwd: dir });

      const result = isDisposablePlanWorktree({
        projectRoot: dir,
        planName: "test-with-commits",
        targetDir: "spec",
        specTimestamp: false,
      });
      expect(result).toBe(false); // Has commits beyond base → not disposable
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("remote branch existence blocks disposability", () => {
    const dir = setupGitRepo();
    try {
      // Create a local branch and push to origin
      execSync("git checkout -b plan/test-remote", { cwd: dir });
      execSync("git push -u origin plan/test-remote", { cwd: dir });
      execSync("git checkout main", { cwd: dir });

      const result = isDisposablePlanWorktree({
        projectRoot: dir,
        planName: "test-remote",
        targetDir: "spec",
        specTimestamp: false,
      });
      expect(result).toBe(false); // Remote branch exists → not disposable
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("committed unprefixed spec dir blocks disposability", () => {
    const dir = setupGitRepo();
    try {
      // Create and commit a spec dir
      const specDir = join(dir, "spec", "test-name");
      mkdirSync(specDir, { recursive: true });
      writeFileSync(join(specDir, "index.md"), "# Spec");
      execSync("git add -A", { cwd: dir });
      execSync("git commit -m 'add spec'", { cwd: dir });

      // Also create a plan branch for it (without commits)
      execSync("git branch plan/test-name", { cwd: dir });

      const result = isDisposablePlanWorktree({
        projectRoot: dir,
        planName: "test-name",
        targetDir: "spec",
        specTimestamp: false,
      });
      expect(result).toBe(false); // Committed spec dir → not disposable
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("committed timestamped spec dir blocks disposability", () => {
    const dir = setupGitRepo();
    try {
      // Create and commit a timestamped spec dir
      const specDir = join(dir, "spec", "2026-01-01T00-00-00Z-test-name");
      mkdirSync(specDir, { recursive: true });
      writeFileSync(join(specDir, "index.md"), "# Spec");
      execSync("git add -A", { cwd: dir });
      execSync("git commit -m 'add spec'", { cwd: dir });

      // Create a plan branch
      execSync("git branch plan/test-name", { cwd: dir });

      const result = isDisposablePlanWorktree({
        projectRoot: dir,
        planName: "test-name",
        targetDir: "spec",
        specTimestamp: true,
      });
      expect(result).toBe(false); // Committed timestamped spec dir → not disposable
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("unreachable remote is treated as non-disposable", () => {
    const dir = setupGitRepo();
    try {
      // Set a remote that doesn't exist (simulates unreachable)
      execSync("git remote set-url origin https://github.com/nonexistent/repo.git", { cwd: dir });

      // Create a plan branch locally
      execSync("git branch plan/test-name", { cwd: dir });

      const result = isDisposablePlanWorktree({
        projectRoot: dir,
        planName: "test-name",
        targetDir: "spec",
        specTimestamp: false,
      });
      expect(result).toBe(false); // Unreachable remote → fail-closed, non-disposable
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("branch without commits but with different merge-base is disposable", () => {
    const dir = setupGitRepo();
    try {
      // Create a side branch (not main) and then create plan branch from it
      execSync("git checkout -b side", { cwd: dir });
      writeFileSync(join(dir, "side.txt"), "content");
      execSync("git add side.txt", { cwd: dir });
      execSync("git commit -m 'side commit'", { cwd: dir });

      // Create plan branch from current HEAD (side branch's tip)
      execSync("git branch plan/test-name", { cwd: dir });

      // Switch back to main
      execSync("git checkout main", { cwd: dir });

      const result = isDisposablePlanWorktree({
        projectRoot: dir,
        planName: "test-name",
        targetDir: "spec",
        specTimestamp: false,
      });
      // plan/test-name is at the same commit as the tip of side
      // merge-base(plan/test-name, main) = main's base, but plan/test-name tip ≠ merge-base
      // so it has commits beyond the merge-base → not disposable
      expect(result).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
