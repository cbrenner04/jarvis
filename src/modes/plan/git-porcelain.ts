import { execFileSync } from "node:child_process";

/**
 * Snapshot `git status --porcelain` for comparing before/after an agent run.
 * Returns null when git cannot be queried (non-repo or exec failure).
 */
export function readGitPorcelainSnapshot(cwd: string): string | null {
  try {
    return execFileSync("git", ["status", "--porcelain"], {
      cwd,
      encoding: "utf8",
    });
  } catch {
    return null;
  }
}
