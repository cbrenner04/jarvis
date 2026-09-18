// Exercises the real markdownlint-cli2 binary via the intent-landing path's default runner.
import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { trackedMkdtempSync } from "../../../shared/tracked-temp-dir.test-support.ts";
import { landIntentWorkflowOutput } from "./intent-output.ts";

function createRepo(): string {
  const repo = trackedMkdtempSync(join(tmpdir(), "jarvis-intent-output-"));
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

describe("landIntentWorkflowOutput (real markdownlint binary)", () => {
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
    expect(result.downstreamInputs).toBeUndefined();
    expect(readFileSync(join(repo, "ready-intents", "one.md"), "utf8")).toContain("# one");
  });

  test("applies the real markdownlint autofix to a landed intent", async () => {
    const repo = createRepo();
    const dir = stage(repo);
    // A padded code span (MD038) is fixed only by markdownlint --fix, not by the structural intent repair.
    writeFileSync(
      join(dir, "one.md"),
      "---\nname: one\n---\n\n# one\n\nRun `  bun test` first.\n\n## Prerequisites\n",
      "utf8",
    );
    await landIntentWorkflowOutput({ worktreePath: repo, baseRef: "HEAD", output: { durableDir: "ready-intents" } });
    const landed = readFileSync(join(repo, "ready-intents", "one.md"), "utf8");
    expect(landed).toContain("Run `bun test` first.");
  });
});
