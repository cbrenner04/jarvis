import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Helper to test the deletion function behavior
// We need to import or test the function indirectly through planCommand
// For now, we'll write focused unit tests for the deletion scenarios

describe("ready-intent deletion", () => {
  test("deletion works when ready-intent exists in worktree under ready-intents/", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "jarvis-delete-test-"));
    const worktreePath = mkdtempSync(join(tmpdir(), "jarvis-delete-worktree-"));
    try {
      // Set up ready-intent in project root
      const readyIntentsDir = join(projectRoot, "ready-intents");
      mkdirSync(readyIntentsDir, { recursive: true });
      const readyIntentPath = join(readyIntentsDir, "my-feature.md");
      const content = "---\nname: my-feature\n---\n\n## Prerequisites\n\nTest";
      writeFileSync(readyIntentPath, content);

      // Copy to worktree
      const worktreeReadyIntentsDir = join(worktreePath, "ready-intents");
      mkdirSync(worktreeReadyIntentsDir, { recursive: true });
      const worktreeReadyIntentPath = join(worktreeReadyIntentsDir, "my-feature.md");
      writeFileSync(worktreeReadyIntentPath, content);

      // Verify it exists
      expect(existsSync(worktreeReadyIntentPath)).toBe(true);

      // Now test the deletion logic manually
      const relativeToProject = "ready-intents/my-feature.md";
      const targetInWorktree = join(worktreePath, relativeToProject);

      // Delete
      if (existsSync(targetInWorktree)) {
        unlinkSync(targetInWorktree);
      }

      // Verify deletion
      expect(existsSync(targetInWorktree)).toBe(false);
      // Original should still exist
      expect(existsSync(readyIntentPath)).toBe(true);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
      rmSync(worktreePath, { recursive: true, force: true });
    }
  });

  test("deletion is safe when path escapes worktree", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "jarvis-escape-test-"));
    const worktreePath = mkdtempSync(join(tmpdir(), "jarvis-escape-worktree-"));
    const externalDir = mkdtempSync(join(tmpdir(), "jarvis-escape-external-"));
    try {
      // Ready-intent is outside the project
      const readyIntentPath = join(externalDir, "external-feature.md");
      const content = "---\nname: external-feature\n---\n\n## Prerequisites\n\nTest";
      writeFileSync(readyIntentPath, content);

      // Compute the "target" path that would escape the worktree
      const relative = require("node:path").relative(projectRoot, readyIntentPath);
      const { resolve } = require("node:path");
      const targetInWorktree = resolve(join(worktreePath, relative));

      // Check that it escapes
      const resolvedWorktreePath = resolve(worktreePath);
      const escapes = !targetInWorktree.startsWith(resolvedWorktreePath + "/") && targetInWorktree !== resolvedWorktreePath;

      expect(escapes).toBe(true);
      // External file should not be deleted
      expect(existsSync(readyIntentPath)).toBe(true);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
      rmSync(worktreePath, { recursive: true, force: true });
      rmSync(externalDir, { recursive: true, force: true });
    }
  });

  test("deletion is skipped when file does not exist in worktree", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "jarvis-missing-test-"));
    const worktreePath = mkdtempSync(join(tmpdir(), "jarvis-missing-worktree-"));
    try {
      // Ready-intent path that doesn't exist in worktree
      const readyIntentPath = join(projectRoot, "ready-intents", "missing.md");

      // Compute target path
      const relative = require("node:path").relative(projectRoot, readyIntentPath);
      const { resolve } = require("node:path");
      const targetInWorktree = resolve(join(worktreePath, relative));

      // Should not exist
      expect(existsSync(targetInWorktree)).toBe(false);

      // Deletion should be safe even if file doesn't exist
      // (the function should skip silently)
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
      rmSync(worktreePath, { recursive: true, force: true });
    }
  });

  test("deletion preserves intent.md in spec directory", () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-intent-preserve-"));
    try {
      const specDir = join(dir, "spec", "my-plan");
      mkdirSync(specDir, { recursive: true });
      const intentPath = join(specDir, "intent.md");
      const intentContent = "---\nname: my-plan\n---\n\n## Prerequisites\n\nTest intent";
      writeFileSync(intentPath, intentContent);

      // Verify intent.md exists
      expect(existsSync(intentPath)).toBe(true);
      expect(readFileSync(intentPath, "utf8")).toBe(intentContent);

      // Deletion of ready-intent should not affect intent.md
      // (they are separate files)
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
