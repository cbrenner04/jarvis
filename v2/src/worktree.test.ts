import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  acquireExternalWorktree,
  getExternalWorktreePath,
} from "./worktree.ts";
import { getWorktreeLockPath } from "./worktree-lock.ts";

function initRepo(root: string): void {
  execFileSync("git", ["init", "-b", "main"], { cwd: root, stdio: "pipe" });
  execFileSync("git", ["config", "user.name", "Jarvis"], {
    cwd: root,
    stdio: "pipe",
  });
  execFileSync("git", ["config", "user.email", "jarvis@example.com"], {
    cwd: root,
    stdio: "pipe",
  });
  writeFileSync(join(root, "README.md"), "init\n", "utf8");
  execFileSync("git", ["add", "README.md"], { cwd: root, stdio: "pipe" });
  execFileSync("git", ["commit", "-m", "init"], { cwd: root, stdio: "pipe" });
}

describe("external worktree", () => {
  test("selects ~/.jarvis/worktrees/<project>/<branch> shape", () => {
    const path = getExternalWorktreePath({
      projectRoot: "/tmp/example-project",
      branch: "feature-x",
      worktreeHome: "/tmp/home/.jarvis/worktrees",
    });
    expect(path).toBe("/tmp/home/.jarvis/worktrees/example-project/feature-x");
  });

  test("creates then reuses an external worktree", async () => {
    const root = mkdtempSync(join(tmpdir(), "jarvis-v2-worktree-root-"));
    const worktreeHome = mkdtempSync(
      join(tmpdir(), "jarvis-v2-worktree-home-"),
    );
    try {
      initRepo(root);
      const first = await acquireExternalWorktree({
        projectRoot: root,
        branch: "spec-branch",
        worktreeHome,
      });
      await first.release();

      const second = await acquireExternalWorktree({
        projectRoot: root,
        branch: "spec-branch",
        worktreeHome,
      });
      await second.release();

      expect(first.path).toBe(second.path);
      const list = execFileSync("git", ["worktree", "list", "--porcelain"], {
        cwd: root,
        encoding: "utf8",
        stdio: "pipe",
      });
      const expectedPath = realpathSync(first.path);
      const worktreeLines = list
        .split("\n")
        .filter((line) => line.startsWith("worktree "))
        .map((line) => realpathSync(line.slice("worktree ".length)));
      const occurrences = worktreeLines.filter(
        (path) => path === expectedPath,
      ).length;
      expect(occurrences).toBe(1);
    } finally {
      rmSync(root, { force: true, recursive: true });
      rmSync(worktreeHome, { force: true, recursive: true });
    }
  });

  test("busy lock blocks second acquisition and lock is excluded from staging", async () => {
    const root = mkdtempSync(join(tmpdir(), "jarvis-v2-worktree-lock-root-"));
    const worktreeHome = mkdtempSync(
      join(tmpdir(), "jarvis-v2-worktree-lock-home-"),
    );
    try {
      initRepo(root);
      const acquired = await acquireExternalWorktree({
        projectRoot: root,
        branch: "spec-branch",
        worktreeHome,
      });

      const lockPath = getWorktreeLockPath(acquired.path);
      expect(Bun.file(lockPath).size).toBeGreaterThan(0);
      const excludePath = execFileSync(
        "git",
        ["rev-parse", "--git-path", "info/exclude"],
        {
          cwd: acquired.path,
          encoding: "utf8",
          stdio: "pipe",
        },
      ).trim();
      const resolvedExclude = excludePath.startsWith("/")
        ? excludePath
        : join(acquired.path, excludePath);
      const excludeContents = Bun.file(resolvedExclude).text();
      expect(await excludeContents).toContain(".jarvis.lock");

      await expect(
        acquireExternalWorktree({
          projectRoot: root,
          branch: "spec-branch",
          worktreeHome,
        }),
      ).rejects.toThrow(/worktree is in use by process/u);
      await acquired.release();
    } finally {
      rmSync(root, { force: true, recursive: true });
      rmSync(worktreeHome, { force: true, recursive: true });
    }
  });
});
