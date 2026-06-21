import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Run tests at a base ref to validate blocker claims.
 * Resolves the base ref to a commit via merge-base, creates a temporary
 * worktree detached at that commit, runs `bun run test`, and cleans up.
 * Returns true if tests pass (exit 0), false otherwise.
 */
export async function runBaseRefTests(projectRoot: string, baseBranch: string): Promise<boolean> {
  let baseCommit: string;
  try {
    baseCommit = execFileSync("git", ["merge-base", baseBranch, "HEAD"], {
      cwd: projectRoot,
      encoding: "utf8",
      stdio: "pipe",
    }).trim();
  } catch {
    // Cannot resolve base ref: fail-safe, treat as non-green
    return false;
  }

  const worktreeDir = mkdtempSync(join(tmpdir(), "jarvis-base-ref-test-"));
  try {
    // Create a throwaway worktree detached at the base commit
    try {
      execFileSync("git", ["worktree", "add", "--detach", worktreeDir, baseCommit], {
        cwd: projectRoot,
        stdio: "pipe",
      });
    } catch {
      // Cannot create worktree: fail-safe, treat as non-green
      return false;
    }

    // Run tests in the worktree
    try {
      execFileSync("bun", ["run", "test"], {
        cwd: worktreeDir,
        env: process.env,
        stdio: "pipe",
      });
      // Exit 0: tests pass
      return true;
    } catch {
      // Non-zero exit: tests fail
      return false;
    }
  } finally {
    // Always clean up the worktree, even on error
    try {
      if (existsSync(worktreeDir)) {
        execFileSync("git", ["worktree", "remove", "--force", worktreeDir], {
          cwd: projectRoot,
          stdio: "pipe",
        });
      }
    } catch {
      // Fail silently if worktree removal fails
    }

    // Clean up the temporary directory if it still exists
    try {
      if (existsSync(worktreeDir)) {
        rmSync(worktreeDir, { recursive: true, force: true });
      }
    } catch {
      // Fail silently if directory removal fails
    }
  }
}
