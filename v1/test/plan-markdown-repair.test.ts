import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { resolveHarnessRoot } from "../src/markdownlint-repair.ts";
import { listPlanSpecMarkdownPaths, repairPlanSpecMarkdown } from "../src/modes/plan/markdown-repair.ts";

function getHarnessMarkdownlintPaths(): { root: string; binary: string; config: string } | null {
  const root = resolveHarnessRoot(resolve(import.meta.dir, "../.."));
  if (root === null) {
    return null;
  }
  return {
    root,
    binary: join(root, "node_modules", "markdownlint-cli2", "markdownlint-cli2.js"),
    config: join(root, ".markdownlint-cli2.jsonc"),
  };
}

function runHarnessMarkdownlint(paths: string[]): number {
  const harness = getHarnessMarkdownlintPaths();
  if (harness === null) {
    throw new Error("missing pinned markdownlint binary");
  }
  const result = spawnSync("bun", [harness.binary, "--config", harness.config, ...paths], {
    cwd: harness.root,
    env: process.env,
    stdio: "pipe",
  });
  if (result.error) {
    throw result.error;
  }
  return result.status ?? 1;
}

describe("listPlanSpecMarkdownPaths", () => {
  test("includes index, intent, numbered subspecs; excludes verdict files", () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-plan-md-list-"));
    try {
      writeFileSync(join(dir, "index.md"), "# Spec\n");
      writeFileSync(join(dir, "intent.md"), "# Intent\n");
      writeFileSync(join(dir, "00-task.md"), "# Task\n");
      writeFileSync(join(dir, "verdict-plan.md"), "# Verdict\n");

      const paths = listPlanSpecMarkdownPaths(dir).map((p) => p.split("/").pop());
      expect(paths).toEqual(["index.md", "intent.md", "00-task.md"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("repairPlanSpecMarkdown", () => {
  test("cleans seeded violations so lint:md passes; skips when binary absent", async () => {
    const harness = getHarnessMarkdownlintPaths();
    if (harness === null || !existsSync(harness.binary)) {
      process.stderr.write("skip: repair lint check; pinned markdownlint binary not installed in this worktree\n");
      return;
    }

    const dir = mkdtempSync(join(tmpdir(), "jarvis-plan-md-repair-"));
    try {
      writeFileSync(
        join(dir, "index.md"),
        "# Spec\n\nrepo: https://github.com/example/repo\n\n- [ ] [00 - Task](./00-task.md)\n",
      );
      writeFileSync(join(dir, "intent.md"), "# Intent\n\nSee https://example.com/docs\n");
      writeFileSync(join(dir, "00-task.md"), "# Task\n\nVisit https://example.com/task for details.\n");

      await repairPlanSpecMarkdown({
        specDirPath: dir,
        commit: true,
        warn: () => {},
      });

      expect(readFileSync(join(dir, "index.md"), "utf8")).not.toContain("repo:");
      expect(readFileSync(join(dir, "00-task.md"), "utf8")).not.toMatch(/^Visit https:\/\//m);

      expect(runHarnessMarkdownlint(listPlanSpecMarkdownPaths(dir))).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("residual non-autofixable violations do not throw", async () => {
    const harness = getHarnessMarkdownlintPaths();
    if (harness === null || !existsSync(harness.binary)) {
      process.stderr.write("skip: repair residual check; pinned markdownlint binary not installed in this worktree\n");
      return;
    }

    const dir = mkdtempSync(join(tmpdir(), "jarvis-plan-md-residual-"));
    try {
      writeFileSync(join(dir, "index.md"), "# Spec\n\n- [ ] [00 - Task](./00-task.md)\n");
      writeFileSync(join(dir, "00-task.md"), "# Task\n\n<!-- deliberate unfixable if any -->\n");

      await expect(
        repairPlanSpecMarkdown({
          specDirPath: dir,
          commit: false,
          warn: () => {},
        }),
      ).resolves.toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("safeMarkPlanPrReady resume wiring", () => {
  test("resume success path invokes repair before ready", () => {
    const source = readFileSync(join(import.meta.dir, "../src/modes/plan/run.ts"), "utf8");
    expect(source).toContain("repairPlanSpecMarkdown");
    expect(source).toMatch(/if \(commit\) \{[\s\S]*safeMarkPlanPrReady\([\s\S]*specDirPath: resumeSpecPath/s);
  });
});
