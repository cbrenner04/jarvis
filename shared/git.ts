import { execFileSync } from "node:child_process";
import {
  type AsyncSubprocessRunner,
  realAsyncSubprocessRunner,
  realSubprocessRunner,
  type SubprocessRunner,
} from "./subprocess.ts";

/** Resolve GitHub's default branch, falling back to `main` when unavailable. */
export function getBaseBranch(cwd?: string): string {
  try {
    const branch = execFileSync("gh", ["repo", "view", "--json", "defaultBranchRef", "-q", ".defaultBranchRef.name"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return branch.length > 0 ? branch : "main";
  } catch {
    return "main";
  }
}

/** True when `branchName` resolves to a local ref in `projectRoot`. */
export function branchExistsLocal(
  projectRoot: string,
  branchName: string,
  runner: SubprocessRunner = realSubprocessRunner,
): boolean {
  try {
    runner.run("git", ["rev-parse", "--verify", branchName], projectRoot);
    return true;
  } catch {
    return false;
  }
}

/**
 * True when `origin/<branchName>` resolves in `projectRoot`. Reads the local
 * remote-tracking ref only; callers that need freshness fetch first.
 */
export function branchExistsOnOrigin(
  projectRoot: string,
  branchName: string,
  runner: SubprocessRunner = realSubprocessRunner,
): boolean {
  try {
    runner.run("git", ["rev-parse", "--verify", `origin/${branchName}`], projectRoot);
    return true;
  } catch {
    return false;
  }
}

/** The checked-out branch name (`rev-parse --abbrev-ref HEAD`) at `cwd`. */
export function getCurrentBranch(cwd: string, runner: SubprocessRunner = realSubprocessRunner): string {
  return runner.run("git", ["rev-parse", "--abbrev-ref", "HEAD"], cwd).trim();
}

/** True when `git status --porcelain` at `cwd` reports any uncommitted changes. */
export function isWorktreeDirty(cwd: string, runner: SubprocessRunner = realSubprocessRunner): boolean {
  return runner.run("git", ["status", "--porcelain"], cwd).trim().length > 0;
}

/** True when `cwd` is inside a git working tree; false for plain (git-disabled) directories. */
export function isGitRepo(cwd: string): boolean {
  try {
    execFileSync("git", ["rev-parse", "--is-inside-work-tree"], { cwd, stdio: ["ignore", "pipe", "ignore"] });
    return true;
  } catch {
    return false;
  }
}

/** Async version: True when `branchName` resolves to a local ref in `projectRoot`. */
export async function branchExistsLocalAsync(
  projectRoot: string,
  branchName: string,
  runner: AsyncSubprocessRunner = realAsyncSubprocessRunner,
): Promise<boolean> {
  try {
    await runner.runAsync("git", ["rev-parse", "--verify", branchName], projectRoot);
    return true;
  } catch {
    return false;
  }
}

/** Async version: True when `origin/<branchName>` resolves in `projectRoot`. */
export async function branchExistsOnOriginAsync(
  projectRoot: string,
  branchName: string,
  runner: AsyncSubprocessRunner = realAsyncSubprocessRunner,
): Promise<boolean> {
  try {
    await runner.runAsync("git", ["rev-parse", "--verify", `origin/${branchName}`], projectRoot);
    return true;
  } catch {
    return false;
  }
}

/** Async version: The checked-out branch name at `cwd`. */
export async function getCurrentBranchAsync(
  cwd: string,
  runner: AsyncSubprocessRunner = realAsyncSubprocessRunner,
): Promise<string> {
  return (await runner.runAsync("git", ["rev-parse", "--abbrev-ref", "HEAD"], cwd)).trim();
}

/** Async version: True when `git status --porcelain` at `cwd` reports any uncommitted changes. */
export async function isWorktreeDirtyAsync(
  cwd: string,
  runner: AsyncSubprocessRunner = realAsyncSubprocessRunner,
): Promise<boolean> {
  return (await runner.runAsync("git", ["status", "--porcelain"], cwd)).trim().length > 0;
}
