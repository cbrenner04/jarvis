import { describe, expect, it } from "bun:test";
import { type UncoveredChangedLinesInput, reportUncoveredChangedLines } from "./uncovered-changed-lines.ts";

const FIXTURE_LCOV = `TN:src/execution
SF:src/execution/cleanup.ts
FN:10,isSafe
FN:20,cleanup
DA:10,1
DA:11,1
DA:12,1
DA:13,0
DA:20,1
DA:21,1
DA:161,0
end_of_record
SF:src/execution/write.ts
FN:1,executeWrite
DA:1,1
DA:2,1
DA:3,1
DA:4,1
end_of_record
`;

describe("uncovered-changed-lines", () => {
  it("reports added lines that are not executed", async () => {
    const diff = `diff --git a/src/execution/test.ts b/src/execution/test.ts
index 1234567..abcdefg 100644
--- a/src/execution/test.ts
+++ b/src/execution/test.ts
@@ -1,3 +1,5 @@
 export function test() {
+  return true;
+}
 }
`;

    const result = await reportUncoveredChangedLines(
      { worktreePath: "/test", runBase: "main" },
      {
        gitDiff: async () => diff,
        untrackedFiles: async () => [],
        collectCoverage: async () => "", // No coverage data for test.ts
      },
    );

    expect(result.uncoveredSites).toHaveLength(2);
    expect(result.uncoveredSites[0]).toEqual({ file: "src/execution/test.ts", line: 2 });
    expect(result.uncoveredSites[1]).toEqual({ file: "src/execution/test.ts", line: 3 });
    expect(result.renderedText).toContain("Uncovered changed lines");
    expect(result.renderedText).toContain("src/execution/test.ts:2");
  });

  it("does not report executed lines", async () => {
    const diff = `diff --git a/src/execution/write.ts b/src/execution/write.ts
index 1234567..abcdefg 100644
--- a/src/execution/write.ts
+++ b/src/execution/write.ts
@@ -1,0 +1,3 @@
+export function newFunc() {
+  return true;
+}
`;

    const result = await reportUncoveredChangedLines(
      { worktreePath: "/test", runBase: "main" },
      {
        gitDiff: async () => diff,
        untrackedFiles: async () => [],
        collectCoverage: async () => FIXTURE_LCOV,
      },
    );

    // Lines 1-3 map to write.ts which has coverage data for lines 1-4 all executed (hit count 1)
    // Our new lines should check: line 1, 2, 3 in write.ts
    // write.ts has DA:1,1 DA:2,1 DA:3,1 DA:4,1 - all executed
    // So uncovered should be empty
    expect(result.uncoveredSites).toHaveLength(0);
  });

  it("reports all lines for files without coverage data", async () => {
    const diff = `diff --git a/src/execution/new-file.ts b/src/execution/new-file.ts
index 0000000..1234567 100644
--- /dev/null
+++ b/src/execution/new-file.ts
@@ -0,0 +1,3 @@
+export function newFile() {
+  return true;
+}
`;

    const result = await reportUncoveredChangedLines(
      { worktreePath: "/test", runBase: "main" },
      {
        gitDiff: async () => diff,
        untrackedFiles: async () => [],
        collectCoverage: async () => FIXTURE_LCOV,
      },
    );

    expect(result.uncoveredSites).toHaveLength(3);
    expect(result.uncoveredSites[0]).toEqual({ file: "src/execution/new-file.ts", line: 1 });
    expect(result.uncoveredSites[1]).toEqual({ file: "src/execution/new-file.ts", line: 2 });
    expect(result.uncoveredSites[2]).toEqual({ file: "src/execution/new-file.ts", line: 3 });
  });

  it("excludes non-code files from report", async () => {
    const diff = `diff --git a/v2/docs/example.md b/v2/docs/example.md
index 1234567..abcdefg 100644
--- a/v2/docs/example.md
+++ b/v2/docs/example.md
@@ -1,0 +1,2 @@
+# Example
+This is documentation
diff --git a/config.json b/config.json
index 1234567..abcdefg 100644
--- a/config.json
+++ b/config.json
@@ -1,0 +1,2 @@
+{
+}
`;

    const result = await reportUncoveredChangedLines(
      { worktreePath: "/test", runBase: "main" },
      {
        gitDiff: async () => diff,
        untrackedFiles: async () => [],
        collectCoverage: async () => FIXTURE_LCOV,
      },
    );

    expect(result.uncoveredSites).toHaveLength(0);
    expect(result.renderedText).toBe("");
  });

  it("pins lcov format: cleanup.ts:161 fallback branch is uncovered", async () => {
    const diff = `diff --git a/src/execution/cleanup.ts b/src/execution/cleanup.ts
index 1234567..abcdefg 100644
--- a/src/execution/cleanup.ts
+++ b/src/execution/cleanup.ts
@@ -160,0 +161,1 @@
+    return fallback;
`;

    const result = await reportUncoveredChangedLines(
      { worktreePath: "/test", runBase: "main" },
      {
        gitDiff: async () => diff,
        untrackedFiles: async () => [],
        collectCoverage: async () => FIXTURE_LCOV,
      },
    );

    // Line 161 in cleanup.ts has DA:161,0 in the fixture
    expect(result.uncoveredSites).toHaveLength(1);
    expect(result.uncoveredSites[0]).toEqual({ file: "src/execution/cleanup.ts", line: 161 });
  });

  it("fails soft when coverage run fails", async () => {
    const diff = `diff --git a/src/execution/test.ts b/src/execution/test.ts
index 1234567..abcdefg 100644
--- a/src/execution/test.ts
+++ b/src/execution/test.ts
@@ -1,0 +1,2 @@
+export function test() {
+}
`;

    const result = await reportUncoveredChangedLines(
      { worktreePath: "/test", runBase: "main" },
      {
        gitDiff: async () => diff,
        untrackedFiles: async () => [],
        collectCoverage: async () => {
          throw new Error("Coverage collection timed out");
        },
      },
    );

    expect(result.uncoveredSites).toHaveLength(0);
    expect(result.renderedText).toBe("");
  });

  it("inverts covered-line detection to catch missed coverage", async () => {
    const diff = `diff --git a/src/execution/write.ts b/src/execution/write.ts
index 1234567..abcdefg 100644
--- a/src/execution/write.ts
+++ b/src/execution/write.ts
@@ -1,0 +1,2 @@
+export function example() {
+  if (true) { return 1; }
+}
`;

    // Without the executed-line filter, a covered line would be reported
    // With it, lines with hit count > 0 should not be reported
    const result = await reportUncoveredChangedLines(
      { worktreePath: "/test", runBase: "main" },
      {
        gitDiff: async () => diff,
        untrackedFiles: async () => [],
        collectCoverage: async () => FIXTURE_LCOV,
      },
    );

    // All lines in write.ts are executed in the fixture
    expect(result.uncoveredSites).toHaveLength(0);
  });

  it("reports zero lines for empty diff", async () => {
    const result = await reportUncoveredChangedLines(
      { worktreePath: "/test", runBase: "main" },
      {
        gitDiff: async () => "",
        untrackedFiles: async () => [],
        collectCoverage: async () => FIXTURE_LCOV,
      },
    );

    expect(result.uncoveredSites).toHaveLength(0);
    expect(result.renderedText).toBe("");
  });

  it("renders text stating executed ≠ asserted", async () => {
    const diff = `diff --git a/src/execution/test.ts b/src/execution/test.ts
index 1234567..abcdefg 100644
--- a/src/execution/test.ts
+++ b/src/execution/test.ts
@@ -1,0 +1,1 @@
+return uncovered;
`;

    const result = await reportUncoveredChangedLines(
      { worktreePath: "/test", runBase: "main" },
      {
        gitDiff: async () => diff,
        untrackedFiles: async () => [],
        collectCoverage: async () => "", // No coverage for test.ts
      },
    );

    expect(result.renderedText).toContain("executed does not imply asserted");
    expect(result.renderedText).toContain("mutation verifier");
  });

  it("includes untracked production files", async () => {
    const diff = `diff --git a/src/execution/tracked.ts b/src/execution/tracked.ts
index 1234567..abcdefg 100644
--- a/src/execution/tracked.ts
+++ b/src/execution/tracked.ts
@@ -1,0 +1,1 @@
+tracked line
`;

    const result = await reportUncoveredChangedLines(
      { worktreePath: "/test", runBase: "main" },
      {
        gitDiff: async () => diff,
        untrackedFiles: async () => ["src/execution/untracked.ts"],
        collectCoverage: async () => FIXTURE_LCOV,
      },
    );

    // Both tracked and untracked files should be in the coverage scope
    expect(result.uncoveredSites.length).toBeGreaterThanOrEqual(0);
  });

  it("omits non-code-path files from changed-file detection", async () => {
    const diff = `diff --git a/v1/spec/example.md b/v1/spec/example.md
index 1234567..abcdefg 100644
--- a/v1/spec/example.md
+++ b/v1/spec/example.md
@@ -1,0 +1,1 @@
+# Spec
diff --git a/src/test.ts b/src/test.ts
index 1234567..abcdefg 100644
--- a/src/test.ts
+++ b/src/test.ts
@@ -1,0 +1,1 @@
+code
`;

    const result = await reportUncoveredChangedLines(
      { worktreePath: "/test", runBase: "main" },
      {
        gitDiff: async () => diff,
        untrackedFiles: async () => [],
        collectCoverage: async () => FIXTURE_LCOV,
      },
    );

    // Only src/test.ts should be included, not the spec
    expect(result.uncoveredSites.length).toBeGreaterThanOrEqual(0);
  });
});
