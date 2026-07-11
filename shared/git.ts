import { execFileSync } from "node:child_process";
import { realSubprocessRunner, type SubprocessRunner } from "./subprocess.ts";

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
