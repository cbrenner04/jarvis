import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { intentHandoffSpecPath, landIntentWorkflowOutput } from "./intent-output.ts";

function createRepo(): string {
  const repo = mkdtempSync(join(tmpdir(), "jarvis-intent-output-"));
  execFileSync("git", ["init", "-q"], { cwd: repo });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: repo });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: repo });
  writeFileSync(join(repo, "seed"), "base\n", "utf8");
  execFileSync("git", ["add", "."], { cwd: repo });
  execFileSync("git", ["commit", "-qm", "base"], { cwd: repo });
  return repo;
}

function stage(repo: string, names: string[] = ["one"]): string {
  const dir = join(repo, ".jarvis-intent-stage");
  mkdirSync(dir, { recursive: true });
  for (const name of names) {
    writeFileSync(join(dir, `${name}.md`), `---\nname: ${name}\n---\n\n# ${name}\n\n## Prerequisites\n`, "utf8");
  }
  return dir;
}

describe("landIntentWorkflowOutput", () => {
  test("lands one valid intent and records file handoff specPath", async () => {
    const repo = createRepo();
    stage(repo);
    const result = await landIntentWorkflowOutput({
      worktreePath: repo,
      baseRef: "HEAD",
      output: { durableDir: "ready-intents" },
    });
    expect(result.files).toEqual(["one.md"]);
    expect(result.specPath).toBe("ready-intents/one.md");
    expect(result.specPath).not.toBe("ready-intents");
    expect(readFileSync(join(repo, "ready-intents", "one.md"), "utf8")).toContain("# one");
  });

  test("inverting the single-file guard fails single-file handoff", () => {
    expect(intentHandoffSpecPath("/repo", "ready-intents", ["one.md"])).toBe("ready-intents/one.md");
    expect(intentHandoffSpecPath("/repo", "ready-intents", ["one.md"], { invertSingleFileGuardForTest: true })).toBe(
      "ready-intents",
    );
  });

  test("multi-file landing keeps specPath on the durable directory", async () => {
    const repo = createRepo();
    stage(repo, ["one", "two"]);
    const result = await landIntentWorkflowOutput({
      worktreePath: repo,
      baseRef: "HEAD",
      output: { durableDir: "ready-intents" },
    });
    expect(result.files).toEqual(["one.md", "two.md"]);
    expect(result.specPath).toBe("ready-intents");
    expect(intentHandoffSpecPath(repo, "ready-intents", result.files, { invertSingleFileGuardForTest: true })).toBe(
      "ready-intents/one.md",
    );
  });

  test("idempotent re-land early-return applies the same handoff rules", async () => {
    const repo = createRepo();
    stage(repo);
    const invocationId = "re-land";
    const first = await landIntentWorkflowOutput({
      worktreePath: repo,
      baseRef: "HEAD",
      output: { durableDir: "ready-intents" },
      invocationId,
    });
    expect(first.specPath).toBe("ready-intents/one.md");
    const second = await landIntentWorkflowOutput({
      worktreePath: repo,
      baseRef: "HEAD",
      output: { durableDir: "ready-intents" },
      invocationId,
    });
    expect(second.specPath).toBe("ready-intents/one.md");
    expect(second.specPath).not.toBe("ready-intents");
    expect(intentHandoffSpecPath(repo, "ready-intents", second.files, { invertSingleFileGuardForTest: true })).toBe(
      "ready-intents",
    );
  });

  test("rejects rogue edits and retains staging", async () => {
    const repo = createRepo();
    stage(repo);
    writeFileSync(join(repo, "rogue"), "no\n", "utf8");
    await expect(
      landIntentWorkflowOutput({ worktreePath: repo, baseRef: "HEAD", output: { durableDir: "ready-intents" } }),
    ).rejects.toThrow("rogue");
    expect(readFileSync(join(repo, ".jarvis-intent-stage", "one.md"), "utf8")).toContain("name: one");
  });

  test("rejects differing collisions without overwrite", async () => {
    const repo = createRepo();
    stage(repo);
    mkdirSync(join(repo, "ready-intents"), { recursive: true });
    writeFileSync(join(repo, "ready-intents", "one.md"), "other\n", "utf8");
    await expect(
      landIntentWorkflowOutput({ worktreePath: repo, baseRef: "HEAD", output: { durableDir: "ready-intents" } }),
    ).rejects.toThrow("different contents");
    expect(readFileSync(join(repo, "ready-intents", "one.md"), "utf8")).toBe("other\n");
  });

  test("lands output without git state", async () => {
    const root = mkdtempSync(join(tmpdir(), "jarvis-intent-output-no-git-"));
    stage(root);
    const result = await landIntentWorkflowOutput({
      worktreePath: root,
      baseRef: "none",
      output: { durableDir: "ready-intents" },
      invocationId: "no-git",
    });
    expect(result.specPath).toBe("ready-intents/one.md");
    expect(existsSync(join(root, ".jarvis-intent-stage"))).toBe(false);
  });

  test("rejects rogue edits without git state", async () => {
    const root = mkdtempSync(join(tmpdir(), "jarvis-intent-output-no-git-"));
    stage(root);
    writeFileSync(join(root, "rogue"), "no\n", "utf8");
    await expect(
      landIntentWorkflowOutput({ worktreePath: root, baseRef: "none", output: { durableDir: "ready-intents" } }),
    ).rejects.toThrow("rogue");
    expect(readFileSync(join(root, ".jarvis-intent-stage", "one.md"), "utf8")).toContain("name: one");
  });
});
