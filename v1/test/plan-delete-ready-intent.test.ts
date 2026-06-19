import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deleteReadyIntentFromWorktree } from "../src/commands/plan.ts";

const READY_INTENT = "---\nname: my-feature\n---\n\n## Prerequisites\n\nTest\n";

describe("ready-intent deletion", () => {
  test("deletes the matching worktree file only", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "jarvis-delete-test-"));
    const worktreePath = mkdtempSync(join(tmpdir(), "jarvis-delete-worktree-"));
    try {
      const readyIntentsDir = join(projectRoot, "ready-intents");
      mkdirSync(readyIntentsDir, { recursive: true });
      const readyIntentPath = join(readyIntentsDir, "my-feature.md");
      writeFileSync(readyIntentPath, READY_INTENT);
      writeFileSync(join(readyIntentsDir, "other-feature.md"), READY_INTENT);

      const worktreeReadyIntentsDir = join(worktreePath, "ready-intents");
      mkdirSync(worktreeReadyIntentsDir, { recursive: true });
      const worktreeReadyIntentPath = join(worktreeReadyIntentsDir, "my-feature.md");
      const otherWorktreeReadyIntentPath = join(worktreeReadyIntentsDir, "other-feature.md");
      writeFileSync(worktreeReadyIntentPath, READY_INTENT);
      writeFileSync(otherWorktreeReadyIntentPath, READY_INTENT);

      expect(existsSync(worktreeReadyIntentPath)).toBe(true);
      expect(
        deleteReadyIntentFromWorktree({
          readyIntentPath,
          projectRoot,
          worktreePath,
        }),
      ).toBe(true);
      expect(existsSync(worktreeReadyIntentPath)).toBe(false);
      expect(existsSync(otherWorktreeReadyIntentPath)).toBe(true);
      expect(existsSync(readyIntentPath)).toBe(true);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
      rmSync(worktreePath, { recursive: true, force: true });
    }
  });

  test("skips escaped targets", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "jarvis-escape-test-"));
    const worktreePath = mkdtempSync(join(tmpdir(), "jarvis-escape-worktree-"));
    const externalDir = mkdtempSync(join(tmpdir(), "jarvis-escape-external-"));
    try {
      const externalReadyIntentsDir = join(externalDir, "ready-intents");
      mkdirSync(externalReadyIntentsDir, { recursive: true });
      const readyIntentPath = join(externalReadyIntentsDir, "my-feature.md");
      writeFileSync(readyIntentPath, READY_INTENT);
      expect(
        deleteReadyIntentFromWorktree({
          readyIntentPath,
          projectRoot,
          worktreePath,
        }),
      ).toBe(false);
      expect(existsSync(readyIntentPath)).toBe(true);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
      rmSync(worktreePath, { recursive: true, force: true });
      rmSync(externalDir, { recursive: true, force: true });
    }
  });

  test("skips missing worktree files", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "jarvis-missing-test-"));
    const worktreePath = mkdtempSync(join(tmpdir(), "jarvis-missing-worktree-"));
    try {
      const readyIntentsDir = join(projectRoot, "ready-intents");
      mkdirSync(readyIntentsDir, { recursive: true });
      const readyIntentPath = join(readyIntentsDir, "missing.md");
      writeFileSync(readyIntentPath, READY_INTENT);
      expect(
        deleteReadyIntentFromWorktree({
          readyIntentPath,
          projectRoot,
          worktreePath,
        }),
      ).toBe(false);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
      rmSync(worktreePath, { recursive: true, force: true });
    }
  });

  test("does not touch intent.md", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "jarvis-intent-project-"));
    const worktreePath = mkdtempSync(join(tmpdir(), "jarvis-intent-worktree-"));
    try {
      const readyIntentsDir = join(projectRoot, "ready-intents");
      mkdirSync(readyIntentsDir, { recursive: true });
      const readyIntentPath = join(readyIntentsDir, "my-feature.md");
      writeFileSync(readyIntentPath, READY_INTENT);

      const worktreeReadyIntentsDir = join(worktreePath, "ready-intents");
      mkdirSync(worktreeReadyIntentsDir, { recursive: true });
      writeFileSync(join(worktreeReadyIntentsDir, "my-feature.md"), READY_INTENT);

      const specDir = join(worktreePath, "spec", "my-plan");
      mkdirSync(specDir, { recursive: true });
      const intentPath = join(specDir, "intent.md");
      const intentContent = "---\nname: my-plan\n---\n\n## Prerequisites\n\nTest intent\n";
      writeFileSync(intentPath, intentContent);
      expect(
        deleteReadyIntentFromWorktree({
          readyIntentPath,
          projectRoot,
          worktreePath,
        }),
      ).toBe(true);
      expect(readFileSync(intentPath, "utf8")).toBe(intentContent);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
      rmSync(worktreePath, { recursive: true, force: true });
    }
  });
});
