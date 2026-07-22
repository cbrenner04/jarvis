import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  coverageDirectoriesFromScope,
  parseLcov,
  reportUncoveredChangedLines,
} from "./uncovered-changed-lines.ts";

const FIXTURE_LCOV = readFileSync(
  join(import.meta.dir, "fixtures", "uncovered-changed-lines-coverage.lcov"),
  "utf-8",
);

const DIFF_WITH_ADDED_LINES = `diff --git a/v2/src/execution/cleanup.ts b/v2/src/execution/cleanup.ts
index 1234567..abcdefg 100644
--- a/v2/src/execution/cleanup.ts
+++ b/v2/src/execution/cleanup.ts
@@ -158,6 +158,11 @@ async function cleanupResources() {
   const items = await listItems();
   for (const item of items) {
     await deleteItem(item);
+    logProgress("Deleted item");
+    if (item.isImportant) {
+      notify("Important item deleted");
+      backup(item);
+    }
   }
 }
`;

const DIFF_WITH_NON_CODE = `diff --git a/README.md b/README.md
index 1234567..abcdefg 100644
--- a/README.md
+++ b/README.md
@@ -1,3 +1,5 @@
 # My Project

 This is a project.
+
+New documentation line.
diff --git a/config.json b/config.json
index 1234567..abcdefg 100644
--- a/config.json
+++ b/config.json
@@ -1,3 +1,5 @@
 {
-  "name": "project"
+  "name": "project",
+  "version": "1.0"
 }
`;

function lcov(file: string, hits: Array<[number, number]>): string {
  const da = hits.map(([line, count]) => `DA:${line},${count}`).join("\n");
  const lh = hits.filter(([, count]) => count > 0).length;
  return `TN:test\nSF:${file}\n${da}\nLH:${lh}\nLF:${hits.length}\nend_of_record\n`;
}

type ReportSeams = NonNullable<Parameters<typeof reportUncoveredChangedLines>[2]>;

async function report(seams: ReportSeams = {}) {
  return reportUncoveredChangedLines("/test", "main", {
    untrackedFiles: async () => [],
    ...seams,
  });
}

