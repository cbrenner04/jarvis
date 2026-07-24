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

  test.each([
    ["doc-only", ["v1/docs/run-loop.md"]],
    ["spec-only", ["v1/spec/some-spec/index.md"]],
    ["report-only", ["reports/2026-07-05-session.md"]],
    [
      "mixed v1/v2 docs+specs",
      ["v1/docs/run-loop.md", "v1/spec/some-spec/index.md", "v2/docs/architecture.md", "v2/spec/some-spec/index.md"],
    ],
    [
      "intent workflow staging",
      [".jarvis-intent-review-verdict.md", ".jarvis-intent-stage/workflow-print-run-id-at-admission.md"],
    ],
  ])("no-test-impact diff (%s) skips tests", (_label, paths) => {
    expect(resolveCiTestScope(paths, true)).toEqual([]);
  });

  test("no-test-impact + code-path diff scopes on code paths only", () => {
    expect(resolveCiTestScope(["v1/docs/run-loop.md", "v2/src/foo.ts"], true)).toEqual([
      "test:v2",
      "test:integration:v2",
    ]);
  });

  test("root-tooling + no-test-impact diff still runs full suite", () => {
    expect(resolveCiTestScope(["package.json", "v1/docs/run-loop.md"], true)).toBe("full");
  });

  test("ci-test-scope classifier-only diff skips aggregate tests", () => {
    expect(resolveCiTestScope(["scripts/ci-test-scope.ts", "scripts/ci-test-scope.test.ts"], true)).toEqual([]);
  });

  test("ci-test-scope classifier mixed with intent staging skips aggregate tests", () => {
    expect(
      resolveCiTestScope(
        [
          "scripts/ci-test-scope.ts",
          ".jarvis-intent-review-verdict.md",
          ".jarvis-intent-stage/workflow-print-run-id-at-admission.md",
        ],
        true,
      ),
    ).toEqual([]);
  });

  test("other scripts/ changes still run full suite", () => {
    expect(resolveCiTestScope(["scripts/ready.ts"], true)).toBe("full");
    expect(resolveCiTestScope(["scripts/ci-test-scope.ts", "scripts/ready.ts"], true)).toBe("full");
  });

  test("test/ (harness) change runs shared test slices", () => {
    expect(resolveCiTestScope(["test/setup-fake-agents.ts"], true)).toEqual(["test:shared", "test:integration:shared"]);
  });

  test("empty changed-path input runs full suite", () => {
    expect(resolveCiTestScope([], true)).toBe("full");
  });
});
