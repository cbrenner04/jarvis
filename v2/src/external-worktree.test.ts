import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getExternalWorktreeLockPath,
  getExternalWorktreePath,
  WorktreeBusyError,
  withExternalWorktree,
} from "./external-worktree.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0, roots.length)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function setupRepo(): { repoRoot: string; jarvisRoot: string } {
  const root = mkdtempSync(join(tmpdir(), "jarvis-v2-worktree-"));
  roots.push(root);
  const repoRoot = join(root, "repo");
  const jarvisRoot = join(root, "jarvis-home");

  execFileSync("git", ["init", repoRoot], { stdio: "pipe" });
  execFileSync("git", ["-C", repoRoot, "config", "user.email", "test@example.com"], {
    stdio: "pipe",
  });
  execFileSync("git", ["-C", repoRoot, "config", "user.name", "Test User"], {
    stdio: "pipe",
  });
  writeFileSync(join(repoRoot, "README.md"), "seed\n", "utf8");
  execFileSync("git", ["-C", repoRoot, "add", "README.md"], { stdio: "pipe" });
  execFileSync("git", ["-C", repoRoot, "commit", "-m", "seed"], {
    stdio: "pipe",
  });

  return { repoRoot, jarvisRoot };
}

function getLockRoot(jarvisRoot: string): string {
  return join(jarvisRoot, "worktree-locks", "demo", "write-run");
}

describe("external worktree helper", () => {
  test("creates a fresh external worktree and releases lock on success", async () => {
    const { repoRoot, jarvisRoot } = setupRepo();
    const result = await withExternalWorktree(
      {
        projectRoot: repoRoot,
        projectName: "demo",
        branchName: "write-run",
        baseRef: "HEAD",
        jarvisRoot,
      },
      () => "ok",
    );

    expect(result.lock.kind).toBe("acquired");
    expect(result.worktree.reused).toBe(false);
    expect(existsSync(result.worktree.path)).toBe(true);

    const lockPath = getExternalWorktreeLockPath(getLockRoot(jarvisRoot));
    expect(existsSync(lockPath)).toBe(false);

    // Locks live in the dedicated lock tree, never inside the worktree.
    expect(existsSync(join(result.worktree.path, ".jarvis.lock"))).toBe(false);
  });

  test("recovers stale lock and reports recovered status", async () => {
    const { repoRoot, jarvisRoot } = setupRepo();

    await withExternalWorktree(
      {
        projectRoot: repoRoot,
        projectName: "demo",
        branchName: "write-run",
        baseRef: "HEAD",
        jarvisRoot,
      },
      () => undefined,
    );

    const lockPath = getExternalWorktreeLockPath(getLockRoot(jarvisRoot));
    writeFileSync(
      lockPath,
      `${JSON.stringify({
        pid: 999_999_999,
        started_at: "2000-01-01T00:00:00.000Z",
        host: "stale-host",
      })}\n`,
      "utf8",
    );

    const result = await withExternalWorktree(
      {
        projectRoot: repoRoot,
        projectName: "demo",
        branchName: "write-run",
        baseRef: "HEAD",
        jarvisRoot,
      },
      () => "ok",
    );

    expect(result.worktree.reused).toBe(true);
    expect(result.lock.kind).toBe("recovered");
  });

  test("refuses to reuse a worktree from a different repository", async () => {
    const { repoRoot, jarvisRoot } = setupRepo();
    const other = setupRepo();

    await withExternalWorktree(
      {
        projectRoot: repoRoot,
        projectName: "demo",
        branchName: "write-run",
        baseRef: "HEAD",
        jarvisRoot,
      },
      () => undefined,
    );

    await expect(
      withExternalWorktree(
        {
          projectRoot: other.repoRoot,
          projectName: "demo",
          branchName: "write-run",
          baseRef: "HEAD",
          jarvisRoot,
        },
        () => "never",
      ),
    ).rejects.toThrow("belongs to a different repository");
  });

  test("refuses to reuse a worktree on a different branch", async () => {
    const { repoRoot, jarvisRoot } = setupRepo();

    const result = await withExternalWorktree(
      {
        projectRoot: repoRoot,
        projectName: "demo",
        branchName: "write-run",
        baseRef: "HEAD",
        jarvisRoot,
      },
      () => undefined,
    );
    execFileSync("git", ["checkout", "-b", "other-branch"], {
      cwd: result.worktree.path,
      stdio: "pipe",
    });

    await expect(
      withExternalWorktree(
        {
          projectRoot: repoRoot,
          projectName: "demo",
          branchName: "write-run",
          baseRef: "HEAD",
          jarvisRoot,
        },
        () => "never",
      ),
    ).rejects.toThrow("is on branch other-branch, expected write-run");
  });

  test("refuses busy lock with v1-compatible payload", async () => {
    const { repoRoot, jarvisRoot } = setupRepo();

    await withExternalWorktree(
      {
        projectRoot: repoRoot,
        projectName: "demo",
        branchName: "write-run",
        baseRef: "HEAD",
        jarvisRoot,
      },
      () => undefined,
    );

    const lockPath = getExternalWorktreeLockPath(getLockRoot(jarvisRoot));
    writeFileSync(
      lockPath,
      `${JSON.stringify({
        pid: process.pid,
        started_at: "2000-01-01T00:00:00.000Z",
        host: "alive-host",
      })}\n`,
      "utf8",
    );

    await expect(
      withExternalWorktree(
        {
          projectRoot: repoRoot,
          projectName: "demo",
          branchName: "write-run",
          baseRef: "HEAD",
          jarvisRoot,
        },
        () => "never",
      ),
    ).rejects.toBeInstanceOf(WorktreeBusyError);
  });

  test("refuses reusing a non-worktree directory", async () => {
    const { repoRoot, jarvisRoot } = setupRepo();
    const path = getExternalWorktreePath({
      projectRoot: repoRoot,
      projectName: "demo",
      branchName: "write-run",
      baseRef: "HEAD",
      jarvisRoot,
    });
    execFileSync("mkdir", ["-p", path], { stdio: "pipe" });

    await expect(
      withExternalWorktree(
        {
          projectRoot: repoRoot,
          projectName: "demo",
          branchName: "write-run",
          baseRef: "HEAD",
          jarvisRoot,
        },
        () => "never",
      ),
    ).rejects.toThrow(`existing path is not a git worktree: ${path}`);
  });

  test("releases lock when callback fails", async () => {
    const { repoRoot, jarvisRoot } = setupRepo();

    await expect(
      withExternalWorktree(
        {
          projectRoot: repoRoot,
          projectName: "demo",
          branchName: "write-run",
          baseRef: "HEAD",
          jarvisRoot,
        },
        () => {
          throw new Error("boom");
        },
      ),
    ).rejects.toThrow("boom");

    expect(existsSync(getExternalWorktreeLockPath(getLockRoot(jarvisRoot)))).toBe(false);
  });
});
