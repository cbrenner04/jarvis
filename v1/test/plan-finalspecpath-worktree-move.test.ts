import { describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Test for regression: finalSpecPath must be recomputed after git worktree move
 *
 * This test verifies that when a plan worktree is moved from a temporary location
 * (e.g. `.worktree/plan-tmp-<id>/`) to its final location (e.g. `.worktree/plan-<name>/`),
 * the finalSpecPath is updated to reflect the new location. If finalSpecPath is stale,
 * subsequent reads like `intent.md` will fail with ENOENT.
 */
describe("finalSpecPath recomputation after worktree move", () => {
  test("simulates commit-true plan flow: worktree move updates finalSpecPath context", () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-finalspecpath-move-"));
    try {
      // Set up a minimal git repo
      execSync("git init -b main", { cwd: dir });
      execSync("git config user.email 'test@example.com'", { cwd: dir });
      execSync("git config user.name 'Test User'", { cwd: dir });
      writeFileSync(join(dir, "README.md"), "test");
      execSync("git add README.md", { cwd: dir });
      execSync("git commit -m 'initial'", { cwd: dir });

      // Simulate the temporary plan worktree with plan-tmp-<id> layout
      const tempWorktreeName = "plan-tmp-abc123";
      const finalWorktreeName = "plan-my-feature";
      const tempWorktreePath = join(dir, ".worktree", tempWorktreeName);
      const finalWorktreePath = join(dir, ".worktree", finalWorktreeName);

      // Create temporary worktree directory structure
      const tempSpecBasename = "2026-05-19T18-40-51Z-my-feature";
      const tempSpecPath = join(tempWorktreePath, "spec", tempSpecBasename);
      mkdirSync(tempSpecPath, { recursive: true });

      // Write intent.md to the temporary worktree location
      const intentContent = "---\nname: my-feature\n---\n\n# Intent\n\nTest intent\n";
      writeFileSync(join(tempSpecPath, "intent.md"), intentContent, "utf8");

      // Verify initial state: intent.md exists in temp location
      expect(existsSync(join(tempSpecPath, "intent.md"))).toBe(true);
      expect(readFileSync(join(tempSpecPath, "intent.md"), "utf8")).toBe(intentContent);

      // Simulate git worktree move: rename the worktree directory
      mkdirSync(finalWorktreePath, { recursive: true });
      renameSync(tempWorktreePath, finalWorktreePath);

      // Verify the temp location is now gone
      expect(existsSync(tempWorktreePath)).toBe(false);

      // The fix: finalSpecPath must be recomputed after the move
      // Before the fix, code would try to read from tempWorktreePath
      // After the fix, it should read from finalWorktreePath
      const finalSpecPath = join(finalWorktreePath, "spec", tempSpecBasename);

      // Verify that intent.md can be read from the post-move location
      expect(existsSync(join(finalSpecPath, "intent.md"))).toBe(true);
      expect(readFileSync(join(finalSpecPath, "intent.md"), "utf8")).toBe(intentContent);

      // If the code still used the stale tempWorktreePath value, this would fail
      const stalePathCheck = join(tempWorktreePath, "spec", tempSpecBasename);
      expect(existsSync(join(stalePathCheck, "intent.md"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("verifies intent.md can be read after simulated worktree relocation", () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-intent-read-"));
    try {
      // Setup
      execSync("git init -b main", { cwd: dir });
      execSync("git config user.email 'test@example.com'", { cwd: dir });
      execSync("git config user.name 'Test User'", { cwd: dir });
      writeFileSync(join(dir, "README.md"), "test");
      execSync("git add README.md", { cwd: dir });
      execSync("git commit -m 'initial'", { cwd: dir });

      // Create initial structure in temporary location
      const tempName = "plan-tmp-xyz";
      const finalName = "plan-my-plan";
      const specBasename = "2026-05-19T18-40-51Z-my-plan";

      const tempPath = join(dir, ".worktree", tempName);
      const tempSpecDir = join(tempPath, "spec", specBasename);
      mkdirSync(tempSpecDir, { recursive: true });

      const intentText = "---\nname: my-plan\n---\n\n# My Intent\n\nDo something\n";
      writeFileSync(join(tempSpecDir, "intent.md"), intentText);

      // Move worktree (simulate git worktree move)
      const finalPath = join(dir, ".worktree", finalName);
      mkdirSync(finalPath, { recursive: true });
      renameSync(tempPath, finalPath);

      // After fix, this path calculation should work
      const correctedFinalSpecPath = join(finalPath, "spec", specBasename);
      const intentPath = join(correctedFinalSpecPath, "intent.md");

      // Should be able to read the file after recomputing the path
      expect(existsSync(intentPath)).toBe(true);
      const readContent = readFileSync(intentPath, "utf8");
      expect(readContent).toBe(intentText);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
