import { describe, expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { resolveHarnessRoot } from "../../../shared/markdownlint-repair.ts";
import { AsyncSubprocessError, type AsyncSubprocessRunner } from "../../../shared/subprocess.ts";
import { lintStagedMarkdown } from "./staged-markdown-lint.ts";

const FIXTURES_DIR = join(import.meta.dir, "fixtures", "staged-markdown-lint");
const HARNESS_ROOT = resolveHarnessRoot(resolve(import.meta.dir, "../../.."));

function hasHarnessMarkdownlint(): boolean {
  if (HARNESS_ROOT === null) return false;
  return existsSync(join(HARNESS_ROOT, "node_modules", "markdownlint-cli2", "markdownlint-cli2.js"));
}

function skipWithoutHarnessMarkdownlint(reason: string): boolean {
  if (hasHarnessMarkdownlint()) return false;
  process.stderr.write(`skip: ${reason}; pinned markdownlint binary not installed in this worktree\n`);
  return true;
}

function stageFixture(fixtureName: string, stagedName = "index.md"): { worktreePath: string; stagingRoot: string } {
  const worktreePath = mkdtempSync(join(tmpdir(), "jarvis-staged-md-lint-"));
  const stagingRoot = ".jarvis-plan-stage";
  const stagingDir = join(worktreePath, stagingRoot);
  mkdirSync(stagingDir, { recursive: true });
  cpSync(join(FIXTURES_DIR, fixtureName), join(stagingDir, stagedName));
  return { worktreePath, stagingRoot };
}

describe("staged-markdown-lint", () => {
  test("reports the first violation with rule id and repo-relative path", async () => {
    if (skipWithoutHarnessMarkdownlint("reports the first violation with rule id and repo-relative path")) return;

    for (const [fixtureName, expectedRuleId] of [
      ["md012-violation.md", "MD012"],
      ["md038-violation.md", "MD038"],
    ] as const) {
      const { worktreePath, stagingRoot } = stageFixture(fixtureName);
      try {
        const result = await lintStagedMarkdown(stagingRoot, {
          harnessRootOverride: HARNESS_ROOT,
          worktreePath,
        });
        expect(result).toEqual({
          kind: "violation",
          ruleId: expectedRuleId,
          filePath: `${stagingRoot}/index.md`,
          message: expect.any(String),
        });
      } finally {
        rmSync(worktreePath, { recursive: true, force: true });
      }
    }
  });

  test("reports clean staged Markdown as passing", async () => {
    if (skipWithoutHarnessMarkdownlint("reports clean staged Markdown as passing")) return;

    const { worktreePath, stagingRoot } = stageFixture("lint-clean.md");
    try {
      const result = await lintStagedMarkdown(stagingRoot, {
        harnessRootOverride: HARNESS_ROOT,
        worktreePath,
      });
      expect(result).toEqual({ kind: "clean" });
    } finally {
      rmSync(worktreePath, { recursive: true, force: true });
    }
  });

  test("fails closed when the linter invocation errors", async () => {
    // @mutate v2/src/execution/staged-markdown-lint.ts "if (err instanceof AsyncSubprocessError) {" -> "if (false) {"
    const { worktreePath, stagingRoot } = stageFixture("lint-clean.md");
    const runner: AsyncSubprocessRunner = {
      runAsync: async () => {
        throw new AsyncSubprocessError("markdownlint missing", undefined, "", "ENOENT: missing binary", "ENOENT");
      },
    };
    try {
      const result = await lintStagedMarkdown(stagingRoot, {
        harnessRootOverride: HARNESS_ROOT,
        worktreePath,
        runner,
      });
      expect(result.kind).toBe("invocation_error");
      if (result.kind === "invocation_error") {
        expect(result.message).toContain("ENOENT");
      }
    } finally {
      rmSync(worktreePath, { recursive: true, force: true });
    }
  });
});