describe("uncovered-changed-lines", () => {
  it("reports uncovered added lines in changed code files", async () => {
    const result = await report({
      gitDiff: async () => DIFF_WITH_ADDED_LINES,
      runCoverage: async () => FIXTURE_LCOV,
    });

    expect(result.uncoveredSites).toContainEqual({ file: "v2/src/execution/cleanup.ts", line: 161 });
    expect(result.reportText).toContain("v2/src/execution/cleanup.ts:161");
    expect(result.reportText).toContain("executed ≠ asserted");
    expect(result.reportText).toContain("mutation verifier");
  });

  it("excludes covered added lines from report", async () => {
    const result = await report({
      gitDiff: async () => `diff --git a/v2/src/execution/test.ts b/v2/src/execution/test.ts
index 1234567..abcdefg 100644
--- a/v2/src/execution/test.ts
+++ b/v2/src/execution/test.ts
@@ -8,6 +8,9 @@ export function getValue() {
   if (!value) {
     return null;
   }
+  console.log("Value retrieved");
+  const result = processValue(value);
+  return result;
 }
`,
      runCoverage: async () =>
        lcov("v2/src/execution/test.ts", [
          [1, 1],
          [2, 1],
          [8, 1],
          [9, 1],
          [10, 1],
          [11, 1],
          [12, 1],
          [13, 1],
        ]),
    });

    expect(result.uncoveredSites).toHaveLength(0);
  });

  it("reports all added lines for files with no coverage record", async () => {
    const result = await report({
      gitDiff: async () => `diff --git a/v2/src/execution/missing.ts b/v2/src/execution/missing.ts
new file mode 100644
index 0000000..abcdefg 100644
--- /dev/null
+++ b/v2/src/execution/missing.ts
@@ -0,0 +1,5 @@
+export function newFeature() {
+  console.log("New feature");
+  return 42;
+}
`,
      runCoverage: async () => lcov("v2/src/execution/other.ts", [[1, 1]]),
    });

    expect(result.uncoveredSites).toHaveLength(4);
    expect(result.uncoveredSites).toContainEqual({ file: "v2/src/execution/missing.ts", line: 1 });
    expect(result.uncoveredSites).toContainEqual({ file: "v2/src/execution/missing.ts", line: 2 });
    expect(result.uncoveredSites).toContainEqual({ file: "v2/src/execution/missing.ts", line: 3 });
    expect(result.uncoveredSites).toContainEqual({ file: "v2/src/execution/missing.ts", line: 4 });
  });

  it("excludes non-code files from report", async () => {
    const result = await report({
      gitDiff: async () => DIFF_WITH_NON_CODE,
      runCoverage: async () => "",
    });

    expect(result.uncoveredSites).toHaveLength(0);
    expect(result.reportText).toContain("No changed code files");
  });

  it("issues exactly one scoped bun test --coverage invocation", async () => {
    let callCount = 0;
    let capturedScope: string[] = [];

    await report({
      gitDiff: async () => `diff --git a/v2/src/execution/foo.ts b/v2/src/execution/foo.ts
index 1234567..abcdefg 100644
--- a/v2/src/execution/foo.ts
+++ b/v2/src/execution/foo.ts
@@ -1,2 +1,3 @@
 export function foo() {
+  return 1;
 }
`,
      runCoverage: async (_cwd, scope) => {
        callCount += 1;
        capturedScope = scope;
        return FIXTURE_LCOV;
      },
    });

    expect(callCount).toBe(1);
    expect(capturedScope).toEqual(["./v2/"]);
  });

  it("fails soft when coverage run fails", async () => {
    const result = await report({
      gitDiff: async () => DIFF_WITH_ADDED_LINES,
      runCoverage: async () => {
        throw new Error("Coverage run failed");
      },
    });

    expect(result.uncoveredSites).toHaveLength(0);
    expect(result.reportText).toBe("");
  });

  it("fails soft when lcov output is unparseable", async () => {
    const result = await report({
      gitDiff: async () => DIFF_WITH_ADDED_LINES,
      runCoverage: async () => "invalid lcov content",
    });

    expect(result.uncoveredSites).toHaveLength(0);
    expect(result.reportText).toBe("");
  });

  it("returns empty report when no changed code", async () => {
    const result = await report({
      gitDiff: async () => "",
      runCoverage: async () => FIXTURE_LCOV,
    });

    expect(result.uncoveredSites).toHaveLength(0);
    expect(result.reportText).toContain("No changed production files");
  });

  it("formats report text correctly with executed ≠ asserted statement", async () => {
    const result = await report({
      gitDiff: async () => `diff --git a/v2/src/test.ts b/v2/src/test.ts
index 1234567..abcdefg 100644
--- a/v2/src/test.ts
+++ b/v2/src/test.ts
@@ -1,2 +1,3 @@
 export function test() {
+  const x = unreachable();
   return 1;
`,
      runCoverage: async () =>
        lcov("v2/src/test.ts", [
          [1, 1],
          [2, 0],
        ]),
    });

    expect(result.reportText).toMatch(/executed ≠ asserted/);
    expect(result.reportText).toMatch(/mutation verifier/);
    expect(result.reportText).toContain("v2/src/test.ts:2");
  });

  it("handles lcov with DA line for uncovered as zero hit count", async () => {
    const result = await report({
      gitDiff: async () => `diff --git a/v2/src/cleanup.ts b/v2/src/cleanup.ts
index 1234567..abcdefg 100644
--- a/v2/src/cleanup.ts
+++ b/v2/src/cleanup.ts
@@ -10,5 +10,6 @@ async function cleanupResources() {
   const items = await listItems();
   for (const item of items) {
     await deleteItem(item);
+    fallbackCleanup();
   }
 }
`,
      runCoverage: async () =>
        lcov("v2/src/cleanup.ts", [
          [10, 1],
          [11, 1],
          [12, 1],
          [13, 0],
        ]),
    });

    expect(result.uncoveredSites).toContainEqual({ file: "v2/src/cleanup.ts", line: 13 });
  });

  it("includes untracked production code files", async () => {
    const result = await report({
      gitDiff: async () => "",
      untrackedFiles: async () => ["v2/src/execution/new.ts"],
      readFile: async () => "export const value = 1;\n",
      runCoverage: async () => lcov("v2/src/execution/other.ts", [[1, 1]]),
    });

    expect(result.uncoveredSites).toContainEqual({ file: "v2/src/execution/new.ts", line: 1 });
  });
});

