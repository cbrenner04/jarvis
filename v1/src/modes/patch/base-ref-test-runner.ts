import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultRunCommand, type RunCommandFn } from "./run-command.ts";

/**
 * Run tests at a base ref to validate blocker claims.
 * Resolves the base ref to a commit via merge-base, creates a temporary
 * worktree detached at that commit, runs `bun run test`, and cleans up.
 * On test failure, retries serially once before returning non-green.
 * Returns true if tests pass (exit 0), false otherwise.
 */
export async function runBaseRefTests(
  projectRoot: string,
  baseBranch: string,
  runCommandFn?: RunCommandFn,
): Promise<boolean> {
  const runCommand = runCommandFn ?? defaultRunCommand;

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

    // Helper to check if test files exist in the worktree
    const hasTestFiles = (): boolean => {
      try {
        const entries = readdirSync(worktreeDir, { recursive: true });
        for (const entry of entries) {
          if (typeof entry === "string" && entry.endsWith(".test.ts")) {
            return true;
          }
        }
      } catch {
        // If we can't read the directory, assume tests exist (fail-safe)
        return true;
      }
      return false;
    };

    // Run tests in the worktree
    let testPassed = false;
    try {
      runCommand("bun", ["run", "test"], worktreeDir);
      testPassed = true;
    } catch {
      // Parallel test failed; retry serially
      process.stderr.write(`base-ref-test: parallel test failed; retrying serially\n`);
      try {
        runCommand("bun", ["test"], worktreeDir);
        process.stderr.write(`base-ref-test: parallel-load flake recovered (serial test passed)\n`);
        testPassed = true;
      } catch {
        process.stderr.write(`base-ref-test: serial test failed\n`);
        testPassed = false;
      }
      // Guard: if serial run passed but no test files were discovered,
      // treat as non-green to avoid flipping a genuinely red base to green
      if (testPassed && !hasTestFiles()) {
        testPassed = false;
      }
    }

    return testPassed;
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
