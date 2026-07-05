import { realSubprocessRunner, type SubprocessRunner } from "./subprocess.ts";

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
