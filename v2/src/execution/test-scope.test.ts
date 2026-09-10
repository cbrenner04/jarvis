import { expect, test } from "bun:test";
import { type CoverageTestScope, coverageTestScope, type KillingTestPaths, killingTestPaths } from "./test-scope.ts";

function runCoverage(scope: CoverageTestScope): number {
  return scope.length;
}

function runKilling(scope: KillingTestPaths): number {
  return scope.length;
}

test("scoped-test list brands reject each other's shape at compile time", () => {
  const coverage = coverageTestScope(["v2/src"]);
  const killing = killingTestPaths(["v2/src/example.test.ts"]);
  expect(runCoverage(coverage)).toBe(1);
  expect(runKilling(killing)).toBe(1);
  // @ts-expect-error a coverage pattern list is not a killing-test path list
  runKilling(coverage);
  // @ts-expect-error a killing-test path list is not a coverage pattern list
  runCoverage(killing);
  // @ts-expect-error a bare string[] carries neither brand
  runKilling(["v2/src/example.test.ts"]);
  // @ts-expect-error a bare string[] carries neither brand
  runCoverage(["v2/src"]);
});
