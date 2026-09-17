import { describe, expect, test } from "bun:test";
import { isTestCodePath } from "./production-files.ts";

describe("isTestCodePath", () => {
  test("true for .test.ts, .test.tsx, and .test-support.ts basenames", () => {
    expect(isTestCodePath("v2/src/execution/foo.test.ts")).toBe(true);
    expect(isTestCodePath("v2/src/tui/foo.test.tsx")).toBe(true);
    expect(isTestCodePath("v2/src/execution/foo.test-support.ts")).toBe(true);
  });

  test("false for a plain production path", () => {
    expect(isTestCodePath("v2/src/execution/foo.ts")).toBe(false);
  });

  test("false for a mid-basename .test. occurrence that isn't the anchored suffix", () => {
    expect(isTestCodePath("v2/src/execution/foo.test.helpers.ts")).toBe(false);
  });
});
