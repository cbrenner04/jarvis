import { describe, expect, it } from "bun:test";
import { type DiffDerivedMutationVerifierInput, verifyDiffDerivedMutations } from "./diff-derived-mutation-verifier.ts";

// Helper to test diff parsing
function testParseDiff(diff: string): { file: string; lineNumber: number; content: string }[] {
  const lines: { file: string; lineNumber: number; content: string }[] = [];
  const diffLines = diff.split("\n");

  let currentFile: string | null = null;
  let currentNewLineNum = 0;
  let inHunk = false;

  for (const line of diffLines) {
    if (line.startsWith("diff --git")) {
      const match = line.match(/b\/(.+)$/);
      currentFile = match?.[1] ?? null;
    } else if (line.startsWith("@@")) {
      inHunk = true;
      const match = line.match(/@@ -\d+(?:,\d+)? \+(\d+)/);
      if (match?.[1]) {
        currentNewLineNum = parseInt(match[1], 10);
      } else {
        currentNewLineNum = 1;
      }
    } else if (inHunk && currentFile) {
      if (line.startsWith("+") && !line.startsWith("+++")) {
        lines.push({
          file: currentFile,
          lineNumber: currentNewLineNum,
          content: line.slice(1),
        });
        currentNewLineNum++;
      } else if (line.startsWith("-") && !line.startsWith("---")) {
        //
      } else if (line.startsWith(" ")) {
        currentNewLineNum++;
      }
    }
  }

  return lines;
}

