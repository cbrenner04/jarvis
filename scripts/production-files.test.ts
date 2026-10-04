import { describe, expect, test } from "bun:test";
import { isProductionSourceFile, isTestCodePath } from "./production-files.ts";

describe("isTestCodePath", () => {
  test("true for .test.ts, .test.tsx, and .test-support.ts basenames", () => {
    expect(isTestCodePath("src/execution/foo.test.ts")).toBe(true);
    expect(isTestCodePath("src/tui/foo.test.tsx")).toBe(true);
    expect(isTestCodePath("src/execution/foo.test-support.ts")).toBe(true);
  });

  test("false for a plain production path", () => {
    expect(isTestCodePath("src/execution/foo.ts")).toBe(false);
  });

  test("false for a mid-basename .test. occurrence that isn't the anchored suffix", () => {
    expect(isTestCodePath("src/execution/foo.test.helpers.ts")).toBe(false);
  });
});

describe("isProductionSourceFile", () => {
  test("true for a plain production source under v2/", () => {
    expect(isProductionSourceFile("src/execution/foo.ts")).toBe(true);
  });

  test("false for a test file, even though it otherwise matches the production roots and extension", () => {
    expect(isProductionSourceFile("src/execution/foo.test.ts")).toBe(false);
  });

  test("false for a test-support file", () => {
    expect(isProductionSourceFile("src/execution/foo.test-support.ts")).toBe(false);
  });
});
