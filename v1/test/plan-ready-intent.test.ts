import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateReadyIntent } from "../src/commands/plan.ts";
import { parsePlanArgs } from "../src/commands/plan-args.ts";

describe("ready-intent validation", () => {
  test("validateReadyIntent rejects file without Prerequisites section", () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-test-"));
    try {
      const readyIntentsDir = join(dir, "ready-intents");
      mkdirSync(readyIntentsDir, { recursive: true });
      const readyIntentPath = join(readyIntentsDir, "test-feature.md");
      writeFileSync(readyIntentPath, "---\nname: test-feature\n---\n\nSome content\n");

      const result = validateReadyIntent(readyIntentPath, "spec");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.message).toContain("Prerequisites");
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("validateReadyIntent accepts file with Prerequisites section", () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-test-"));
    try {
      const readyIntentsDir = join(dir, "ready-intents");
      mkdirSync(readyIntentsDir, { recursive: true });
      const readyIntentPath = join(readyIntentsDir, "test-feature.md");
      writeFileSync(readyIntentPath, "---\nname: test-feature\n---\n\n## Prerequisites\n\nSome content\n");

      const result = validateReadyIntent(readyIntentPath, "spec");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.name).toBe("test-feature");
        expect(result.content).toContain("## Prerequisites");
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("validateReadyIntent rejects file with mismatched name", () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-test-"));
    try {
      const readyIntentsDir = join(dir, "ready-intents");
      mkdirSync(readyIntentsDir, { recursive: true });
      const readyIntentPath = join(readyIntentsDir, "test-feature.md");
      writeFileSync(readyIntentPath, "---\nname: different-name\n---\n\n## Prerequisites\n\nSome content\n");

      const result = validateReadyIntent(readyIntentPath, "spec");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.message).toContain("does not match filename");
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("plan argument parsing", () => {
  test("parsePlanArgs rejects inline text", () => {
    const result = parsePlanArgs(["some inline text"], "/tmp");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("does not exist or is not a file");
    }
  });

  test("parsePlanArgs accepts --resume-draft but plan.ts will reject it", () => {
    // --resume-draft is parsed but rejected at the plan.ts level when used with fresh input
    const result = parsePlanArgs(["--resume-draft", "/path/to/intent.md"], "/tmp");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.invocation.resumeDraft).toBe(true);
    }
  });

  test("parsePlanArgs accepts --resume with path", () => {
    const result = parsePlanArgs(["--resume", "/path/to/index.md"], "/tmp");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.invocation.resume).toBe(true);
      expect(result.invocation.readyIntentPath).toBe("/path/to/index.md");
    }
  });
});