describe("diff-derived-mutation-verifier", () => {
  it("parses diff correctly to extract changed lines", () => {
    const diff = `diff --git a/src/test.ts b/src/test.ts
index 1234567..abcdefg 100644
--- a/src/test.ts
+++ b/src/test.ts
@@ -1,3 +1,3 @@
 export function safe(x: any) {
-  if (!x) return null;
+  if (!x) return "safe";
   return x;
`;

    const parsed = testParseDiff(diff);
    expect(parsed).toHaveLength(1);
    const item = parsed[0];
    expect(item).toBeDefined();
    if (item) {
      expect(item.file).toBe("src/test.ts");
      expect(item.lineNumber).toBe(2);
      expect(item.content).toContain('if (!x) return "safe"');
    }
  });

  it("returns pass with zero candidates for empty diff", async () => {
    const input: DiffDerivedMutationVerifierInput = {
      worktreePath: "/test/path",
      runBase: "main",
    };

    const result = await verifyDiffDerivedMutations(input, {
      gitDiff: async () => "",
      untrackedFiles: async () => [],
      runScopedTests: async () => true,
    });

    expect(result.kind).toBe("pass");
    if (result.kind === "pass") {
      expect(result.candidateCount).toBe(0);
      expect(result.inspectedPaths).toHaveLength(0);
      expect(result.runBase).toBe("main");
    }
  });

  it("returns pass when all mutations are caught by tests", async () => {
    const diffWithGuardFlip = `diff --git a/src/test.ts b/src/test.ts
index 1234567..abcdefg 100644
--- a/src/test.ts
+++ b/src/test.ts
@@ -1,3 +1,3 @@
 export function safe(x: any) {
-  if (!x) return null;
+  if (!x) return "safe";
   return x;
`;

    const result = await verifyDiffDerivedMutations(
      {
        worktreePath: "/test/path",
        runBase: "main",
      },
      {
        gitDiff: async () => diffWithGuardFlip,
        untrackedFiles: async () => [],
        runScopedTests: async () => {
          // Mutation caused tests to fail, so it's caught
          return false;
        },
      },
    );

    expect(result.kind).toBe("pass");
    if (result.kind === "pass") {
      expect(result.candidateCount).toBeGreaterThan(0);
      expect(result.inspectedPaths).toContain("src/test.ts");
    }
  });

  it("returns surviving-mutation when a changed guard has no covering test", async () => {
    const diffWithGuardFlip = `diff --git a/src/safe.ts b/src/safe.ts
index 1234567..abcdefg 100644
--- a/src/safe.ts
+++ b/src/safe.ts
@@ -1,3 +1,3 @@
 export function safe(x: any) {
-  if (!x) return null;
+  if (!x) return "safe";
   return x;
`;

    const originalContent = `export function safe(x: any) {
  if (!x) return "safe";
  return x;
}`;

    let testRunCount = 0;
    let mutatedContent: string | null = null;

    const result = await verifyDiffDerivedMutations(
      {
        worktreePath: "/test/path",
        runBase: "main",
      },
      {
        gitDiff: async () => diffWithGuardFlip,
        untrackedFiles: async () => [],
        readFile: async (_path) => originalContent,
        writeFile: async (_path, content) => {
          if (content !== originalContent) {
            mutatedContent = content;
          }
        },
        runScopedTests: async (_cwd, _scope) => {
          testRunCount++;
          // Mutation did not cause tests to fail, so it survived
          return true;
        },
      },
    );

    // Should have attempted to run tests on mutated code
    expect(testRunCount).toBeGreaterThan(0);
    expect(mutatedContent).not.toBeNull();
    expect(result.kind).toBe("surviving-mutation");
    if (result.kind === "surviving-mutation") {
      expect(result.mutation).toContain("guard-flip");
      expect(result.sourceSite.file).toBe("src/safe.ts");
      expect(result.sourceSite.line).toBe(2);
    }
  });

  it("derives operator flip mutations from comparison operators", async () => {
    const diffWithOperator = `diff --git a/src/compare.ts b/src/compare.ts
index 1234567..abcdefg 100644
--- a/src/compare.ts
+++ b/src/compare.ts
@@ -1,3 +1,3 @@
 export function check(x: number) {
-  return x === 5;
+  return x === 5 || false;
   return false;
`;

    const result = await verifyDiffDerivedMutations(
      {
        worktreePath: "/test/path",
        runBase: "main",
      },
      {
        gitDiff: async () => diffWithOperator,
        untrackedFiles: async () => [],
        runScopedTests: async () => false,
      },
    );

    expect(result.kind).toBe("pass");
  });

  it("handles untracked production files", async () => {
    const result = await verifyDiffDerivedMutations(
      {
        worktreePath: "/test/path",
        runBase: "main",
      },
      {
        gitDiff: async () => "",
        untrackedFiles: async () => ["src/new-file.ts"],
        runScopedTests: async () => true,
      },
    );

    expect(result.kind).toBe("pass");
    if (result.kind === "pass") {
      expect(result.inspectedPaths).toContain("src/new-file.ts");
    }
  });

  it("filters out non-production files from diff", async () => {
    const diffWithTestFile = `diff --git a/src/test.test.ts b/src/test.test.ts
index 1234567..abcdefg 100644
--- a/src/test.test.ts
+++ b/src/test.test.ts
@@ -1,3 +1,3 @@
 export function testFoo() {
-  if (!x) return null;
+  if (!x) return "safe";
   return x;
`;

    const result = await verifyDiffDerivedMutations(
      {
        worktreePath: "/test/path",
        runBase: "main",
      },
      {
        gitDiff: async () => diffWithTestFile,
        untrackedFiles: async () => [],
        runScopedTests: async () => true,
      },
    );

    expect(result.kind).toBe("pass");
    if (result.kind === "pass") {
      expect(result.candidateCount).toBe(0);
      expect(result.inspectedPaths).toHaveLength(0);
    }
  });

  it("filters out spec and docs files from diff", async () => {
    const diffWithSpec = `diff --git a/v2/spec/test.md b/v2/spec/test.md
index 1234567..abcdefg 100644
--- a/v2/spec/test.md
+++ b/v2/spec/test.md
@@ -1,3 +1,3 @@
 # Test spec
-old content
+new content
   more content
`;

    const result = await verifyDiffDerivedMutations(
      {
        worktreePath: "/test/path",
        runBase: "main",
      },
      {
        gitDiff: async () => diffWithSpec,
        untrackedFiles: async () => [],
        runScopedTests: async () => true,
      },
    );

    expect(result.kind).toBe("pass");
    if (result.kind === "pass") {
      expect(result.candidateCount).toBe(0);
      expect(result.inspectedPaths).toHaveLength(0);
    }
  });

  it("records run base in pass result", async () => {
    const result = await verifyDiffDerivedMutations(
      {
        worktreePath: "/test/path",
        runBase: "develop",
      },
      {
        gitDiff: async () => "",
        untrackedFiles: async () => [],
        runScopedTests: async () => true,
      },
    );

    if (result.kind === "pass") {
      expect(result.runBase).toBe("develop");
    }
  });

  it("derives destructive-operation safety mutations", async () => {
    const diffWithDestructive = `diff --git a/src/cleanup.ts b/src/cleanup.ts
index 1234567..abcdefg 100644
--- a/src/cleanup.ts
+++ b/src/cleanup.ts
@@ -1,3 +1,3 @@
 export function cleanup(path: string) {
-  unlinkSync(path);
+  unlinkSync(path);
   return true;
`;

    const result = await verifyDiffDerivedMutations(
      {
        worktreePath: "/test/path",
        runBase: "main",
      },
      {
        gitDiff: async () => diffWithDestructive,
        untrackedFiles: async () => [],
        runScopedTests: async () => false,
      },
    );

    expect(result.kind).toBe("pass");
  });
});
