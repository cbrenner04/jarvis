import { describe, expect, test } from "bun:test";
import { resolveCiTestScope } from "./ci-test-scope";

describe("resolveCiTestScope", () => {
  test("v1-only change runs agent + integration v1 slices", () => {
    expect(resolveCiTestScope(["v1/src/index.ts"], true)).toEqual(["test:v1", "test:integration:v1"]);
  });

  test("v2-only change runs test:v2 + test:integration:v2", () => {
    expect(resolveCiTestScope(["v2/src/foo.ts"], true)).toEqual(["test:v2", "test:integration:v2"]);
  });

  test("shared-only change runs all scoped slices", () => {
    expect(resolveCiTestScope(["shared/git.ts"], true)).toEqual([
      "test:v1",
      "test:integration:v1",
      "test:v2",
      "test:integration:v2",
      "test:shared",
      "test:integration:shared",
    ]);
  });

  test("v1 + v2 change runs all scoped slices except shared harness", () => {
    expect(resolveCiTestScope(["v1/src/index.ts", "v2/src/foo.ts"], true)).toEqual([
      "test:v1",
      "test:integration:v1",
      "test:v2",
      "test:integration:v2",
    ]);
  });

  test.each([
    ["package.json"],
    ["tsconfig.json"],
    [".github/workflows/ci.yml"],
    ["scripts/ready.ts"],
  ])("root-tooling change %s runs full suite", (path) => {
    expect(resolveCiTestScope([path], true)).toBe("full");
  });

  test("unmatched path runs full suite", () => {
    expect(resolveCiTestScope(["README.md"], true)).toBe("full");
  });

  test("unresolvable base runs full suite regardless of paths", () => {
    expect(resolveCiTestScope(["v1/src/index.ts"], false)).toBe("full");
  });
});
