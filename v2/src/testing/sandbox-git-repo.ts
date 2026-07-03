// This fixture must only be imported from .sandbox-unrunnable.test.ts files.
// It spawns real `git` commands and is not safe for agent-runnable tests.

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Set up a real git repository for sandbox-only tests.
 * Pushes the allocated temp root to the `roots` array for cleanup in afterEach.
 * Returns { repoRoot, jarvisRoot } for the test to use.
 */
export function setupSandboxGitRepo(roots: string[]): { repoRoot: string; jarvisRoot: string } {
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
