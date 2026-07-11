import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { landIntentWorkflowOutput } from "./intent-output.ts";

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

function stage(repo: string, name = "one"): string {
  const dir = join(repo, ".jarvis-intent-stage");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${name}.md`), `---\nname: ${name}\n---\n\n# ${name}\n\n## Prerequisites\n`, "utf8");
  return dir;
}

describe("landIntentWorkflowOutput", () => {
  test("lands one valid intent and removes staging", () => {
    const repo = createRepo();
    stage(repo);
    const result = landIntentWorkflowOutput({
      worktreePath: repo,
      baseRef: "HEAD",
      output: { durableDir: "ready-intents" },
    });
    expect(result.files).toEqual(["one.md"]);
    expect(readFileSync(join(repo, "ready-intents", "one.md"), "utf8")).toContain("# one");
  });

  test("rejects rogue edits and retains staging", () => {
    const repo = createRepo();
    stage(repo);
    writeFileSync(join(repo, "rogue"), "no\n", "utf8");
    expect(() =>
      landIntentWorkflowOutput({ worktreePath: repo, baseRef: "HEAD", output: { durableDir: "ready-intents" } }),
    ).toThrow("rogue");
    expect(readFileSync(join(repo, ".jarvis-intent-stage", "one.md"), "utf8")).toContain("name: one");
  });

  test("rejects differing collisions without overwrite", () => {
    const repo = createRepo();
    stage(repo);
    mkdirSync(join(repo, "ready-intents"), { recursive: true });
    writeFileSync(join(repo, "ready-intents", "one.md"), "other\n", "utf8");
    expect(() =>
      landIntentWorkflowOutput({ worktreePath: repo, baseRef: "HEAD", output: { durableDir: "ready-intents" } }),
    ).toThrow("different contents");
    expect(readFileSync(join(repo, "ready-intents", "one.md"), "utf8")).toBe("other\n");
  });
});
