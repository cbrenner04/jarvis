import { realSubprocessRunner, type SubprocessRunner } from "../../../../shared/subprocess.ts";

/**
 * Snapshot `git status --porcelain` for comparing before/after an agent run.
 * Returns null when git cannot be queried (non-repo or exec failure).
 */
export function readGitPorcelainSnapshot(cwd: string, runner: SubprocessRunner = realSubprocessRunner): string | null {
  try {
    return runner.run("git", ["status", "--porcelain"], cwd);
  } catch {
    return null;
  }
}
