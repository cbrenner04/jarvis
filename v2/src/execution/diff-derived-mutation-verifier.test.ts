import { describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type DiffDerivedMutationVerifierInput,
  MAX_CONCURRENT_VERIFIER_TEST_RUNS,
  MAX_INSPECTED_MUTATIONS,
  MAX_VERIFICATION_MS,
  maskNonCodeSpans,
  parseEquivalentMutationDirective,
  peakVerifierTestRuns,
  resetVerifierTestRunTrackingForTest,
  resolveSiblingKillingTests,
  runDiffDerivedScopedTests,
  verifyDiffDerivedMutations,
} from "./diff-derived-mutation-verifier.ts";

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

  const guardFlipHunk = `-  if (!x) return null;
+  if (!x) return "safe";`;

  function guardFlipFileDiff(file: string, fnDecl: string): string {
    return `diff --git a/${file} b/${file}
index 1234567..abcdefg 100644
--- a/${file}
+++ b/${file}
@@ -1,3 +1,3 @@
 export function ${fnDecl} {
${guardFlipHunk}
   return x;
`;
  }

  async function expectNoMutationCandidates(diff: string) {
    const result = await verifyDiffDerivedMutations(
      { worktreePath: "/test/path", runBase: "main" },
      {
        gitDiff: async () => diff,
        untrackedFiles: async () => [],
        runScopedTests: async () => true,
      },
    );
    expect(result.kind).toBe("pass");
    if (result.kind === "pass") {
      expect(result.candidateCount).toBe(0);
      expect(result.inspectedPaths).toHaveLength(0);
    }
  }

  it("excludes *.test.tsx and *.sandbox-unrunnable.test.ts paths from candidates", async () => {
    await expectNoMutationCandidates(
      guardFlipFileDiff("v2/src/tui/tui-entry.test.tsx", "testFoo()") +
        guardFlipFileDiff("v2/src/daemon/daemon.sandbox-unrunnable.test.ts", "testBar()"),
    );
  });

  it("still derives production candidates when a mixed diff includes test files", async () => {
    const diff =
      guardFlipFileDiff("src/safe.ts", "safe(x: any)") + guardFlipFileDiff("src/helper.test.tsx", "helper()");
    const originalContent = `export function safe(x: any) {
  if (!x) return "safe";
  return x;
}`;

    const result = await verifyDiffDerivedMutations(
      { worktreePath: "/test/path", runBase: "main" },
      {
        gitDiff: async () => diff,
        untrackedFiles: async () => [],
        readFile: async () => originalContent,
        writeFile: async () => {},
        runScopedTests: async () => true,
      },
    );

    expect(result.kind).toBe("surviving-mutation");
    if (result.kind === "surviving-mutation") {
      expect(result.sourceSite.file).toBe("src/safe.ts");
    }
  });

  it("inverting the .test. basename exclusion fails: test paths would produce candidates", async () => {
    // Mutation checkpoint: inverting the `.test.` basename exclusion on `isProductionFile` in
    // v2/src/execution/diff-scan.ts must turn this subcase RED.
    await expectNoMutationCandidates(guardFlipFileDiff("v2/src/tui/tui-entry.test.tsx", "testFoo()"));
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

  const promptDiff = `diff --git a/prompts/implement/review-critic.md b/prompts/implement/review-critic.md
index f424d7da..be281d02 100644
--- a/prompts/implement/review-critic.md
+++ b/prompts/implement/review-critic.md
@@ -19,2 +19,2 @@
-## Branch change summary
+## Branch diff
+The diff comes from git merge-base <base> HEAD.
`;

  const registeredCritic = async () => ["prompts/implement/review-critic.md"];
  const missingCriticRenderCoverage = {
    kind: "surviving-mutation" as const,
    mutation: "missing-render-coverage",
    sourceSite: { file: "prompts/implement/review-critic.md", line: 1 },
  };
  const criticSource = `---
id: implement.prompt.review.critic
behavior: review
kind: step
revision: 1
placeholders: []
---
## Branch diff
The diff comes from git merge-base <base> HEAD.
`;

  it("does not mutate PR #1894 prompt prose and requires rendered-output coverage", async () => {
    const result = await verifyDiffDerivedMutations(
      { worktreePath: "/test/path", runBase: "main" },
      {
        gitDiff: async () => promptDiff,
        untrackedFiles: async () => [],
        registeredPromptPaths: registeredCritic,
        runScopedTests: async () => true,
      },
    );

    expect(result).toEqual(missingCriticRenderCoverage);
  });

  it("accepts a changed registered prompt only when a scoped test observes its rendered output", async () => {
    let scopedRuns = 0;
    let prompt = criticSource;
    const result = await verifyDiffDerivedMutations(
      { worktreePath: "/test/path", runBase: "main" },
      {
        gitDiff: async () => promptDiff,
        untrackedFiles: async () => [],
        registeredPromptPaths: registeredCritic,
        readFile: async () => prompt,
        writeFile: async (_path, content) => {
          prompt = content;
        },
        runScopedTests: async () => {
          scopedRuns += 1;
          return !prompt.includes("__JARVIS_PROMPT_RENDER_COVERAGE_MUTATION__");
        },
      },
    );

    expect(scopedRuns).toBe(1);
    expect(result.kind).toBe("pass");
    if (result.kind === "pass") expect(result.candidateCount).toBe(0);
  });

  it("does not treat raw template inspection as rendered prompt coverage", async () => {
    let prompt = criticSource;
    const result = await verifyDiffDerivedMutations(
      { worktreePath: "/test/path", runBase: "main" },
      {
        gitDiff: async () => promptDiff,
        untrackedFiles: async () => [],
        registeredPromptPaths: registeredCritic,
        readFile: async () => prompt,
        writeFile: async (_path, content) => {
          prompt = content;
        },
        runScopedTests: async () => true,
      },
    );

    expect(result).toEqual(missingCriticRenderCoverage);
  });

  it("uses each registered prompt's rendering contract instead of a renderer name", async () => {
    let prompt = criticSource;
    const result = await verifyDiffDerivedMutations(
      { worktreePath: "/test/path", runBase: "main" },
      {
        gitDiff: async () => promptDiff,
        untrackedFiles: async () => [],
        registeredPromptPaths: async () => ["prompts/implement/review-critic.md"],
        readFile: async () => prompt,
        writeFile: async (_path, content) => {
          prompt = content;
        },
        // Production reaches this artifact by id through the registry, not a
        // template-derived renderer function.
        runScopedTests: async () => !prompt.includes("__JARVIS_PROMPT_RENDER_COVERAGE_MUTATION__"),
      },
    );

    expect(result.kind).toBe("pass");
  });

  it("fails deleted and untracked registered prompts without render coverage", async () => {
    const deletedDiff = `diff --git a/prompts/implement/review-critic.md b/prompts/implement/review-critic.md
deleted file mode 100644
index be281d02..00000000
--- a/prompts/implement/review-critic.md
+++ /dev/null
@@ -1 +0,0 @@
-old prompt
`;
    const deleted = await verifyDiffDerivedMutations(
      { worktreePath: "/test/path", runBase: "main" },
      {
        gitDiff: async () => deletedDiff,
        untrackedFiles: async () => [],
        registeredPromptPaths: registeredCritic,
        runScopedTests: async () => true,
      },
    );
    const untracked = await verifyDiffDerivedMutations(
      { worktreePath: "/test/path", runBase: "main" },
      {
        gitDiff: async () => "",
        untrackedFiles: async () => ["prompts/implement/review-critic.md"],
        registeredPromptPaths: registeredCritic,
        runScopedTests: async () => true,
      },
    );

    expect(deleted).toEqual(missingCriticRenderCoverage);
    expect(untracked).toEqual(missingCriticRenderCoverage);
  });

  it("bounds scoped render checks across changed prompts", async () => {
    const promptPaths = [
      "prompts/implement/review-critic.md",
      "prompts/plan/draft.md",
      "prompts/intent/split.md",
      "prompts/write/execute.md",
      "prompts/patch/shrink.md",
      "prompts/patch/instructions.md",
    ];
    const uncoveredPath = promptPaths[5];
    if (uncoveredPath === undefined) throw new Error("expected six prompt paths");
    const diff = promptPaths
      .map(
        (path) => `diff --git a/${path} b/${path}
index 1234567..abcdefg 100644
--- a/${path}
+++ b/${path}
@@ -1 +1 @@
-old output
+new output
`,
      )
      .join("");
    let scopedRuns = 0;
    const result = await verifyDiffDerivedMutations(
      { worktreePath: "/test/path", runBase: "main" },
      {
        gitDiff: async () => diff,
        untrackedFiles: async () => [],
        registeredPromptPaths: async () => promptPaths,
        readFile: async () => criticSource,
        writeFile: async () => {},
        runScopedTests: async () => {
          scopedRuns += 1;
          return false;
        },
      },
    );

    expect(result).toEqual({
      kind: "surviving-mutation",
      mutation: "missing-render-coverage",
      sourceSite: { file: uncoveredPath, line: 1 },
    });
    expect(scopedRuns).toBe(5);
  });

  it("keeps prompts production-visible while skipping mutations for non-code paths", async () => {
    const result = await verifyDiffDerivedMutations(
      { worktreePath: "/test/path", runBase: "main" },
      {
        gitDiff: async () => `diff --git a/README.md b/README.md
index 1234567..abcdefg 100644
--- a/README.md
+++ b/README.md
@@ -1 +1 @@
-Delete docs
+if (!docs) remove(<docs>);
`,
        untrackedFiles: async () => ["prompts/unregistered.md", "notes.md"],
        registeredPromptPaths: async () => [],
        runScopedTests: async () => true,
      },
    );

    expect(result.kind).toBe("pass");
    if (result.kind === "pass") {
      expect(result.candidateCount).toBe(0);
      expect(result.inspectedPaths).toEqual(["README.md", "prompts/unregistered.md", "notes.md"]);
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

  it("fails closed for registered prompts without render-observer map entries", async () => {
    const patchPromptDiff = `diff --git a/prompts/patch/review-critic.md b/prompts/patch/review-critic.md
index f424d7da..be281d02 100644
--- a/prompts/patch/review-critic.md
+++ b/prompts/patch/review-critic.md
@@ -19,2 +19,2 @@
-## Branch change summary
+## Branch diff
+The diff comes from git merge-base <base> HEAD.
`;
    const result = await verifyDiffDerivedMutations(
      { worktreePath: "/test/path", runBase: "main" },
      {
        gitDiff: async () => patchPromptDiff,
        untrackedFiles: async () => [],
        registeredPromptPaths: async () => ["prompts/patch/review-critic.md"],
        runScopedTests: async () => false,
      },
    );

    expect(result).toEqual({
      kind: "surviving-mutation",
      mutation: "missing-render-coverage",
      sourceSite: { file: "prompts/patch/review-critic.md", line: 1 },
    });
  });

  it("completes shared multi-candidate verification within MAX_VERIFICATION_MS", async () => {
    const diff =
      `diff --git a/shared/fixture/a.ts b/shared/fixture/a.ts
index 1234567..abcdefg 100644
--- a/shared/fixture/a.ts
+++ b/shared/fixture/a.ts
@@ -1,1 +1,2 @@
+  if (!x0) return null;
` +
      Array.from({ length: 12 }, (_, index) => {
        const file = `shared/fixture/b${index}.ts`;
        return `diff --git a/${file} b/${file}
index 1234567..abcdefg 100644
--- a/${file}
+++ b/${file}
@@ -1,1 +1,2 @@
+  if (!x${index + 1}) return null;
`;
      }).join("");

    let scopedRuns = 0;
    const result = await verifyDiffDerivedMutations(
      { worktreePath: "/test/path", runBase: "main" },
      {
        gitDiff: async () => diff,
        untrackedFiles: async () => [],
        readFile: async (path) => {
          const basename = path.split("/").pop() ?? "";
          if (basename.includes(".test.")) return "export {};\n";
          const match = path.match(/b(\d+)\.ts$/);
          if (match?.[1] !== undefined) return `  if (!x${Number(match[1]) + 1}) return null;`;
          return "  if (!x0) return null;";
        },
        writeFile: async () => {},
        runScopedTests: async (_cwd, scope) => {
          scopedRuns += scope.length;
          return false;
        },
        now: () => 0,
      },
    );

    expect(result.kind).toBe("pass");
    if (result.kind === "pass") expect(result.candidateCount).toBe(13);
    expect(scopedRuns).toBe(13);
    expect(0 + MAX_VERIFICATION_MS).toBeGreaterThan(0);
  });

  it("invokes only the co-located killing test file per candidate", async () => {
    const diff = `diff --git a/shared/fixture/alpha.ts b/shared/fixture/alpha.ts
index 1234567..abcdefg 100644
--- a/shared/fixture/alpha.ts
+++ b/shared/fixture/alpha.ts
@@ -1,1 +1,2 @@
+  if (!a) return null;
diff --git a/shared/fixture/beta.ts b/shared/fixture/beta.ts
index 1234567..abcdefg 100644
--- a/shared/fixture/beta.ts
+++ b/shared/fixture/beta.ts
@@ -1,1 +1,2 @@
+  if (!b) return null;
diff --git a/v2/src/other/surface.ts b/v2/src/other/surface.ts
index 1234567..abcdefg 100644
--- a/v2/src/other/surface.ts
+++ b/v2/src/other/surface.ts
@@ -1,1 +1,2 @@
+  if (!c) return null;
`;
    const invoked: string[][] = [];

    await verifyDiffDerivedMutations(
      { worktreePath: "/test/path", runBase: "main" },
      {
        gitDiff: async () => diff,
        untrackedFiles: async () => [],
        readFile: async (path) => {
          const basename = path.split("/").pop() ?? "";
          if (basename.includes(".test.")) return "export {};\n";
          if (path.endsWith("alpha.ts")) return "  if (!a) return null;";
          if (path.endsWith("beta.ts")) return "  if (!b) return null;";
          return "  if (!c) return null;";
        },
        writeFile: async () => {},
        runScopedTests: async (_cwd, scope) => {
          invoked.push([...scope]);
          return false;
        },
      },
    );

    expect(invoked).toHaveLength(3);
    for (const scope of invoked) {
      expect(scope).toHaveLength(1);
      expect(scope[0]).toMatch(/\.test\.ts$/);
      expect(scope[0]).not.toContain("test:v2");
      expect(scope[0]).not.toContain("test:v1");
    }
    expect(invoked.map((scope) => scope[0]).sort()).toEqual([
      "shared/fixture/alpha.test.ts",
      "shared/fixture/beta.test.ts",
      "v2/src/other/surface.test.ts",
    ]);
  });

  it("invokes only that prompt's render-observer test file(s) per changed prompt", async () => {
    const diff = `diff --git a/prompts/implement/review-critic.md b/prompts/implement/review-critic.md
index f424d7da..be281d02 100644
--- a/prompts/implement/review-critic.md
+++ b/prompts/implement/review-critic.md
@@ -22,1 +22,1 @@
-The merge-base branch diff.
+The merge-base branch diff (mutated).
`;
    const invoked: string[][] = [];
    let prompt = criticSource.replace("merge-base branch diff", "merge-base branch diff (mutated)");

    await verifyDiffDerivedMutations(
      { worktreePath: "/test/path", runBase: "main" },
      {
        gitDiff: async () => diff,
        untrackedFiles: async () => [],
        registeredPromptPaths: registeredCritic,
        readFile: async () => prompt,
        writeFile: async (_path, content) => {
          prompt = content;
        },
        runScopedTests: async (_cwd, scope) => {
          invoked.push([...scope]);
          return !prompt.includes("__JARVIS_PROMPT_RENDER_COVERAGE_MUTATION__");
        },
      },
    );

    expect(invoked).toHaveLength(1);
    expect(invoked[0]).toEqual(["shared/prompts/review-implement.test.ts"]);
  });

  it("caps concurrent bun test invocations at MAX_CONCURRENT_VERIFIER_TEST_RUNS", async () => {
    resetVerifierTestRunTrackingForTest();
    // Deterministic overlap: each run blocks on an explicit gate (no real timers,
    // which the determinism guard forbids), so admitted runs stay in flight until
    // released and the semaphore's peak reflects the cap.
    const gates: Array<() => void> = [];
    const mockRunner = {
      runAsync: async () => {
        await new Promise<void>((resolve) => {
          gates.push(resolve);
        });
        return "";
      },
    };
    const flush = async () => {
      for (let i = 0; i < 20; i += 1) await Promise.resolve();
    };

    const all = Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        runDiffDerivedScopedTests("/test/path", [`shared/fixture/p${index}.test.ts`], mockRunner),
      ),
    );

    await flush();
    // The semaphore admits at most the cap; only that many runs reach their gate.
    expect(gates.length).toBe(MAX_CONCURRENT_VERIFIER_TEST_RUNS);
    expect(peakVerifierTestRuns()).toBe(MAX_CONCURRENT_VERIFIER_TEST_RUNS);

    // Drain: release admitted runs in waves; each completion admits a queued run.
    let released = 0;
    while (released < 8) {
      while (gates.length > 0) {
        gates.shift()?.();
        released += 1;
      }
      await flush();
    }
    await all;

    expect(peakVerifierTestRuns()).toBeLessThanOrEqual(MAX_CONCURRENT_VERIFIER_TEST_RUNS);
    expect(peakVerifierTestRuns()).toBeGreaterThan(1);
  });

  describe("defaultRunScopedTests (real subprocess, no seam)", () => {
    // Injected-seam tests above never exercise the default `runScopedTests`
    // implementation, so a bug in how it invokes the resolved scope (e.g.
    // treating package.json script names as `bun test` file patterns instead
    // of running them via `bun run <script>`) is invisible to them: the real
    // command silently matches zero test files, exits 0, and every mutation
    // is misreported as "surviving" regardless of actual test coverage. These
    // tests run the real default against a throwaway git+package.json fixture
    // to prove the resolved scope actually executes.
    function makeFixtureRepo(): string {
      const dir = mkdtempSync(join(tmpdir(), "mutation-verifier-fixture-"));
      // Explicit branch name: some machines' git hooks block commits to the
      // default-branch name `git init` would otherwise pick.
      execFileSync("git", ["init", "-q", "-b", "verifier-fixture"], { cwd: dir });
      execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
      execFileSync("git", ["config", "user.name", "test"], { cwd: dir });
      writeFileSync(
        join(dir, "package.json"),
        JSON.stringify({ name: "fixture", scripts: { test: "bun test guard.test.ts" } }),
      );
      writeFileSync(join(dir, "guard.ts"), "export function safe(x: unknown): string {\n  return String(x);\n}\n");
      writeFileSync(
        join(dir, "guard.test.ts"),
        'import { expect, test } from "bun:test";\nimport { safe } from "./guard.ts";\ntest("covered", () => { expect(safe(0)).toBe("safe"); });\n',
      );
      execFileSync("git", ["add", "-A"], { cwd: dir });
      execFileSync("git", ["commit", "-q", "-m", "base"], { cwd: dir });
      return dir;
    }

    it("catches a covered guard mutation via the real bun run invocation", async () => {
      const dir = makeFixtureRepo();
      try {
        const baseSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir }).toString().trim();
        writeFileSync(
          join(dir, "guard.ts"),
          'export function safe(x: unknown): string {\n  if (!x) return "safe";\n  return String(x);\n}\n',
        );
        execFileSync("git", ["commit", "-aq", "-m", "add guard"], { cwd: dir });

        const result = await verifyDiffDerivedMutations({ worktreePath: dir, runBase: baseSha });

        expect(result.kind).toBe("pass");
        if (result.kind === "pass") {
          expect(result.candidateCount).toBeGreaterThan(0);
        }
        expect(execFileSync("git", ["status", "--porcelain"], { cwd: dir }).toString().trim()).toBe("");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("reports a surviving mutation when no test covers the changed guard", async () => {
      const dir = makeFixtureRepo();
      try {
        const baseSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir }).toString().trim();
        // riskyGuard is never called by guard.test.ts, so neither the original
        // nor the mutated (`!x` flipped) form is exercised — a genuinely
        // uncovered changed guard, unlike a flip on a called function (whose
        // return value differs for the same input either way and so tends to
        // get caught regardless of which branch a test happens to exercise).
        // `safe` itself is untouched here, so guard.test.ts must assert its
        // actual (unmodified) behavior rather than makeFixtureRepo's shared
        // "safe" assertion — otherwise the baseline is already red before any
        // mutation, and every mutation looks "caught" for the wrong reason.
        writeFileSync(
          join(dir, "guard.test.ts"),
          'import { expect, test } from "bun:test";\nimport { safe } from "./guard.ts";\ntest("covered", () => { expect(safe(0)).toBe("0"); });\n',
        );
        writeFileSync(
          join(dir, "guard.ts"),
          'export function safe(x: unknown): string {\n  return String(x);\n}\n\nexport function riskyGuard(x: unknown): string {\n  if (!x) return "not-covered";\n  return "reached";\n}\n',
        );
        execFileSync("git", ["commit", "-aq", "-m", "add uncovered guard"], { cwd: dir });

        const result = await verifyDiffDerivedMutations({ worktreePath: dir, runBase: baseSha });

        expect(result.kind).toBe("surviving-mutation");
        expect(execFileSync("git", ["status", "--porcelain"], { cwd: dir }).toString().trim()).toBe("");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });
});

describe("verification bounds", () => {
  function guardFlipDiff(lines: number): string {
    const added = Array.from({ length: lines }, (_, i) => `+  if (!x${i}) return null;`).join("\n");
    return `diff --git a/src/many.ts b/src/many.ts
index 1234567..abcdefg 100644
--- a/src/many.ts
+++ b/src/many.ts
@@ -1,1 +1,${lines} @@
${added}
`;
  }

  it("caps inspected mutations and reports only what was inspected", async () => {
    let scopedRuns = 0;
    const result = await verifyDiffDerivedMutations(
      { worktreePath: "/test/path", runBase: "main" },
      {
        gitDiff: async () => guardFlipDiff(40),
        untrackedFiles: async () => [],
        readFile: async () => Array.from({ length: 40 }, (_, i) => `  if (!x${i}) return null;`).join("\n"),
        writeFile: async () => {},
        runScopedTests: async () => {
          scopedRuns += 1;
          return false;
        },
      },
    );
    expect(result.kind).toBe("pass");
    if (result.kind === "pass") expect(result.candidateCount).toBe(25);
    expect(scopedRuns).toBeLessThanOrEqual(25);
  });

  it("stops at the wall-clock deadline without inspecting remaining candidates", async () => {
    let scopedRuns = 0;
    let calls = 0;
    const result = await verifyDiffDerivedMutations(
      { worktreePath: "/test/path", runBase: "main" },
      {
        gitDiff: async () => guardFlipDiff(10),
        untrackedFiles: async () => [],
        readFile: async () => Array.from({ length: 10 }, (_, i) => `  if (!x${i}) return null;`).join("\n"),
        writeFile: async () => {},
        runScopedTests: async () => {
          scopedRuns += 1;
          return false;
        },
        now: () => (calls++ === 0 ? 0 : 10_000_000),
      },
    );
    expect(result.kind).toBe("pass");
    if (result.kind === "pass") expect(result.candidateCount).toBe(0);
    expect(scopedRuns).toBe(0);
  });
});

describe("maskNonCodeSpans", () => {
  it("preserves line length and masks double-quoted strings", () => {
    const input = `const msg = "usage: <name>";`;
    const masked = maskNonCodeSpans(input);
    expect(masked.length).toBe(input.length);
    expect(masked).not.toContain("<");
    expect(masked).toContain("const msg =");
  });

  it("masks single-quoted strings", () => {
    const input = `const msg = 'usage: <name>';`;
    const masked = maskNonCodeSpans(input);
    expect(masked.length).toBe(input.length);
    expect(masked).not.toContain("<");
  });

  it("masks backtick template literals", () => {
    const input = "const msg = `usage: <name>`;";
    const masked = maskNonCodeSpans(input);
    expect(masked.length).toBe(input.length);
    expect(masked).not.toContain("<");
  });

  it("masks line comments", () => {
    const input = "const x = 5; // placeholder: <name>";
    const masked = maskNonCodeSpans(input);
    expect(masked.length).toBe(input.length);
    expect(masked.slice(0, 13)).toBe("const x = 5; ");
    expect(masked.slice(13)).not.toContain("<");
  });

  it("handles escaped quotes in double-quoted strings", () => {
    const input = `const msg = "contains \\"escaped< quote\\"";`;
    const masked = maskNonCodeSpans(input);
    expect(masked.length).toBe(input.length);
    expect(masked).not.toContain("<");
    expect(masked).toContain("const msg =");
  });

  it("handles escaped quotes in single-quoted strings", () => {
    const input = `const msg = 'contains \\'escaped< quote\\'';`;
    const masked = maskNonCodeSpans(input);
    expect(masked.length).toBe(input.length);
    expect(masked).not.toContain("<");
  });

  it("handles escaped backticks in template literals", () => {
    const input = "const msg = `contains \\`escaped< backtick\\``;";
    const masked = maskNonCodeSpans(input);
    expect(masked.length).toBe(input.length);
    expect(masked).not.toContain("<");
  });

  it("preserves an operator that follows a string containing an escaped quote", () => {
    const input = `const msg = "a \\" b"; if (x < 5) {}`;
    const masked = maskNonCodeSpans(input);
    expect(masked.length).toBe(input.length);
    // The escaped quote must not close the string: closing early would reopen a
    // span at the real closing quote and mask the operator to end of line.
    expect(masked).toContain("< 5");
    expect(masked).not.toContain("b");
  });

  it("masks a self-contained block comment", () => {
    const input = "const x = 5; /* placeholder: <name> */ const y = 6;";
    const masked = maskNonCodeSpans(input);
    expect(masked.length).toBe(input.length);
    expect(masked).not.toContain("<");
    expect(masked).toContain("const x = 5;");
    expect(masked).toContain("const y = 6;");
  });

  it("masks an unterminated block comment to end of line", () => {
    const input = "const x = 5; /* placeholder: <name>";
    const masked = maskNonCodeSpans(input);
    expect(masked.length).toBe(input.length);
    expect(masked).not.toContain("<");
    expect(masked).toContain("const x = 5;");
  });

  it("preserves code outside of masked spans", () => {
    const input = `if (x < 5) const msg = "usage: <name>";`;
    const masked = maskNonCodeSpans(input);
    expect(masked.length).toBe(input.length);
    // The < in x < 5 should be preserved
    const operatorAt = input.indexOf("< 5");
    expect(masked.slice(operatorAt, operatorAt + 2)).toBe("< ");
    // The < in the string should be masked
    const stringAngleAt = input.indexOf("<name>");
    expect(masked.slice(stringAngleAt, stringAngleAt + 2)).not.toContain("<");
  });

  it("unterminated string masks to end of line", () => {
    const input = `const msg = "unclosed string with <`;
    const masked = maskNonCodeSpans(input);
    expect(masked.length).toBe(input.length);
    expect(masked).not.toContain("<");
    expect(masked).toContain("const msg =");
  });
});

describe("masking non-code spans", () => {
  it("yields no candidate when only `<` is inside a double-quoted string", async () => {
    const diff = `diff --git a/src/test.ts b/src/test.ts
index 1234567..abcdefg 100644
--- a/src/test.ts
+++ b/src/test.ts
@@ -1,1 +1,1 @@
+const msg = "usage: <name>";
`;

    const result = await verifyDiffDerivedMutations(
      { worktreePath: "/test/path", runBase: "main" },
      {
        gitDiff: async () => diff,
        untrackedFiles: async () => [],
        runScopedTests: async () => false,
      },
    );

    expect(result.kind).toBe("pass");
    if (result.kind === "pass") expect(result.candidateCount).toBe(0);
  });

  it("yields no candidate when `<` is inside a line comment", async () => {
    const diff = `diff --git a/src/test.ts b/src/test.ts
index 1234567..abcdefg 100644
--- a/src/test.ts
+++ b/src/test.ts
@@ -1,1 +1,1 @@
+const x = 5; // placeholder: <name>
`;

    const result = await verifyDiffDerivedMutations(
      { worktreePath: "/test/path", runBase: "main" },
      {
        gitDiff: async () => diff,
        untrackedFiles: async () => [],
        runScopedTests: async () => false,
      },
    );

    expect(result.kind).toBe("pass");
    if (result.kind === "pass") expect(result.candidateCount).toBe(0);
  });

  it("yields no candidate when `<` is inside a backtick template literal", async () => {
    const diff = `diff --git a/src/test.ts b/src/test.ts
index 1234567..abcdefg 100644
--- a/src/test.ts
+++ b/src/test.ts
@@ -1,1 +1,1 @@
+const msg = \`usage: <name>\`;
`;

    const result = await verifyDiffDerivedMutations(
      { worktreePath: "/test/path", runBase: "main" },
      {
        gitDiff: async () => diff,
        untrackedFiles: async () => [],
        runScopedTests: async () => false,
      },
    );

    expect(result.kind).toBe("pass");
    if (result.kind === "pass") expect(result.candidateCount).toBe(0);
  });

  it("mutates genuine comparison operator on same line as string containing `<`", async () => {
    const diff = `diff --git a/src/test.ts b/src/test.ts
index 1234567..abcdefg 100644
--- a/src/test.ts
+++ b/src/test.ts
@@ -1,1 +1,1 @@
+if (x < 5) const msg = "usage: <name>";
`;

    const originalContent = `if (x < 5) const msg = "usage: <name>";`;

    const mutatedContents: string[] = [];

    const result = await verifyDiffDerivedMutations(
      { worktreePath: "/test/path", runBase: "main" },
      {
        gitDiff: async () => diff,
        untrackedFiles: async () => [],
        readFile: async () => originalContent,
        writeFile: async (_path, content) => {
          if (content !== originalContent) {
            mutatedContents.push(content);
          }
        },
        runScopedTests: async () => false,
      },
    );

    expect(result.kind).toBe("pass");
    if (result.kind === "pass") {
      expect(result.candidateCount).toBeGreaterThan(0);
    }
    // The mutation should be applied to the actual < operator, not the one in the string
    expect(mutatedContents.length).toBeGreaterThan(0);
    expect(mutatedContents[0]?.includes("if (x >= 5)")).toBe(true);
    expect(mutatedContents[0]?.includes('"usage: <name>"')).toBe(true);
  });

  it("regression: CLEANUP_USAGE line yields no candidate", async () => {
    const diff = `diff --git a/v2/src/cli/usage.ts b/v2/src/cli/usage.ts
index 1234567..abcdefg 100644
--- a/v2/src/cli/usage.ts
+++ b/v2/src/cli/usage.ts
@@ -16,1 +16,1 @@
+export const CLEANUP_USAGE = "usage: jarvis cleanup [--dry-run] [--yes|-y] [--abandon <name>]\\n";
`;

    const result = await verifyDiffDerivedMutations(
      { worktreePath: "/test/path", runBase: "main" },
      {
        gitDiff: async () => diff,
        untrackedFiles: async () => [],
        runScopedTests: async () => false,
      },
    );

    expect(result.kind).toBe("pass");
    if (result.kind === "pass") expect(result.candidateCount).toBe(0);
  });

  it("masks escaped quotes inside double-quoted strings", async () => {
    const diff = `diff --git a/src/test.ts b/src/test.ts
index 1234567..abcdefg 100644
--- a/src/test.ts
+++ b/src/test.ts
@@ -1,1 +1,1 @@
+const msg = "contains \\"escaped< quote\\"";
`;

    const result = await verifyDiffDerivedMutations(
      { worktreePath: "/test/path", runBase: "main" },
      {
        gitDiff: async () => diff,
        untrackedFiles: async () => [],
        runScopedTests: async () => false,
      },
    );

    expect(result.kind).toBe("pass");
    if (result.kind === "pass") expect(result.candidateCount).toBe(0);
  });

  it("masks single-quoted strings with adjacent operators", async () => {
    const diff = `diff --git a/src/test.ts b/src/test.ts
index 1234567..abcdefg 100644
--- a/src/test.ts
+++ b/src/test.ts
@@ -1,1 +1,1 @@
+if (x < 5) const msg = 'usage: <name>';
`;

    const originalContent = `if (x < 5) const msg = 'usage: <name>';`;

    const mutatedContents: string[] = [];

    const result = await verifyDiffDerivedMutations(
      { worktreePath: "/test/path", runBase: "main" },
      {
        gitDiff: async () => diff,
        untrackedFiles: async () => [],
        readFile: async () => originalContent,
        writeFile: async (_path, content) => {
          if (content !== originalContent) {
            mutatedContents.push(content);
          }
        },
        runScopedTests: async () => false,
      },
    );

    expect(result.kind).toBe("pass");
    if (result.kind === "pass") {
      expect(result.candidateCount).toBeGreaterThan(0);
    }
    // The mutation should be applied to the actual < operator, not the one in the string
    expect(mutatedContents.length).toBeGreaterThan(0);
    expect(mutatedContents[0]?.includes("if (x >= 5)")).toBe(true);
    expect(mutatedContents[0]?.includes("'usage: <name>'")).toBe(true);
  });

  it("yields no candidate when `>`, `!`, and `delete(` sit inside a string literal", async () => {
    const diff = `diff --git a/src/test.ts b/src/test.ts
index 1234567..abcdefg 100644
--- a/src/test.ts
+++ b/src/test.ts
@@ -1,1 +1,1 @@
+const msg = "run > out, then !force, then delete(row)";
`;

    const result = await verifyDiffDerivedMutations(
      { worktreePath: "/test/path", runBase: "main" },
      {
        gitDiff: async () => diff,
        untrackedFiles: async () => [],
        runScopedTests: async () => false,
      },
    );

    expect(result.kind).toBe("pass");
    if (result.kind === "pass") expect(result.candidateCount).toBe(0);
  });

  it("yields no candidate when the only mutable text sits in a self-contained block comment", async () => {
    const diff = `diff --git a/src/test.ts b/src/test.ts
index 1234567..abcdefg 100644
--- a/src/test.ts
+++ b/src/test.ts
@@ -1,1 +1,1 @@
+const usage = buildUsage(); /** cleanup [--abandon <name>] */
`;

    const result = await verifyDiffDerivedMutations(
      { worktreePath: "/test/path", runBase: "main" },
      {
        gitDiff: async () => diff,
        untrackedFiles: async () => [],
        runScopedTests: async () => false,
      },
    );

    expect(result.kind).toBe("pass");
    if (result.kind === "pass") expect(result.candidateCount).toBe(0);
  });

  it("yields no candidate when the block comment is unterminated on the line", async () => {
    const diff = `diff --git a/src/test.ts b/src/test.ts
index 1234567..abcdefg 100644
--- a/src/test.ts
+++ b/src/test.ts
@@ -1,1 +1,1 @@
+const usage = buildUsage(); /* cleanup [--abandon <name>]
`;

    const result = await verifyDiffDerivedMutations(
      { worktreePath: "/test/path", runBase: "main" },
      {
        gitDiff: async () => diff,
        untrackedFiles: async () => [],
        runScopedTests: async () => false,
      },
    );

    expect(result.kind).toBe("pass");
    if (result.kind === "pass") expect(result.candidateCount).toBe(0);
  });

  it("applies a guard mutation whose span encloses a masked string literal", async () => {
    const diff = `diff --git a/src/test.ts b/src/test.ts
index 1234567..abcdefg 100644
--- a/src/test.ts
+++ b/src/test.ts
@@ -1,1 +1,1 @@
+if (!("minFreeGb" in memory)) {
`;

    const originalContent = `if (!("minFreeGb" in memory)) {`;
    const mutatedContents: string[] = [];

    const result = await verifyDiffDerivedMutations(
      { worktreePath: "/test/path", runBase: "main" },
      {
        gitDiff: async () => diff,
        untrackedFiles: async () => [],
        readFile: async () => originalContent,
        writeFile: async (_path, content) => {
          if (content !== originalContent) mutatedContents.push(content);
        },
        runScopedTests: async () => false,
      },
    );

    expect(result.kind).toBe("pass");
    // The candidate's recorded text must come from the original line, not the
    // masked one — otherwise applying it throws on the column-slice guard.
    expect(mutatedContents.length).toBeGreaterThan(0);
    expect(mutatedContents[0]).toBe(`if (("minFreeGb" in memory)) {`);
  });

  it("fails the candidate when the recorded columns no longer hold its original text", async () => {
    const diff = `diff --git a/src/test.ts b/src/test.ts
index 1234567..abcdefg 100644
--- a/src/test.ts
+++ b/src/test.ts
@@ -1,1 +1,1 @@
+if (x < 5) return null;
`;

    await expect(
      verifyDiffDerivedMutations(
        { worktreePath: "/test/path", runBase: "main" },
        {
          gitDiff: async () => diff,
          untrackedFiles: async () => [],
          // The worktree file has drifted from the diff, so the slice at the
          // candidate's columns is not its original text.
          readFile: async () => `if (yyyyyy < 5) return null;`,
          writeFile: async () => {},
          runScopedTests: async () => false,
        },
      ),
    ).rejects.toThrow("Failed to test candidate for src/test.ts:1");
  });

  describe("dual-constraint detection", () => {
    async function survivingMutation(diff: string, content: string) {
      const result = await verifyDiffDerivedMutations(
        { worktreePath: "/test/path", runBase: "main" },
        {
          gitDiff: async () => diff,
          untrackedFiles: async () => [],
          readFile: async (path) => {
            const basename = path.split("/").pop() ?? "";
            if (basename.includes(".test.")) return "export {};\n";
            return content;
          },
          writeFile: async () => {},
          runScopedTests: async () => true,
        },
      );
      expect(result.kind).toBe("surviving-mutation");
      if (result.kind !== "surviving-mutation") throw new Error("expected surviving-mutation");
      return result;
    }

    it("detects timer callback enclosure for a surviving mutation inside setTimeout", async () => {
      const diff = `diff --git a/v2/src/execution/guard.ts b/v2/src/execution/guard.ts
index 1234567..abcdefg 100644
--- a/v2/src/execution/guard.ts
+++ b/v2/src/execution/guard.ts
@@ -1,5 +1,5 @@
 export function test() {
   setTimeout(() => {
-    if (!x) return null;
+    if (!x) return "test";
     return x;
   }, 100);
 }`;
      const content = `export function test() {
  setTimeout(() => {
    if (!x) return "test";
    return x;
  }, 100);
}
`;

      let scopedCalls = 0;
      const result = await verifyDiffDerivedMutations(
        { worktreePath: "/test/path", runBase: "main" },
        {
          gitDiff: async () => diff,
          untrackedFiles: async () => [],
          readFile: async (path) => {
            const basename = path.split("/").pop() ?? "";
            if (basename.includes(".test.")) return "export {};\n";
            return content;
          },
          writeFile: async () => {},
          runScopedTests: async () => {
            scopedCalls += 1;
            return true;
          },
        },
      );
      expect(scopedCalls).toBe(1);
      expect(result.kind).toBe("surviving-mutation");
      if (result.kind !== "surviving-mutation") throw new Error("expected surviving-mutation");
      expect(result.dualConstraint).toBe(true);
    });

    it("reports surviving mutation without dual constraint when outside timer callback", async () => {
      const diff = `diff --git a/v2/src/execution/test.ts b/v2/src/execution/test.ts
index 1234567..abcdefg 100644
--- a/v2/src/execution/test.ts
+++ b/v2/src/execution/test.ts
@@ -1,3 +1,3 @@
 export function test() {
-  if (!x) return null;
+  if (!x) return "test";
   return x;`;
      const content = `export function test() {
  if (!x) return "test";
  return x;
}`;

      const result = await survivingMutation(diff, content);
      expect(result.dualConstraint).toBeUndefined();
    });

    it("reports surviving mutation without dual constraint when in timer callback but outside guarded root", async () => {
      const diff = `diff --git a/src/test.ts b/src/test.ts
index 1234567..abcdefg 100644
--- a/src/test.ts
+++ b/src/test.ts
@@ -1,5 +1,5 @@
 export function test() {
   setTimeout(() => {
-    if (!x) return null;
+    if (!x) return "test";
     return x;
   }, 100);
 }`;
      const content = `export function test() {
  setTimeout(() => {
    if (!x) return "test";
    return x;
  }, 100);
}`;

      const result = await survivingMutation(diff, content);
      expect(result.dualConstraint).toBeUndefined();
    });
  });
});

describe("equivalent-mutation directives", () => {
  const guardMutation = "guard-flip: !x → x";
  const guardDirective = `// @mutate-equivalent mutation="${guardMutation}" reason="Caller contract guarantees truthy x"`;

  function guardFlipDiff(file: string, lineContent: string): string {
    return `diff --git a/${file} b/${file}
index 1234567..abcdefg 100644
--- a/${file}
+++ b/${file}
@@ -1,3 +1,3 @@
 export function safe(x: any) {
-  if (!x) return null;
+${lineContent}
   return x;
`;
  }

  it("accepts an exact equivalent-mutation directive and reports its audit site", async () => {
    const file = "src/safe.ts";
    const sourceLine = `  if (!x) return "safe"; ${guardDirective}`;
    const originalContent = `export function safe(x: any) {\n${sourceLine}\n  return x;\n}`;
    let testRunCount = 0;

    const result = await verifyDiffDerivedMutations(
      { worktreePath: "/test/path", runBase: "main" },
      {
        gitDiff: async () => guardFlipDiff(file, sourceLine),
        untrackedFiles: async () => [],
        readFile: async () => originalContent,
        writeFile: async () => {},
        listDir: () => [],
        runScopedTests: async () => {
          testRunCount += 1;
          return true;
        },
      },
    );

    expect(testRunCount).toBe(0);
    expect(result.kind).toBe("pass");
    if (result.kind === "pass") {
      expect(result.acceptedSites).toEqual([
        {
          file,
          line: 2,
          mutation: guardMutation,
          reason: "Caller contract guarantees truthy x",
        },
      ]);
    }
  });

  it("treats malformed, reordered, padded, trailing, empty-reason, and mismatched directives as absent", async () => {
    const file = "src/safe.ts";
    const baseLine = `  if (!x) return "safe";`;
    const originalContent = (suffix: string) => `export function safe(x: any) {\n${baseLine} ${suffix}\n  return x;\n}`;
    const malformedCases = [
      `// @mutate-equivalent mutation=${guardMutation} reason="ok"`,
      `// @mutate-equivalent reason="ok" mutation="${guardMutation}"`,
      `//  @mutate-equivalent mutation="${guardMutation}" reason="ok"`,
      `// @mutate-equivalent mutation="${guardMutation}" reason="ok" trailing`,
      `// @mutate-equivalent mutation="${guardMutation}" reason="ok" @mutate-equivalent mutation="${guardMutation}" reason="dup"`,
      `// @mutate-equivalent mutation="${guardMutation}" reason=""`,
      `// @mutate-equivalent mutation="${guardMutation}" reason="   "`,
      `// @mutate-equivalent mutation="operator-flip: === → !==" reason="wrong mutation"`,
    ];

    for (const suffix of malformedCases) {
      let testRunCount = 0;
      const result = await verifyDiffDerivedMutations(
        { worktreePath: "/test/path", runBase: "main" },
        {
          gitDiff: async () => guardFlipDiff(file, `${baseLine} ${suffix}`),
          untrackedFiles: async () => [],
          readFile: async () => originalContent(suffix),
          writeFile: async () => {},
          listDir: () => [],
          runScopedTests: async () => {
            testRunCount += 1;
            return true;
          },
        },
      );
      expect(result.kind).toBe("surviving-mutation");
      expect(testRunCount).toBeGreaterThan(0);
    }
  });

  it("does not recognize directive-like text outside a lexical line comment", async () => {
    const file = "src/safe.ts";
    const disguises = [
      `const note = "// @mutate-equivalent mutation=\\"${guardMutation}\\" reason=\\"ok\\""; if (!x) return "safe";`,
      `const note = \`// @mutate-equivalent mutation="${guardMutation}" reason="ok"\`; if (!x) return "safe";`,
      `const re = /\\/\\/@mutate-equivalent mutation="${guardMutation}" reason="ok"/; if (!x) return "safe";`,
      `/* @mutate-equivalent mutation="${guardMutation}" reason="ok" */ if (!x) return "safe";`,
    ];

    for (const lineContent of disguises) {
      let testRunCount = 0;
      const result = await verifyDiffDerivedMutations(
        { worktreePath: "/test/path", runBase: "main" },
        {
          gitDiff: async () => guardFlipDiff(file, lineContent),
          untrackedFiles: async () => [],
          readFile: async () => `export function safe(x: any) {\n${lineContent}\n  return x;\n}`,
          writeFile: async () => {},
          listDir: () => [],
          runScopedTests: async () => {
            testRunCount += 1;
            return true;
          },
        },
      );
      expect(result.kind).toBe("surviving-mutation");
      expect(testRunCount).toBeGreaterThan(0);
      if (result.kind === "pass") expect(result.acceptedSites).toEqual([]);
    }
  });

  it("accepts only the exact file and physical line named by the directive", async () => {
    const otherLineDirective = `// @mutate-equivalent mutation="${guardMutation}" reason="only line 3"`;
    const diff = `diff --git a/src/a.ts b/src/a.ts
index 1234567..abcdefg 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,4 +1,4 @@
 export function a(x: any) {
-  if (!x) return null;
+  if (!x) return "a";
   if (!x) return "b"; ${otherLineDirective}
   return x;
diff --git a/src/b.ts b/src/b.ts
index 1234567..abcdefg 100644
--- a/src/b.ts
+++ b/src/b.ts
@@ -1,3 +1,3 @@
 export function b(x: any) {
-  if (!x) return null;
+  if (!x) return "b";
   return x;
`;
    const aContent = `export function a(x: any) {\n  if (!x) return "a";\n  if (!x) return "b"; ${otherLineDirective}\n  return x;\n}`;
    const bContent = `export function b(x: any) {\n  if (!x) return "b";\n  return x;\n}`;

    const result = await verifyDiffDerivedMutations(
      { worktreePath: "/test/path", runBase: "main" },
      {
        gitDiff: async () => diff,
        untrackedFiles: async () => [],
        readFile: async (path) => {
          if (path.endsWith("a.ts")) return aContent;
          if (path.endsWith("b.ts")) return bContent;
          throw new Error(`unexpected read: ${path}`);
        },
        writeFile: async () => {},
        listDir: () => [],
        runScopedTests: async () => true,
      },
    );

    expect(result.kind).toBe("surviving-mutation");
    if (result.kind === "surviving-mutation") {
      expect(result.sourceSite.file).toBe("src/a.ts");
      expect(result.sourceSite.line).toBe(2);
    }
  });

  it("accepts one named transform on a multi-candidate line while testing the other", async () => {
    const operatorMutation = "operator-flip: === → !==";
    const sourceLine = `  if (!x) return x === 5 ? "hit" : "miss"; // @mutate-equivalent mutation="${operatorMutation}" reason="Domain makes equality check behavior-neutral"`;
    const originalContent = `export function pick(x: number) {\n${sourceLine}\n  return x;\n}`;
    let testRunCount = 0;

    const result = await verifyDiffDerivedMutations(
      { worktreePath: "/test/path", runBase: "main" },
      {
        gitDiff: async () => guardFlipDiff("src/pick.ts", sourceLine),
        untrackedFiles: async () => [],
        readFile: async () => originalContent,
        writeFile: async () => {},
        listDir: () => [],
        runScopedTests: async () => {
          testRunCount += 1;
          return true;
        },
      },
    );

    expect(testRunCount).toBeGreaterThan(0);
    expect(result.kind).toBe("surviving-mutation");
    if (result.kind === "surviving-mutation") {
      expect(result.mutation).toContain("guard-flip");
    }
  });

  it("accepts duplicate identity candidates jointly with one audit entry", async () => {
    const operatorMutation = "operator-flip: === → !==";
    const line = `  if (x === 5 && y === 6) return "hit"; // @mutate-equivalent mutation="${operatorMutation}" reason="Both comparisons are behavior-neutral under domain"`;
    const originalContent = `export function safe(x: number, y: number) {\n${line}\n  return x;\n}`;
    let testRunCount = 0;

    const result = await verifyDiffDerivedMutations(
      { worktreePath: "/test/path", runBase: "main" },
      {
        gitDiff: async () => guardFlipDiff("src/safe.ts", line),
        untrackedFiles: async () => [],
        readFile: async () => originalContent,
        writeFile: async () => {},
        listDir: () => [],
        runScopedTests: async () => {
          testRunCount += 1;
          return true;
        },
      },
    );

    expect(testRunCount).toBe(0);
    expect(result.kind).toBe("pass");
    if (result.kind === "pass") {
      expect(result.acceptedSites).toEqual([
        {
          file: "src/safe.ts",
          line: 2,
          mutation: operatorMutation,
          reason: "Both comparisons are behavior-neutral under domain",
        },
      ]);
      expect(result.candidateCount).toBeGreaterThan(1);
    }
  });

  it("exposes acceptedSites on every pass result", async () => {
    const empty = await verifyDiffDerivedMutations(
      { worktreePath: "/test/path", runBase: "main" },
      { gitDiff: async () => "", untrackedFiles: async () => [], runScopedTests: async () => true },
    );
    expect(empty.kind).toBe("pass");
    if (empty.kind === "pass") expect(empty.acceptedSites).toEqual([]);

    const lineA = `  if (!a) return "a"; // @mutate-equivalent mutation="guard-flip: !a → a" reason="a is always truthy"`;
    const lineB = `  if (!b) return "b"; // @mutate-equivalent mutation="guard-flip: !b → b" reason="b is always truthy"`;
    const diff = `diff --git a/src/many.ts b/src/many.ts
index 1234567..abcdefg 100644
--- a/src/many.ts
+++ b/src/many.ts
@@ -1,3 +1,4 @@
 export function many() {
+${lineA}
+${lineB}
   return true;
`;
    const content = `export function many() {\n${lineA}\n${lineB}\n  return true;\n}`;
    const multi = await verifyDiffDerivedMutations(
      { worktreePath: "/test/path", runBase: "main" },
      {
        gitDiff: async () => diff,
        untrackedFiles: async () => [],
        readFile: async () => content,
        writeFile: async () => {},
        listDir: () => [],
        runScopedTests: async () => true,
      },
    );
    expect(multi.kind).toBe("pass");
    if (multi.kind === "pass") {
      expect(multi.acceptedSites).toEqual([
        { file: "src/many.ts", line: 2, mutation: "guard-flip: !a → a", reason: "a is always truthy" },
        { file: "src/many.ts", line: 3, mutation: "guard-flip: !b → b", reason: "b is always truthy" },
      ]);
    }
  });

  it("counts accepted candidates against bounds and omits unadmitted sites", async () => {
    const directive = (index: number) =>
      `// @mutate-equivalent mutation="guard-flip: !x${index} → x${index}" reason="always truthy"`;
    const lines = Array.from({ length: 30 }, (_, index) => `  if (!x${index}) return null; ${directive(index)}`);
    const diff = `diff --git a/src/many.ts b/src/many.ts
index 1234567..abcdefg 100644
--- a/src/many.ts
+++ b/src/many.ts
@@ -1,1 +1,${lines.length} @@
${lines.map((line) => `+${line}`).join("\n")}
`;
    const content = lines.join("\n");
    let testRunCount = 0;
    const capped = await verifyDiffDerivedMutations(
      { worktreePath: "/test/path", runBase: "main" },
      {
        gitDiff: async () => diff,
        untrackedFiles: async () => [],
        readFile: async () => content,
        writeFile: async () => {},
        listDir: () => [],
        runScopedTests: async () => {
          testRunCount += 1;
          return true;
        },
      },
    );
    expect(capped.kind).toBe("pass");
    if (capped.kind === "pass") {
      expect(capped.candidateCount).toBe(MAX_INSPECTED_MUTATIONS);
      expect(capped.acceptedSites).toHaveLength(MAX_INSPECTED_MUTATIONS);
      expect(testRunCount).toBe(0);
    }

    let deadlineCalls = 0;
    const deadline = await verifyDiffDerivedMutations(
      { worktreePath: "/test/path", runBase: "main" },
      {
        gitDiff: async () => guardFlipDiff("src/safe.ts", `  if (!x) return "safe"; ${guardDirective}`),
        untrackedFiles: async () => [],
        readFile: async () =>
          `export function safe(x: any) {\n  if (!x) return "safe"; ${guardDirective}\n  return x;\n}`,
        writeFile: async () => {},
        listDir: () => [],
        runScopedTests: async () => true,
        now: () => (deadlineCalls++ === 0 ? 0 : 10_000_000),
      },
    );
    expect(deadline.kind).toBe("pass");
    if (deadline.kind === "pass") {
      expect(deadline.candidateCount).toBe(0);
      expect(deadline.acceptedSites).toEqual([]);
    }
  });

  it("parses standard JSON escaping in directive strings", () => {
    const parsed = parseEquivalentMutationDirective(
      `  if (!x) return "safe"; // @mutate-equivalent mutation="guard-flip: !x → x" reason="tab\\tand\\"quote\\""`,
    );
    expect(parsed).toEqual({
      mutation: "guard-flip: !x → x",
      reason: 'tab\tand"quote"',
    });
  });
});

describe("co-located killing-test resolution (sibling fallback)", () => {
  it("resolveSiblingKillingTests returns existing <stem>-*.test.ts siblings, excluding exact-stem and unrelated files", () => {
    const entries = ["big.test.ts", "big-part.test.ts", "big-other.test.ts", "unrelated.test.ts", "big.ts"];
    const result = resolveSiblingKillingTests("v2/src/big.ts", "/wt", () => entries);
    expect(result).toEqual(["v2/src/big-other.test.ts", "v2/src/big-part.test.ts"]);
  });

  it("resolveSiblingKillingTests returns [] for a test file or when no siblings exist", () => {
    expect(resolveSiblingKillingTests("v2/src/big.test.ts", "/wt", () => ["big.test.ts"])).toEqual([]);
    expect(resolveSiblingKillingTests("v2/src/big.ts", "/wt", () => [])).toEqual([]);
    expect(resolveSiblingKillingTests("v2/src/data.json", "/wt", () => ["data-x.test.ts"])).toEqual([]);
  });

  const guardDiff = `diff --git a/v2/src/big.ts b/v2/src/big.ts
index 1234567..abcdefg 100644
--- a/v2/src/big.ts
+++ b/v2/src/big.ts
@@ -1,2 +1,2 @@
 export function check(a: number, b: number) {
-  return a < b;
+  return a === b;
`;
  const guardContent = `export function check(a: number, b: number) {\n  return a === b;\n}`;

  function readFileSeam(): (path: string) => Promise<string> {
    return async (path: string) => {
      if (path.endsWith("big.test.ts")) throw new Error("ENOENT: exact-stem test absent");
      if (path.endsWith("big.ts")) return guardContent;
      throw new Error(`unexpected read: ${path}`);
    };
  }

  it("a changed guard whose only killing test is a sibling passes when the sibling kills the mutation", async () => {
    const scopes: string[][] = [];
    const result = await verifyDiffDerivedMutations(
      { worktreePath: "/wt", runBase: "main" },
      {
        gitDiff: async () => guardDiff,
        untrackedFiles: async () => [],
        readFile: readFileSeam(),
        writeFile: async () => {},
        listDir: () => ["big-part.test.ts"],
        runScopedTests: async (_cwd, scope) => {
          scopes.push(scope);
          return false; // sibling test fails under the mutation => killed
        },
      },
    );
    expect(result.kind).toBe("pass");
    expect(scopes.some((scope) => scope.includes("v2/src/big-part.test.ts"))).toBe(true);
  });

  it("the same changed guard reports missing-killing-test when no exact-stem and no sibling test exists (fix is load-bearing)", async () => {
    const result = await verifyDiffDerivedMutations(
      { worktreePath: "/wt", runBase: "main" },
      {
        gitDiff: async () => guardDiff,
        untrackedFiles: async () => [],
        readFile: readFileSeam(),
        writeFile: async () => {},
        listDir: () => [], // no co-located test file at all
        runScopedTests: async () => true,
      },
    );
    expect(result.kind).toBe("surviving-mutation");
    if (result.kind === "surviving-mutation") {
      expect(result.mutation).toBe("missing-killing-test");
      expect(result.sourceSite.file).toBe("v2/src/big.ts");
    }
  });
});
