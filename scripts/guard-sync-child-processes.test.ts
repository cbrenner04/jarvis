import { describe, expect, test } from "bun:test";
import { findSyncChildProcessViolations } from "./guard-sync-child-processes.ts";

function violations(source: string, file = "v2/src/example.ts") {
  return findSyncChildProcessViolations([{ file, source }]);
}

describe("sync child-process guard", () => {
  test.each([
    ["static import", 'import { execSync } from "node:child_process"; execSync("git");'],
    ["require", 'const { execFileSync } = require("child_process"); execFileSync("git");'],
    ["dynamic import", 'const { spawnSync } = await import("node:child_process"); spawnSync("git");'],
  ])("rejects %s", (_reach, source) => {
    expect(violations(source)).toMatchObject([{ file: "v2/src/example.ts", line: 1 }]);
  });

  test("rejects Bun.spawnSync and v2 synchronous seams", () => {
    expect(violations('Bun.spawnSync(["git"]);')).toMatchObject([{ construct: "Bun.spawnSync" }]);
    expect(violations('import { type SubprocessRunner } from "../../shared/subprocess.ts";')).toHaveLength(1);
    expect(violations('import { isGitRepo } from "../../shared/git.ts";')).toHaveLength(1);
  });

  test("allows the CLI runner, test files, and test support", () => {
    const source = 'import { execFileSync } from "node:child_process"; execFileSync("git");';
    expect(violations(source, "shared/subprocess.ts")).toEqual([]);
    expect(violations(source, "v2/src/example.test.ts")).toEqual([]);
    expect(violations(source, "v2/src/testing/process.ts")).toEqual([]);
  });
});
