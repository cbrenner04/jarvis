import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  findTestSupportImportViolations,
  runTestSupportImportGuard,
  tsconfigExcludesTestSupport,
} from "./guard-production-test-support-imports.ts";
import { isProductionSourceFile } from "./production-files.ts";

const REPO_ROOT = join(import.meta.dir, "..");
const supportImport = 'import { fixture } from "./workflow-runner.test-support.ts";';

describe("production test-support import guard", () => {
  test.each([
    ["static import", supportImport],
    ["type import", 'import type { Fixture } from "./workflow-runner.test-support.ts";'],
    ["side-effect import", 'import "./workflow-runner.test-support.ts";'],
    ["dynamic import", 'const mod = await import("./workflow-runner.test-support.ts");'],
    ["require", 'const mod = require("./workflow-runner.test-support.ts");'],
    ["re-export", 'export { fixture } from "./workflow-runner.test-support.ts";'],
  ])("rejects a production %s of test support", (_reach, source) => {
    expect(findTestSupportImportViolations([{ file: "v2/src/execution/example.ts", source }])).toMatchObject([
      { file: "v2/src/execution/example.ts", line: 1, specifier: "./workflow-runner.test-support.ts" },
    ]);
  });

  test("allows test files, test support, and the testing harness to import test support", () => {
    for (const file of [
      "v2/src/execution/example.test.ts",
      "v2/src/execution/other.test-support.ts",
      "v2/src/testing/fixture.ts",
    ]) {
      expect(findTestSupportImportViolations([{ file, source: supportImport }])).toEqual([]);
    }
  });

  test("allows production imports of production modules", () => {
    const source = 'import { runWorkflow } from "./workflow-runner.ts";';
    expect(findTestSupportImportViolations([{ file: "v2/src/execution/example.ts", source }])).toEqual([]);
  });

  test("production predicate excludes tests, test support, and the testing harness", () => {
    expect(isProductionSourceFile("v2/src/execution/workflow-runner.ts")).toBe(true);
    expect(isProductionSourceFile("shared/git.ts")).toBe(true);
    expect(isProductionSourceFile("v2/src/tui/app.tsx")).toBe(true);
    expect(isProductionSourceFile("v2/src/execution/workflow-runner.test.ts")).toBe(false);
    expect(isProductionSourceFile("v2/src/execution/workflow-runner.test-support.ts")).toBe(false);
    expect(isProductionSourceFile("v2/src/testing/process.ts")).toBe(false);
    expect(isProductionSourceFile("scripts/ready.ts")).toBe(false);
  });

  test("the swept tree has no production test-support imports and the tsconfig excludes them", () => {
    expect(runTestSupportImportGuard(REPO_ROOT)).toEqual([]);
    expect(tsconfigExcludesTestSupport(REPO_ROOT)).toBe(true);
  });
});
