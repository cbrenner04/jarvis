import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { findGitSpawnBypassViolations, GH_OWNER_FILE, runGitSpawnBypassGuard } from "./guard-git-spawn-bypass.ts";

const EXAMPLE_FILE = "v2/src/execution/example.ts";

function violations(source: string, file = EXAMPLE_FILE) {
  return findGitSpawnBypassViolations([{ file, source }]);
}

describe("git spawn bypass guard", () => {
  test("rejects runAsync git literal in production fixture", () => {
    const source = 'await runner.runAsync("git", ["status"], cwd);';
    expect(violations(source)).toEqual([{ file: EXAMPLE_FILE, line: 1, command: "git" }]);
  });

  test("allows github-operations gh owner", () => {
    const ghSpawn = 'return await runner.runAsync("gh", args, cwd, runOptions(options));';
    const githubOps = readFileSync(join(process.cwd(), GH_OWNER_FILE), "utf8");
    expect(findGitSpawnBypassViolations([{ file: GH_OWNER_FILE, source: githubOps }])).toEqual([]);
    expect(violations(ghSpawn)).toEqual([{ file: EXAMPLE_FILE, line: 1, command: "gh" }]);
  });

  test("allows per-call guard-git-spawn-bypass marker", () => {
    const spawn = 'await runner.runAsync("git", ["status"], cwd);';
    const marked = ["// guard-git-spawn-bypass: integration seam", spawn].join("\n");
    expect(violations(marked)).toEqual([]);
    expect(violations(spawn)).toEqual([{ file: EXAMPLE_FILE, line: 1, command: "git" }]);
  });

  test("repository walk reports reachable inline git spawn", () => {
    const found = runGitSpawnBypassGuard(process.cwd()).some(
      (violation) => violation.file === "v2/src/execution/write-loop.ts" && violation.command === "git",
    );
    expect(found).toBe(true);
  });

  test("ignores non-production paths under v2/src", () => {
    const source = 'await runner.runAsync("git", ["status"], cwd);';
    expect(violations(source, "v2/src/execution/example.test.ts")).toEqual([]);
  });
});
