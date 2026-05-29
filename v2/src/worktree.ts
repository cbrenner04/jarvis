import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { acquireWorktreeLock, releaseWorktreeLock } from "./worktree-lock.ts";

export type AcquiredWorktree = {
  path: string;
  release: () => void;
};

export function getExternalWorktreePath(args: {
  projectRoot: string;
  branch: string;
  worktreeHome?: string;
}): string {
  const worktreeHome = args.worktreeHome ?? join(homedir(), ".jarvis", "worktrees");
  const project = basename(args.projectRoot);
  return join(worktreeHome, project, args.branch);
}

export function currentBranch(projectRoot: string): string {
  return execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: "pipe",
  }).trim();
}

function branchExists(projectRoot: string, branch: string): boolean {
  try {
    execFileSync("git", ["rev-parse", "--verify", branch], {
      cwd: projectRoot,
      stdio: "pipe",
    });
    return true;
  } catch {
    return false;
  }
}

function materializeWorktree(args: {
  projectRoot: string;
  branch: string;
  path: string;
}): void {
  if (existsSync(args.path)) return;
  mkdirSync(dirname(args.path), { recursive: true });
  if (branchExists(args.projectRoot, args.branch)) {
    execFileSync("git", ["worktree", "add", "--checkout", args.path, args.branch], {
      cwd: args.projectRoot,
      stdio: "pipe",
    });
    return;
  }
  execFileSync("git", ["worktree", "add", "-b", args.branch, args.path], {
    cwd: args.projectRoot,
    stdio: "pipe",
  });
}

export async function acquireExternalWorktree(args: {
  projectRoot: string;
  branch: string;
  worktreeHome?: string;
  signal?: AbortSignal;
}): Promise<AcquiredWorktree> {
  args.signal?.throwIfAborted();
  const path = getExternalWorktreePath(args);
  materializeWorktree({ projectRoot: args.projectRoot, branch: args.branch, path });
  const lock = acquireWorktreeLock(path);
  if (lock.kind === "busy") {
    throw new Error(
      `worktree is in use by process ${lock.existingLock.pid} (started at ${lock.existingLock.started_at})`,
    );
  }
  return { path, release: () => releaseWorktreeLock(path) };
}
