import { describe, expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { resolveHarnessRoot } from "../../../shared/markdownlint-repair.ts";
import {
  AsyncSubprocessError,
  type AsyncSubprocessOptions,
  type AsyncSubprocessRunner,
} from "../../../shared/subprocess.ts";
import { lintStagedMarkdown, STAGED_MARKDOWN_LINT_TIMEOUT_MS } from "./staged-markdown-lint.ts";

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
  test("autofixes fixable violations in place and reports clean", async () => {
    if (skipWithoutHarnessMarkdownlint("autofixes fixable violations in place and reports clean")) return;

    for (const fixtureName of ["md012-violation.md", "md038-violation.md"] as const) {
      const { worktreePath, stagingRoot } = stageFixture(fixtureName);
      try {
        const before = readFileSync(join(worktreePath, stagingRoot, "index.md"), "utf8");
        const result = await lintStagedMarkdown(stagingRoot, { harnessRootOverride: HARNESS_ROOT, worktreePath });
        expect(result).toEqual({ kind: "clean" });
        // Mutation checkpoint: dropping `--fix` from the lint args must turn this RED.
        expect(readFileSync(join(worktreePath, stagingRoot, "index.md"), "utf8")).not.toBe(before);
      } finally {
        rmSync(worktreePath, { recursive: true, force: true });
      }
    }
  });

  test("reports a violation the autofix cannot repair with rule id and repo-relative path", async () => {
    if (skipWithoutHarnessMarkdownlint("reports a violation the autofix cannot repair")) return;

    const { worktreePath, stagingRoot } = stageFixture("md025-violation.md");
    try {
      const result = await lintStagedMarkdown(stagingRoot, { harnessRootOverride: HARNESS_ROOT, worktreePath });
      expect(result).toEqual({
        kind: "violation",
        ruleId: "MD025",
        filePath: `${stagingRoot}/index.md`,
        message: expect.any(String),
      });
    } finally {
      rmSync(worktreePath, { recursive: true, force: true });
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

  test("an injected runner is used even when the harness root has no markdownlint binary", async () => {
    const { worktreePath, stagingRoot } = stageFixture("lint-clean.md");
    const emptyHarnessRoot = mkdtempSync(join(tmpdir(), "jarvis-empty-harness-"));
    const calls: string[][] = [];
    const runner: AsyncSubprocessRunner = {
      runAsync: async (_command, args) => {
        calls.push(args);
        return `${join(worktreePath, stagingRoot, "index.md")}:1 MD041/first-line-heading stub violation`;
      },
    };
    try {
      const result = await lintStagedMarkdown(stagingRoot, {
        harnessRootOverride: emptyHarnessRoot,
        worktreePath,
        runner,
      });
      expect(calls).toHaveLength(1);
      expect(result).toMatchObject({ kind: "violation", ruleId: "MD041" });
    } finally {
      rmSync(worktreePath, { recursive: true, force: true });
      rmSync(emptyHarnessRoot, { recursive: true, force: true });
    }
  });

  test("fails closed when the linter invocation errors", async () => {
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

  test("bounds the linter spawn with a timeout, abort signal, and recorded process group", async () => {
    const { worktreePath, stagingRoot } = stageFixture("lint-clean.md");
    const seen: AsyncSubprocessOptions[] = [];
    const recorded: string[] = [];
    const controller = new AbortController();
    const runner: AsyncSubprocessRunner = {
      runAsync: async (_cmd, _args, _cwd, options) => {
        if (options !== undefined) seen.push(options);
        options?.processGroup?.onGroupId?.(77);
        throw new AsyncSubprocessError("Command timed out", undefined, "", "", "ETIMEDOUT");
      },
    };
    try {
      const result = await lintStagedMarkdown(stagingRoot, {
        harnessRootOverride: HARNESS_ROOT,
        worktreePath,
        runner,
        signal: controller.signal,
        processGroups: { record: (id) => recorded.push(`record:${id}`), clear: (id) => recorded.push(`clear:${id}`) },
      });
      expect(result.kind).toBe("invocation_error");
      expect(seen[0]?.timeoutMs).toBe(STAGED_MARKDOWN_LINT_TIMEOUT_MS);
      expect(seen[0]?.signal).toBe(controller.signal);
      expect(recorded).toEqual(["record:77", "clear:77"]);
    } finally {
      rmSync(worktreePath, { recursive: true, force: true });
    }
  });
});
