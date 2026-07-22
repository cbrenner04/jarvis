import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AsyncSubprocessError } from "../../../shared/subprocess.ts";
import { COVERAGE_RUN_TIMEOUT_MS, reportUncoveredChangedLines } from "./uncovered-changed-lines.ts";

const lcovFixture = readFileSync("v2/src/execution/fixtures/lcov-real-bun-test-coverage.txt", "utf-8");
const input = { worktreePath: "/test/path", runBase: "main" };
const noop = async () => {};

const addConstDiff = `diff --git a/src/test.ts b/src/test.ts
index 1234567..abcdefg 100644
--- a/src/test.ts
+++ b/src/test.ts
@@ -1,1 +1,2 @@
+const x = 1;
 export function foo() {}`;

async function reportWith(
  gitDiff: string,
  seams: Partial<NonNullable<Parameters<typeof reportUncoveredChangedLines>[1]>> = {},
) {
  return reportUncoveredChangedLines(input, {
    gitDiff: async () => gitDiff,
    untrackedFiles: async () => [],
    runCoverageTests: async () => lcovFixture,
    readFile: async () => lcovFixture,
    cleanupCoverage: noop,
    ...seams,
  });
}

describe("uncovered-changed-lines", () => {
  it("parses lcov correctly", async () => {
    const lcov = `TN:
SF:v2/src/test.ts
DA:1,10
DA:2,0
end_of_record`;

    const result = await reportWith(
      `diff --git a/v2/src/test.ts b/v2/src/test.ts
index 1234567..abcdefg 100644
--- a/v2/src/test.ts
+++ b/v2/src/test.ts
@@ -1 +1,2 @@
+// covered line
 export function test() {}`,
      { runCoverageTests: async () => "output", readFile: async () => lcov },
    );

    expect(result.sites).toHaveLength(0);
  });

  it("reports changed production code lines with no test execution", async () => {
    const diffWithAddedCode = `diff --git a/src/test.ts b/src/test.ts
index 1234567..abcdefg 100644
--- a/src/test.ts
+++ b/src/test.ts
@@ -1,3 +1,4 @@
 export function safe(x: any) {
+  if (!x) return "new";
   return x;
 }`;

    const result = await reportWith(diffWithAddedCode);

    expect(result.sites).toHaveLength(1);
    expect(result.sites[0]).toEqual({ file: "src/test.ts", line: 2 });
    expect(result.text).toContain("src/test.ts:2");
    expect(result.text).toContain("mutation verifier");
  });

  it("omits changed production lines the coverage data records as executed", async () => {
    const diff = `diff --git a/v2/src/test.ts b/v2/src/test.ts
index 1234567..abcdefg 100644
--- a/v2/src/test.ts
+++ b/v2/src/test.ts
@@ -1 +1,2 @@
+// covered line
 export function test() {}`;

    const lcov = `TN:
SF:v2/src/test.ts
DA:1,10
DA:2,0
end_of_record`;

    const result = await reportWith(diff, { runCoverageTests: async () => "output", readFile: async () => lcov });

    expect(result.sites.filter((s) => s.file === "v2/src/test.ts" && s.line === 1)).toHaveLength(0);
  });

  it("reports all added lines when a changed code file has no coverage record", async () => {
    const diffWithNoCoverage = `diff --git a/new-module.ts b/new-module.ts
index 0000000..1234567 100644
--- /dev/null
+++ b/new-module.ts
@@ -0,0 +1,3 @@
+export function newFunc() {
+  return true;
+}`;

    const result = await reportWith(diffWithNoCoverage);

    expect(result.sites).toContainEqual({ file: "new-module.ts", line: 1 });
    expect(result.sites).toContainEqual({ file: "new-module.ts", line: 2 });
    expect(result.sites).toContainEqual({ file: "new-module.ts", line: 3 });
  });

  it.each([
    [
      "README.md",
      `diff --git a/README.md b/README.md
index 1234567..abcdefg 100644
--- a/README.md
+++ b/README.md
@@ -1,3 +1,3 @@
 # Title
-old content
+new content
`,
    ],
    [
      "config.json",
      `diff --git a/config.json b/config.json
index 1234567..abcdefg 100644
--- a/config.json
+++ b/config.json
@@ -1,3 +1,3 @@
 {
-  "old": true
+  "new": true
}`,
    ],
    [
      "prompts/test.md",
      `diff --git a/prompts/test.md b/prompts/test.md
index 1234567..abcdefg 100644
--- a/prompts/test.md
+++ b/prompts/test.md
@@ -1,3 +1,3 @@
 # Prompt
-old text
+new text
`,
    ],
  ])("produces no reported lines for changed non-code files (%s)", async (_label, diff) => {
    const result = await reportWith(diff);
    expect(result.sites).toHaveLength(0);
  });

  it("omits changed test file lines", async () => {
    const diff = `diff --git a/src/foo.test.ts b/src/foo.test.ts
index 1234567..abcdefg 100644
--- a/src/foo.test.ts
+++ b/src/foo.test.ts
@@ -1,2 +1,3 @@
 import { test } from "bun:test";
+test("new", () => {});
 test("old", () => {});`;

    const result = await reportWith(diff, {
      runCoverageTests: async () => "output",
      readFile: async () => "",
    });

    expect(result.sites).toHaveLength(0);
  });

  it("issues exactly one coverage invocation scoped to changed directories", async () => {
    let coverageInvokeCount = 0;
    let capturedDirs: string[] = [];

    const diff = `diff --git a/v2/src/execution/uncovered-changed-lines.ts b/v2/src/execution/uncovered-changed-lines.ts
index 1234567..abcdefg 100644
--- a/v2/src/execution/uncovered-changed-lines.ts
+++ b/v2/src/execution/uncovered-changed-lines.ts
@@ -1,1 +1,2 @@
+// new file
 export async function newFunc() {}`;

    await reportWith(diff, {
      runCoverageTests: async (_cwd, dirs) => {
        coverageInvokeCount++;
        capturedDirs = dirs;
        return lcovFixture;
      },
    });

    expect(coverageInvokeCount).toBe(1);
    expect(capturedDirs.length).toBeGreaterThan(0);
  });

  it("does not compute or emit coverage percentage or threshold", async () => {
    const diff = `diff --git a/src/test.ts b/src/test.ts
index 1234567..abcdefg 100644
--- a/src/test.ts
+++ b/src/test.ts
@@ -1,2 +1,3 @@
 export function foo() {
+  if (true) return;
   return true;
}`;

    const result = await reportWith(diff);
    expect(result.text).not.toContain("%");
    expect(result.text).not.toMatch(/\d+\/\d+/);
  });

  it("states that executed lines may still be unasserted and verifier decides adequacy", async () => {
    const result = await reportWith(addConstDiff);
    expect(result.text).toContain("executed");
    expect(result.text).toContain("unasserted");
    expect(result.text).toContain("mutation verifier");
  });

  it("returns empty report when coverage run fails", async () => {
    const result = await reportWith(addConstDiff, {
      runCoverageTests: async () => {
        throw new Error("Coverage failed");
      },
    });

    expect(result.sites).toHaveLength(0);
    expect(result.text).toBe("");
  });

  it("does not throw when coverage run fails", async () => {
    await expect(
      reportWith(addConstDiff, {
        runCoverageTests: async () => {
          throw new Error("Coverage failed");
        },
      }),
    ).resolves.toEqual(expect.objectContaining({ sites: [], text: "" }));
  });

  it("returns empty report when coverage output is empty", async () => {
    const result = await reportWith(addConstDiff, { runCoverageTests: async () => "" });

    expect(result.sites).toHaveLength(0);
    expect(result.text).toBe("");
  });

  it("returns empty report when coverage subprocess times out", async () => {
    const result = await reportWith(addConstDiff, {
      runCoverageTests: async () => {
        throw new AsyncSubprocessError("timed out", undefined, "", "", "ETIMEDOUT");
      },
    });

    expect(result.sites).toHaveLength(0);
    expect(result.text).toBe("");
  });

  it("returns empty report when lcov file cannot be read", async () => {
    const result = await reportWith(addConstDiff, {
      runCoverageTests: async () => "output",
      readFile: async () => {
        throw new Error("Cannot read lcov");
      },
    });

    expect(result.sites).toHaveLength(0);
    expect(result.text).toBe("");
  });

  it("reads lcov before cleanup", async () => {
    const order: string[] = [];

    await reportWith(addConstDiff, {
      runCoverageTests: async () => "output",
      readFile: async (path) => {
        order.push("read");
        expect(path).toBe(join(input.worktreePath, ".scratch/coverage/lcov.info"));
        return lcovFixture;
      },
      cleanupCoverage: async () => {
        order.push("cleanup");
      },
    });

    expect(order).toEqual(["read", "cleanup"]);
  });

  it("pins cleanup.ts fallback branch detection (DA hit count 0 vs siblings non-zero)", async () => {
    const diff = `diff --git a/src/cleanup.ts b/src/cleanup.ts
index 1234567..abcdefg 100644
--- a/src/cleanup.ts
+++ b/src/cleanup.ts
@@ -159,4 +159,5 @@
   try {
     return await cleanup();
   } catch {
+    if (true) throw new Error("unreachable");
   }`;

    const customLcov = `TN:
SF:src/cleanup.ts
DA:159,10
DA:160,10
DA:161,10
DA:162,0
DA:163,10
end_of_record`;

    const result = await reportWith(diff, { runCoverageTests: async () => "output", readFile: async () => customLcov });

    expect(result.sites).toContainEqual({ file: "src/cleanup.ts", line: 162 });
  });

  it("parses lcov format correctly from real bun test output fixture", async () => {
    const diff = `diff --git a/scripts/ci-test-scope.ts b/scripts/ci-test-scope.ts
index 1234567..abcdefg 100644
--- a/scripts/ci-test-scope.ts
+++ b/scripts/ci-test-scope.ts
@@ -10,1 +10,2 @@
 export function classifyChangedPaths(paths: string[]): ScopedTests {
+  if (true) return "full";
   if (paths.length === 0) {`;

    const result = await reportWith(diff);

    // From the fixture, line 11 in scripts/ci-test-scope.ts has DA:11,23 (hit count 23)
    // So line 11 should be covered and not reported
    // We expect to report our added line (line 11 according to diff) as uncovered
    expect(result.sites.filter((s) => s.file === "scripts/ci-test-scope.ts" && s.line === 11)).toHaveLength(0);
  });

  it("does not report non-code file changes even when lcov has no coverage record", async () => {
    const diffWithJson = `diff --git a/data.json b/data.json
index 1234567..abcdefg 100644
--- a/data.json
+++ b/data.json
@@ -1 +1 @@
-{}
+{"new": true}`;

    const result = await reportWith(diffWithJson, { runCoverageTests: async () => "output", readFile: async () => "" });

    expect(result.sites).toHaveLength(0);
  });

  it("does not report covered changed lines", async () => {
    const diff = `diff --git a/src/test.ts b/src/test.ts
index 1234567..abcdefg 100644
--- a/src/test.ts
+++ b/src/test.ts
@@ -1,2 +1,3 @@
 export function foo() {
+  if (true) return;
   return true;
 }`;

    const result = await reportWith(diff, {
      runCoverageTests: async () => "output",
      readFile: async () => `TN:
SF:src/test.ts
DA:1,1
DA:2,1
DA:3,1
end_of_record`,
    });

    expect(result.sites.filter((s) => s.file === "src/test.ts" && s.line === 2)).toHaveLength(0);
  });

  it("returns empty report for empty diff", async () => {
    const result = await reportWith("");

    expect(result.sites).toHaveLength(0);
    expect(result.text).toBe("");
  });

  it("reports all lines from untracked production code files", async () => {
    const result = await reportWith("", {
      untrackedFiles: async () => ["src/new-untracked.ts"],
      readSourceFile: async () => "export function newFunc() {\n  return true;\n}",
      runCoverageTests: async () => "output",
      readFile: async () => `TN:
SF:src/new-untracked.ts
DA:1,0
DA:2,0
DA:3,0
end_of_record`,
    });

    expect(result.sites).toContainEqual({ file: "src/new-untracked.ts", line: 1 });
    expect(result.sites).toContainEqual({ file: "src/new-untracked.ts", line: 2 });
    expect(result.sites).toContainEqual({ file: "src/new-untracked.ts", line: 3 });
  });

  it("includes untracked production files in coverage scope", async () => {
    const diff = `diff --git a/src/existing.ts b/src/existing.ts
index 1234567..abcdefg 100644
--- a/src/existing.ts
+++ b/src/existing.ts
@@ -1,1 +1,2 @@
+const x = 1;
 export function foo() {}`;

    const result = await reportWith(diff, {
      untrackedFiles: async () => ["src/new-untracked.ts"],
      readSourceFile: async () => "export const y = 2;",
      runCoverageTests: async () => "output",
      readFile: async () => `TN:
SF:src/existing.ts
DA:1,0
DA:2,0
end_of_record
TN:
SF:src/new-untracked.ts
DA:1,0
end_of_record`,
    });

    expect(result.sites).toContainEqual({ file: "src/existing.ts", line: 1 });
    expect(result.sites).toContainEqual({ file: "src/new-untracked.ts", line: 1 });
  });

  it("sorts output by file then line number", async () => {
    const diff = `diff --git a/b.ts b/b.ts
index 1234567..abcdefg 100644
--- a/b.ts
+++ b/b.ts
@@ -1,3 +1,3 @@
+x
+y
+z
diff --git a/a.ts b/a.ts
index 1234567..abcdefg 100644
--- a/a.ts
+++ b/a.ts
@@ -1,3 +1,3 @@
+c
+b
+a`;

    const result = await reportWith(diff, {
      runCoverageTests: async () => "output",
      readFile: async () => `TN:
SF:a.ts
DA:1,0
DA:2,0
DA:3,0
end_of_record
TN:
SF:b.ts
DA:1,0
DA:2,0
DA:3,0
end_of_record`,
    });

    expect(result.sites).toEqual([
      { file: "a.ts", line: 1 },
      { file: "a.ts", line: 2 },
      { file: "a.ts", line: 3 },
      { file: "b.ts", line: 1 },
      { file: "b.ts", line: 2 },
      { file: "b.ts", line: 3 },
    ]);
  });

  it("exports a bounded coverage subprocess timeout", () => {
    expect(COVERAGE_RUN_TIMEOUT_MS).toBeGreaterThan(0);
    expect(COVERAGE_RUN_TIMEOUT_MS).toBeLessThan(600_000);
  });
});
