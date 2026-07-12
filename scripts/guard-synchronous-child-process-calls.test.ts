import { describe, expect, test } from "bun:test";
import { findSynchronousChildProcessViolations } from "./guard-synchronous-child-process-calls.ts";

const fixtures = {
  staticImport: 'import { execSync } from "node:child_process";\nexecSync("git status");',
  require: 'const { execFileSync } = require("child_process");\nexecFileSync("git", []);',
  dynamicImport: 'const result = (await import("node:child_process")).spawnSync("git", []);',
  bun: 'Bun.spawnSync(["git", "status"]);',
  syncSeam: 'import { realSubprocessRunner } from "../../shared/subprocess.ts";',
  gitHelper: 'import { isGitRepo } from "../../shared/git.ts";',
  allowlisted: 'import { execFileSync } from "node:child_process";',
  testFile: 'import { execSync } from "node:child_process";',
};

describe("synchronous child-process guard", () => {
  test.each([
    ["static import", fixtures.staticImport, "execSync from child_process"],
    ["require", fixtures.require, "execFileSync from child_process"],
    ["dynamic import", fixtures.dynamicImport, "spawnSync from child_process"],
  ])("rejects %s fixtures", (_name, source, construct) => {
    expect(findSynchronousChildProcessViolations("v2/src/fixture.ts", source)).toEqual([
      { file: "v2/src/fixture.ts", line: 1, construct },
    ]);
  });

  test("rejects v2 synchronous seams", () => {
    expect(findSynchronousChildProcessViolations("v2/src/fixture.ts", fixtures.syncSeam)[0]?.construct).toBe(
      "realSubprocessRunner from shared/subprocess.ts",
    );
    expect(findSynchronousChildProcessViolations("v2/src/fixture.ts", fixtures.gitHelper)[0]?.construct).toBe(
      "isGitRepo from shared/git.ts",
    );
  });

  test("rejects Bun.spawnSync", () => {
    expect(findSynchronousChildProcessViolations("shared/fixture.ts", fixtures.bun)).toEqual([
      { file: "shared/fixture.ts", line: 1, construct: "Bun.spawnSync" },
    ]);
  });

  test("permits the allowlisted module and test files", () => {
    expect(findSynchronousChildProcessViolations("shared/subprocess.ts", fixtures.allowlisted)).toEqual([]);
    expect(findSynchronousChildProcessViolations("v2/src/fixture.test.ts", fixtures.testFile)).toEqual([]);
    expect(findSynchronousChildProcessViolations("v2/src/testing/fixture.ts", fixtures.testFile)).toEqual([]);
  });
});
