import { execFileSync } from "node:child_process";

/** True when `branchName` resolves to a local ref in `projectRoot`. */
export function branchExistsLocal(projectRoot: string, branchName: string): boolean {
  try {
    execFileSync("git", ["rev-parse", "--verify", branchName], {
      cwd: projectRoot,
      stdio: "pipe",
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * True when `origin/<branchName>` resolves in `projectRoot`. Reads the local
 * remote-tracking ref only; callers that need freshness fetch first.
 */
export function branchExistsOnOrigin(projectRoot: string, branchName: string): boolean {
  try {
    execFileSync("git", ["rev-parse", "--verify", `origin/${branchName}`], {
      cwd: projectRoot,
      stdio: "pipe",
    });
    return true;
  } catch {
    return false;
  }
}

/** The checked-out branch name (`rev-parse --abbrev-ref HEAD`) at `cwd`. */
export function getCurrentBranch(cwd: string): string {
  return execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}