describe("coverageDirectoriesFromScope", () => {
  it("maps scoped test scripts to coverage directories", () => {
    expect(coverageDirectoriesFromScope(["test:v2", "test:integration:v2"])).toEqual(["./v2/"]);
    expect(coverageDirectoriesFromScope(["test:v1", "test:integration:v1"])).toEqual(["./v1/"]);
    expect(coverageDirectoriesFromScope(["test:shared", "test:integration:shared"])).toEqual([
      "./shared/",
      "./test/",
    ]);
    expect(coverageDirectoriesFromScope("full")).toEqual(["./v1/", "./v2/", "./shared/", "./test/"]);
  });
});

describe("parseLcov", () => {
  it("parses the checked-in bun coverage fixture", () => {
    const records = parseLcov(FIXTURE_LCOV);

    expect(records.has("v2/src/execution/cleanup.ts")).toBe(true);
    expect(records.get("v2/src/execution/cleanup.ts")?.get(161)).toBe(0);
    expect(records.get("v2/src/execution/cleanup.ts")?.get(162)).toBe(1);
  });
});

describe("diff parsing behavior", () => {
  it("parses cleanup.ts:161 shape - unreachable fallback branch", async () => {
    const result = await report({
      gitDiff: async () => `diff --git a/v2/src/execution/cleanup.ts b/v2/src/execution/cleanup.ts
index 1234567..abcdefg 100644
--- a/v2/src/execution/cleanup.ts
+++ b/v2/src/execution/cleanup.ts
@@ -155,6 +155,10 @@ async function cleanupResources() {
   try {
     await deleteItems();
   } catch (e) {
     handleError(e);
+    // Fallback for unhandled edge case
+    if (isFatalError(e)) {
+      throw e;
+    }
   }
 }
`,
      runCoverage: async () => FIXTURE_LCOV,
    });

    expect(result.uncoveredSites).toContainEqual({ file: "v2/src/execution/cleanup.ts", line: 161 });
  });
});

describe("guard inversion tests", () => {
  it("does not report non-code files when the code-path filter is active", async () => {
    const result = await report({
      gitDiff: async () => `diff --git a/README.md b/README.md
index 1234567..abcdefg 100644
--- a/README.md
+++ b/README.md
@@ -1,3 +1,4 @@
 # Project

 Description
+New line added
`,
      runCoverage: async () => "",
    });

    expect(result.uncoveredSites).toHaveLength(0);
  });

  it("does not report covered lines when the executed-line filter is active", async () => {
    const result = await report({
      gitDiff: async () => `diff --git a/v2/src/test.ts b/v2/src/test.ts
index 1234567..abcdefg 100644
--- a/v2/src/test.ts
+++ b/v2/src/test.ts
@@ -1,3 +1,3 @@
 export function getValue() {
-  return 0;
+  return 42;
`,
      runCoverage: async () =>
        lcov("v2/src/test.ts", [
          [1, 1],
          [2, 1],
        ]),
    });

    expect(result.uncoveredSites).toHaveLength(0);
  });

  it("does not throw on coverage failures when the fail-soft guard is active", async () => {
    const result = await report({
      gitDiff: async () => `diff --git a/v2/src/test.ts b/v2/src/test.ts
index 1234567..abcdefg 100644
--- a/v2/src/test.ts
+++ b/v2/src/test.ts
@@ -1,3 +1,3 @@
 export function getValue() {
-  return 0;
+  return 42;
`,
      runCoverage: async () => {
        throw new Error("Test error");
      },
    });

    expect(result.uncoveredSites).toHaveLength(0);
    expect(result.reportText).toBe("");
  });
});
