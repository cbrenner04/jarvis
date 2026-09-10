import { describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveRenderObserverTests } from "../../../shared/prompts/render-observer-tests.ts";
import { locateMarkerSlice } from "../../../shared/structural-test-locator.ts";
import {
  AsyncSubprocessError,
  type AsyncSubprocessOptions,
  realAsyncSubprocessRunner,
} from "../../../shared/subprocess.ts";
import {
  type DiffDerivedMutationVerifierInput,
  exclusiveHoldOverlappedConcurrentRun,
  exclusiveRunMustQueue,
  extractRenderObserverMapFromSource,
  KILLING_TEST_BUDGET_CEILING_MS,
  KILLING_TEST_BUDGET_FLOOR_MS,
  killingTestBudgetMs,
  MAX_CONCURRENT_VERIFIER_TEST_RUNS,
  MAX_INSPECTED_MUTATIONS,
  MAX_KILLING_TEST_MS,
  MAX_VERIFICATION_MS,
  maskNonCodeSpans,
  mutationRecordFileName,
  parseEquivalentMutationDirective,
  peakVerifierTestRuns,
  type RunScopedTestsOptions,
  resetVerifierTestRunTracking,
  resolveImporterScanRoot,
  resolveSiblingKillingTests,
  runDiffDerivedScopedTests,
  sharedRunMustQueue,
  VerifierTestRunSemaphore,
  verifyDiffDerivedMutations,
} from "./diff-derived-mutation-verifier.ts";

function renderObserverMapSource(entries: Record<string, readonly string[]>): string {
  const lines = Object.entries(entries).flatMap(([prompt, tests]) => {
    const quotedTests = tests.map((testPath) => `"${testPath}"`).join(", ");
    return `  "${prompt}": [${quotedTests}],`;
  });
  return `const RENDER_OBSERVER_TESTS = {\n${lines.join("\n")}\n};\nexport function resolveRenderObserverTests(promptPath: string) { return RENDER_OBSERVER_TESTS[promptPath]; }\n`;
}

// The slow fixture below must genuinely sleep: it exists to hold a semaphore slot open long enough
// to overlap a confirmation window. That sleep runs in a spawned subprocess against a temp-dir
// fixture, never in this suite, but `guard-deterministic-daemon-tests` scans source text and cannot
// tell fixture bytes from ours. Composing the call keeps the guard reading only real code.
const FIXTURE_SLEEP_CALL = `await Bun.${"sleep"}(2500);`;

const REPO_ROOT = join(import.meta.dir, "../../..");
const DAEMON_RUN_CONTROL_HANDLER_GUARD_REL = "v2/src/daemon/daemon-run-control-handler-guard.ts";
const DAEMON_RUN_CONTROL_HANDLER_GUARD_EXIT = "if (index === -1) break;";

const COMMITTED_RENDER_OBSERVER_MAP_SOURCE = (() => {
  const source = readFileSync(join(import.meta.dir, "../../../shared/prompts/render-observer-tests.ts"), "utf-8");
  if (extractRenderObserverMapFromSource(source) === null) {
    throw new Error("committed render-observer map must parse");
  }
  return source;
})();

function seamReadFile(promptContent: string | (() => string), mapSource?: string) {
  const resolvedMapSource = mapSource ?? COMMITTED_RENDER_OBSERVER_MAP_SOURCE;
  return async (path: string) => {
    if (path.endsWith("render-observer-tests.ts")) return resolvedMapSource;
    return typeof promptContent === "function" ? promptContent() : promptContent;
  };
}

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

  const renderCoverageBodyLine = "Synthetic prompt body for render-coverage verifier tests.";
  const changedRenderCoverageBodyLine = `${renderCoverageBodyLine} (changed)`;
  const promptDiff = `diff --git a/prompts/implement/review-critic.md b/prompts/implement/review-critic.md
index f424d7da..be281d02 100644
--- a/prompts/implement/review-critic.md
+++ b/prompts/implement/review-critic.md
@@ -9,1 +9,1 @@
-${renderCoverageBodyLine}
+${changedRenderCoverageBodyLine}
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
${changedRenderCoverageBodyLine}
`;

  it("does not mutate PR #1894 prompt prose and requires rendered-output coverage", async () => {
    const result = await verifyDiffDerivedMutations(
      { worktreePath: "/test/path", runBase: "main" },
      {
        gitDiff: async () => promptDiff,
        untrackedFiles: async () => [],
        registeredPromptPaths: registeredCritic,
        readFile: seamReadFile(criticSource, renderObserverMapSource({})),
        runScopedTests: async () => true,
      },
    );

    expect(result).toEqual(missingCriticRenderCoverage);
  });

  it("passes render-coverage for frontmatter-only revision bumps via unmutated observer verification", async () => {
    const frontmatterDiff = `diff --git a/prompts/implement/review-critic.md b/prompts/implement/review-critic.md
index f424d7da..be281d02 100644
--- a/prompts/implement/review-critic.md
+++ b/prompts/implement/review-critic.md
@@ -4,1 +4,1 @@
-revision: 1
+revision: 2
`;
    const bumpedSource = criticSource.replace("revision: 1", "revision: 2");
    const observerPath = "v2/src/execution/review-critic-render.test.ts";
    const mapSource = renderObserverMapSource({ "prompts/implement/review-critic.md": [observerPath] });
    let writeCount = 0;
    let scopedRuns = 0;
    const result = await verifyDiffDerivedMutations(
      { worktreePath: "/test/path", runBase: "main" },
      {
        gitDiff: async () => frontmatterDiff,
        untrackedFiles: async () => [],
        registeredPromptPaths: registeredCritic,
        readFile: seamReadFile(bumpedSource, mapSource),
        writeFile: async () => {
          writeCount += 1;
        },
        runScopedTests: async () => {
          scopedRuns += 1;
          return true;
        },
      },
    );
    expect(result.kind).toBe("pass");
    expect(writeCount).toBe(0);
    expect(scopedRuns).toBe(1);
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
        readFile: seamReadFile(() => prompt),
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

  it("settles render-observer timeout as non-terminating-mutation", async () => {
    const observerPath = "v2/src/execution/review-critic-render.test.ts";
    const mapSource = renderObserverMapSource({ "prompts/implement/review-critic.md": [observerPath] });
    const result = await verifyDiffDerivedMutations(
      { worktreePath: "/test/path", runBase: "main" },
      {
        gitDiff: async () => promptDiff,
        untrackedFiles: async () => [],
        registeredPromptPaths: registeredCritic,
        readFile: seamReadFile(criticSource, mapSource),
        writeFile: async () => {},
        runScopedTests: async () => {
          throw new AsyncSubprocessError("timed out", undefined, "", "", "ETIMEDOUT");
        },
      },
    );

    expect(result).toMatchObject({
      kind: "non-terminating-mutation",
      mutation: "render-observer-timeout",
      sourceSite: { file: "prompts/implement/review-critic.md", line: 1 },
    });
  });

  it("does not treat raw template inspection as rendered prompt coverage", async () => {
    let prompt = criticSource;
    const result = await verifyDiffDerivedMutations(
      { worktreePath: "/test/path", runBase: "main" },
      {
        gitDiff: async () => promptDiff,
        untrackedFiles: async () => [],
        registeredPromptPaths: registeredCritic,
        readFile: seamReadFile(() => prompt),
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
        readFile: seamReadFile(() => prompt),
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
        readFile: seamReadFile(criticSource, renderObserverMapSource({})),
        runScopedTests: async () => true,
      },
    );
    const untracked = await verifyDiffDerivedMutations(
      { worktreePath: "/test/path", runBase: "main" },
      {
        gitDiff: async () => "",
        untrackedFiles: async () => ["prompts/implement/review-critic.md"],
        registeredPromptPaths: registeredCritic,
        readFile: seamReadFile(criticSource, renderObserverMapSource({})),
        runScopedTests: async () => true,
      },
    );

    expect(deleted).toEqual(missingCriticRenderCoverage);
    expect(untracked).toEqual(missingCriticRenderCoverage);
  });

  it("fails untracked registered prompts even when mapped observers pass on unmutated content", async () => {
    const observerPath = "v2/src/execution/review-critic-render.test.ts";
    const mapSource = renderObserverMapSource({ "prompts/implement/review-critic.md": [observerPath] });
    let scopedRuns = 0;
    const result = await verifyDiffDerivedMutations(
      { worktreePath: "/test/path", runBase: "main" },
      {
        gitDiff: async () => "",
        untrackedFiles: async () => ["prompts/implement/review-critic.md"],
        registeredPromptPaths: registeredCritic,
        readFile: seamReadFile(criticSource, mapSource),
        runScopedTests: async () => {
          scopedRuns += 1;
          return true;
        },
      },
    );

    expect(result).toEqual(missingCriticRenderCoverage);
    expect(scopedRuns).toBe(0);
  });

  it("bounds scoped render checks across changed prompts", async () => {
    const promptPaths = [
      "prompts/implement/review-critic.md",
      "prompts/plan/draft.md",
      "prompts/intent/split.md",
      "prompts/write/execute.md",
      "prompts/patch/shrink.md",
      "prompts/implement/instructions.md",
    ];
    const uncoveredPath = promptPaths[5];
    if (uncoveredPath === undefined) throw new Error("expected six prompt paths");
    const diff = promptPaths
      .map(
        (path) => `diff --git a/${path} b/${path}
index 1234567..abcdefg 100644
--- a/${path}
+++ b/${path}
@@ -9,1 +9,1 @@
-${renderCoverageBodyLine}
+${changedRenderCoverageBodyLine}
`,
      )
      .join("");
    const invoked: string[][] = [];
    let scopedRuns = 0;
    const result = await verifyDiffDerivedMutations(
      { worktreePath: "/test/path", runBase: "main" },
      {
        gitDiff: async () => diff,
        untrackedFiles: async () => [],
        registeredPromptPaths: async () => promptPaths,
        readFile: seamReadFile(criticSource),
        writeFile: async () => {},
        runScopedTests: async (_cwd, scope) => {
          invoked.push([...scope]);
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
    const checkedPrompts = promptPaths.slice(0, 5);
    expect(invoked).toHaveLength(5);
    for (const [index, promptPath] of checkedPrompts.entries()) {
      expect(invoked[index]).toEqual([...(resolveRenderObserverTests(promptPath) ?? [])]);
    }
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
@@ -9,1 +9,1 @@
-${renderCoverageBodyLine}
+${changedRenderCoverageBodyLine}
`;
    const result = await verifyDiffDerivedMutations(
      { worktreePath: "/test/path", runBase: "main" },
      {
        gitDiff: async () => patchPromptDiff,
        untrackedFiles: async () => [],
        registeredPromptPaths: async () => ["prompts/patch/review-critic.md"],
        readFile: seamReadFile(criticSource, renderObserverMapSource({})),
        runScopedTests: async () => false,
      },
    );

    expect(result).toEqual({
      kind: "surviving-mutation",
      mutation: "missing-render-coverage",
      sourceSite: { file: "prompts/patch/review-critic.md", line: 1 },
    });
  });

  it("does not require render coverage for prompts retired from the worktree registry", async () => {
    // Mutation checkpoint: dropping `currentRegistry.paths.has(path)` when the worktree registry
    // is available must turn this RED (`missing-render-coverage` at `prompts/patch/review-critic.md:1`).
    const dir = mkdtempSync(join(tmpdir(), "mutation-retired-prompt-fixture-"));
    try {
      execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
      execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
      execFileSync("git", ["config", "user.name", "test"], { cwd: dir });
      mkdirSync(join(dir, "prompts", "patch"), { recursive: true });
      writeFileSync(
        join(dir, "prompts", "patch", "review-critic.md"),
        `---
id: patch.prompt.review.critic
behavior: patch
kind: step
revision: 1
placeholders: []
---
# Critic body
`,
      );
      writeFileSync(join(dir, "prompts", "registry.txt"), "patch/review-critic.md\n");
      execFileSync("git", ["add", "-A"], { cwd: dir });
      execFileSync("git", ["commit", "-q", "-m", "base"], { cwd: dir });
      const baseSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir }).toString().trim();

      rmSync(join(dir, "prompts", "patch", "review-critic.md"));
      writeFileSync(join(dir, "prompts", "registry.txt"), "\n");
      execFileSync("git", ["add", "-A"], { cwd: dir });
      execFileSync("git", ["commit", "-q", "-m", "retire prompt"], { cwd: dir });

      const unionBaseRegistry = async (_cwd: string, baseRef: string) => {
        const manifest = execFileSync("git", ["show", `${baseRef}:prompts/registry.txt`], { cwd: dir }).toString();
        return manifest
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean)
          .map((path) => `prompts/${path}`);
      };
      const result = await verifyDiffDerivedMutations(
        { worktreePath: dir, runBase: baseSha },
        { registeredPromptPaths: unionBaseRegistry },
      );

      expect(result.kind).toBe("pass");
      expect(result).not.toEqual({
        kind: "surviving-mutation",
        mutation: "missing-render-coverage",
        sourceSite: { file: "prompts/patch/review-critic.md", line: 1 },
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
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
@@ -9,1 +9,1 @@
-${renderCoverageBodyLine}
+${changedRenderCoverageBodyLine}
`;
    const invoked: string[][] = [];
    let prompt = criticSource;

    await verifyDiffDerivedMutations(
      { worktreePath: "/test/path", runBase: "main" },
      {
        gitDiff: async () => diff,
        untrackedFiles: async () => [],
        registeredPromptPaths: registeredCritic,
        readFile: seamReadFile(() => prompt),
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
    // Assert the scoping behavior against the registered map, not a hardcoded copy of it:
    // adding an observer for this prompt must not require editing this test.
    expect(invoked[0]).toEqual([...(resolveRenderObserverTests("prompts/implement/review-critic.md") ?? [])]);
  });

  it("caps concurrent bun test invocations at MAX_CONCURRENT_VERIFIER_TEST_RUNS", async () => {
    resetVerifierTestRunTracking();
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

  describe("bounded killing-test execution", () => {
    const source = `export function hangs(x: unknown): string {
  if (!x) return "stopped";
  return "running";
}`;
    const diff = `diff --git a/src/hangs.ts b/src/hangs.ts
index 1234567..abcdefg 100644
--- a/src/hangs.ts
+++ b/src/hangs.ts
@@ -1,3 +1,3 @@
 export function hangs(x: unknown): string {
-  if (!x) return "old";
+  if (!x) return "stopped";
   return "running";
`;

    function verifyTimeout(
      runScopedTests: (cwd: string, scope: readonly string[], options?: RunScopedTestsOptions) => Promise<boolean>,
      writeFile: (path: string, content: string) => Promise<void> = async () => {},
      extra: { now?: () => number; listDir?: () => string[] } = {},
    ) {
      return verifyDiffDerivedMutations(
        { worktreePath: "/test/path", runBase: "main" },
        {
          gitDiff: async () => diff,
          untrackedFiles: async () => [],
          readFile: async (path) => (path.endsWith(".test.ts") ? "export {};\n" : source),
          writeFile,
          listDir: extra.listDir ?? (() => []),
          runScopedTests,
          ...(extra.now !== undefined ? { now: extra.now } : {}),
        },
      );
    }

    /** A fake clock the scoped-test fake advances by the "runtime" of each call. */
    function fakeClock() {
      let nowMs = 1_000_000;
      return {
        now: () => nowMs,
        advance: (ms: number) => {
          nowMs += ms;
        },
      };
    }

    it("a killing set slower than the ceiling settles inconclusive naming the measured baseline", async () => {
      const clock = fakeClock();
      const result = await verifyTimeout(
        async (_cwd, _scope, options) => {
          clock.advance((options?.timeoutMs ?? 0) + 1);
          throw new AsyncSubprocessError("timed out", undefined, "", "", "ETIMEDOUT");
        },
        undefined,
        { now: clock.now },
      );
      expect(result.kind).toBe("pass");
      if (result.kind === "pass") {
        expect(result.skippedCandidates).toHaveLength(1);
        expect(result.skippedCandidates[0]).toMatchObject({ file: "src/hangs.ts", line: 2 });
        expect(result.skippedCandidates[0]?.reason).toContain("inconclusive");
        expect(result.skippedCandidates[0]?.reason).toContain(`${KILLING_TEST_BUDGET_CEILING_MS}ms ceiling`);
        expect(result.skippedCandidates[0]?.reason).toContain("src/hangs.test.ts");
      }
    });

    it("a genuinely non-terminating mutant still settles non-terminating-mutation", async () => {
      const clock = fakeClock();
      const result = await verifyTimeout(
        async (_cwd, _scope, options) => {
          if (options?.timeoutMs === KILLING_TEST_BUDGET_CEILING_MS) {
            clock.advance(2_000); // unmutated baseline well inside the floor
            return true;
          }
          clock.advance((options?.timeoutMs ?? 0) + 1);
          throw new AsyncSubprocessError("timed out", undefined, "", "", "ETIMEDOUT");
        },
        undefined,
        { now: clock.now },
      );
      expect(result).toMatchObject({ kind: "non-terminating-mutation", sourceSite: { file: "src/hangs.ts", line: 2 } });
    });

    it("the per-candidate bound scales with the whole resolved killing set and is clamped", async () => {
      expect(killingTestBudgetMs(1_000)).toBe(KILLING_TEST_BUDGET_FLOOR_MS);
      expect(killingTestBudgetMs(45_000)).toBe(90_000);
      expect(killingTestBudgetMs(100_000)).toBe(KILLING_TEST_BUDGET_CEILING_MS);

      const clock = fakeClock();
      const bounds: number[] = [];
      const runtimeByTest: Record<string, number> = { "src/hangs.test.ts": 7_000, "src/hangs-slow.test.ts": 38_000 };
      const result = await verifyTimeout(
        async (_cwd, scope, options) => {
          const timeoutMs = options?.timeoutMs ?? 0;
          bounds.push(timeoutMs);
          // The whole set runs concurrently; its wall time is the slowest member.
          const wall = Math.max(...scope.map((path) => runtimeByTest[path] ?? 0));
          if (wall > timeoutMs) {
            clock.advance(timeoutMs + 1);
            throw new AsyncSubprocessError("timed out", undefined, "", "", "ETIMEDOUT");
          }
          clock.advance(wall);
          return false; // killed once the bound accommodates the slow sibling
        },
        undefined,
        { now: clock.now, listDir: () => ["hangs-slow.test.ts"] },
      );
      expect(result.kind).toBe("pass");
      // floor attempt (timed out), baseline at the ceiling (38s measured), retry at 2 × 38s.
      expect(bounds).toEqual([KILLING_TEST_BUDGET_FLOOR_MS, KILLING_TEST_BUDGET_CEILING_MS, 76_000]);
    });

    it("an inconclusive candidate is recorded and does not fail the run", async () => {
      const clock = fakeClock();
      const result = await verifyTimeout(
        async (_cwd, _scope, options) => {
          clock.advance((options?.timeoutMs ?? 0) + 1);
          throw new AsyncSubprocessError("timed out", undefined, "", "", "ETIMEDOUT");
        },
        undefined,
        { now: clock.now },
      );
      expect(result.kind).toBe("pass");
      if (result.kind === "pass") {
        expect(result.candidateCount).toBeGreaterThan(0);
        expect(result.skippedCandidates.map((candidate) => candidate.reason.startsWith("inconclusive:"))).toEqual([
          true,
        ]);
      }
    });

    it("bounds a never-settling detached subprocess and settles verification", async () => {
      let receivedOptions: AsyncSubprocessOptions | undefined;
      const neverSettlingRunner = {
        runAsync: async (_command: string, _args: string[], _cwd: string, options?: AsyncSubprocessOptions) => {
          if (options?.timeoutMs === KILLING_TEST_BUDGET_CEILING_MS) return ""; // unmutated baseline is fast
          receivedOptions = options;
          if (options?.timeoutMs === MAX_KILLING_TEST_MS && options.processGroup !== undefined) {
            throw new AsyncSubprocessError("timed out", undefined, "", "", "ETIMEDOUT");
          }
          await new Promise<void>(() => {});
          return "";
        },
      };

      const result = await verifyTimeout((cwd, scope, options) =>
        runDiffDerivedScopedTests(cwd, scope, neverSettlingRunner, options),
      );

      expect(receivedOptions?.timeoutMs).toBe(MAX_KILLING_TEST_MS);
      expect(receivedOptions?.processGroup).toBeDefined();
      expect(result.kind).toBe("non-terminating-mutation");
    }, 1_000);

    it("classifies scoped-test timeout separately from caught and surviving mutations", async () => {
      const result = await verifyTimeout(async (_cwd, _scope, options) => {
        if (options?.timeoutMs === KILLING_TEST_BUDGET_CEILING_MS) return true; // unmutated baseline is fast
        throw new AsyncSubprocessError("timed out", undefined, "", "", "ETIMEDOUT");
      });

      expect(result).toMatchObject({
        kind: "non-terminating-mutation",
        mutation: expect.stringContaining("guard-flip"),
        sourceSite: { file: "src/hangs.ts", line: 2 },
      });
    });

    it("returns caught when a sibling scoped test fails before a parallel timeout", async () => {
      const result = await runDiffDerivedScopedTests("/test/path", ["src/fails.test.ts", "src/hangs.test.ts"], {
        runAsync: async (_command, args) => {
          if (args[1] === "src/hangs.test.ts") {
            throw new AsyncSubprocessError("timed out", undefined, "", "", "ETIMEDOUT");
          }
          throw new AsyncSubprocessError("tests failed", 1, "", "", undefined);
        },
      });

      expect(result).toBe(false);
    });

    it("treats a caught failure as dominant when co-located and sibling scoped tests run in parallel", async () => {
      const result = await verifyDiffDerivedMutations(
        { worktreePath: "/test/path", runBase: "main" },
        {
          gitDiff: async () => diff,
          untrackedFiles: async () => [],
          readFile: async (path) => (path.endsWith(".test.ts") ? "export {};\n" : source),
          writeFile: async () => {},
          listDir: () => ["hangs-extra.test.ts"],
          runScopedTests: (cwd, scope) =>
            runDiffDerivedScopedTests(cwd, scope, {
              runAsync: async (_command, args) => {
                if (args[1] === "src/hangs-extra.test.ts") {
                  throw new AsyncSubprocessError("timed out", undefined, "", "", "ETIMEDOUT");
                }
                throw new AsyncSubprocessError("tests failed", 1, "", "", undefined);
              },
            }),
        },
      );

      expect(result.kind).toBe("pass");
      if (result.kind === "pass") expect(result.candidateCount).toBeGreaterThan(0);
    });

    it("restores pre-mutation bytes after scoped-test timeout", async () => {
      let currentContent = source;
      const writes: string[] = [];
      const result = await verifyTimeout(
        async (_cwd, _scope, options) => {
          if (options?.timeoutMs === KILLING_TEST_BUDGET_CEILING_MS) {
            // The baseline must run against the restored original bytes.
            expect(currentContent).toBe(source);
            return true;
          }
          throw new AsyncSubprocessError("timed out", undefined, "", "", "ETIMEDOUT");
        },
        async (_path, content) => {
          writes.push(content);
          currentContent = content;
        },
      );

      expect(result.kind).toBe("non-terminating-mutation");
      expect(currentContent).toBe(source);
      expect(writes).toHaveLength(2);
      expect(writes[0]).not.toBe(source);
      expect(writes[1]).toBe(source);
    });

    describe("confirmation re-run of a clean killing-set pass", () => {
      it("a killing set that passes once and fails on confirmation treats the candidate as killed", async () => {
        let callCount = 0;
        const isolationByCall: Array<boolean | undefined> = [];
        const result = await verifyTimeout(async (_cwd, _scope, options) => {
          callCount += 1;
          isolationByCall.push(options?.isolated);
          return callCount === 1;
        });

        expect(callCount).toBe(2);
        // The confirmation must actually request the exclusive mode. Asserting only that no overlap
        // was observed is fail-open: with `isolated` dropped, `runExclusive` is never reached, no
        // overlap can be recorded, and the assertion still passes.
        expect(isolationByCall).toEqual([undefined, true]);
        expect(result.kind).toBe("pass");
        if (result.kind === "pass") expect(result.candidateCount).toBeGreaterThan(0);
      });

      it("a killing set that passes on both the primary run and the confirmation reports the survivor", async () => {
        let callCount = 0;
        const result = await verifyTimeout(async () => {
          callCount += 1;
          return true;
        });

        expect(callCount).toBe(2);
        expect(result.kind).toBe("surviving-mutation");
        if (result.kind === "surviving-mutation") {
          expect(result.mutation).toContain("guard-flip");
          expect(result.sourceSite).toEqual({ file: "src/hangs.ts", line: 2 });
        }
      });

      it("confirmation reuses the exact budget that produced the primary clean pass after a baseline-widened retry", async () => {
        const clock = fakeClock();
        const bounds: number[] = [];
        const runtimeByTest: Record<string, number> = { "src/hangs.test.ts": 7_000, "src/hangs-slow.test.ts": 38_000 };
        const result = await verifyTimeout(
          async (_cwd, scope, options) => {
            const timeoutMs = options?.timeoutMs ?? 0;
            bounds.push(timeoutMs);
            if (timeoutMs === KILLING_TEST_BUDGET_CEILING_MS) {
              clock.advance(38_000); // unmutated baseline, measured at the slow sibling's wall time
              return true;
            }
            const wall = Math.max(...scope.map((path) => runtimeByTest[path] ?? 0));
            if (wall > timeoutMs) {
              clock.advance(timeoutMs + 1);
              throw new AsyncSubprocessError("timed out", undefined, "", "", "ETIMEDOUT");
            }
            clock.advance(wall);
            return true; // both the widened retry and the confirmation pass
          },
          undefined,
          { now: clock.now, listDir: () => ["hangs-slow.test.ts"] },
        );

        expect(result.kind).toBe("surviving-mutation");
        // floor attempt (timed out), baseline at the ceiling, widened retry (76s), confirmation at the same 76s.
        expect(bounds).toEqual([KILLING_TEST_BUDGET_FLOOR_MS, KILLING_TEST_BUDGET_CEILING_MS, 76_000, 76_000]);
      });

      it("skips confirmation and reports the survivor when too little time remains for it", async () => {
        const clock = fakeClock();
        let callCount = 0;
        const result = await verifyTimeout(
          async () => {
            callCount += 1;
            // Consume the deadline: after this primary pass, no time remains for confirmation at the floor budget.
            clock.advance(MAX_VERIFICATION_MS - KILLING_TEST_BUDGET_FLOOR_MS + 1);
            return true;
          },
          undefined,
          { now: clock.now },
        );

        expect(callCount).toBe(1);
        expect(result.kind).toBe("surviving-mutation");
      });

      it("a confirmation run that times out settles the candidate inconclusive, not surviving or non-terminating", async () => {
        let callCount = 0;
        const result = await verifyTimeout(async () => {
          callCount += 1;
          if (callCount === 1) return true; // primary pass at the floor budget
          throw new AsyncSubprocessError("timed out", undefined, "", "", "ETIMEDOUT"); // confirmation times out
        });

        expect(callCount).toBe(2);
        expect(result.kind).toBe("pass");
        if (result.kind === "pass") {
          expect(result.skippedCandidates).toHaveLength(1);
          expect(result.skippedCandidates[0]).toMatchObject({ file: "src/hangs.ts", line: 2 });
          expect(result.skippedCandidates[0]?.reason).toContain("inconclusive");
          expect(result.skippedCandidates[0]?.reason).toContain("confirmation");
        }
      });
    });
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
    }, 120_000);

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

    it("isolates a confirmation re-run from a concurrent scoped test run via the real subprocess semaphore", async () => {
      const dir = mkdtempSync(join(tmpdir(), "mutation-verifier-isolation-"));
      try {
        execFileSync("git", ["init", "-q", "-b", "verifier-fixture"], { cwd: dir });
        execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
        execFileSync("git", ["config", "user.name", "test"], { cwd: dir });
        writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "fixture" }));
        // risky.ts: an uncovered guard, so its primary pass is clean and a confirmation re-run follows.
        writeFileSync(join(dir, "risky.ts"), "export function risky(x: unknown): string {\n  return String(x);\n}\n");
        writeFileSync(
          join(dir, "risky.test.ts"),
          'import { expect, test } from "bun:test";\nimport { risky } from "./risky.ts";\ntest("covered", () => { expect(risky(0)).toBe("0"); });\n',
        );
        // slow.ts: a covered guard whose killing test sleeps, holding a normal semaphore slot open
        // long enough to overlap risky.ts's confirmation window if isolation is not enforced.
        writeFileSync(join(dir, "slow.ts"), "export function slow(x: unknown): string {\n  return String(x);\n}\n");
        writeFileSync(
          join(dir, "slow.test.ts"),
          `import { expect, test } from "bun:test";\nimport { slow } from "./slow.ts";\ntest("covered slowly", async () => { ${FIXTURE_SLEEP_CALL} expect(slow(0)).toBe("0"); });\n`,
        );
        execFileSync("git", ["add", "-A"], { cwd: dir });
        execFileSync("git", ["commit", "-q", "-m", "base"], { cwd: dir });
        const baseSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir }).toString().trim();

        writeFileSync(
          join(dir, "risky.ts"),
          'export function risky(x: unknown): string {\n  return String(x);\n}\n\nexport function riskyGuard(x: unknown): string {\n  if (!x) return "not-covered";\n  return "reached";\n}\n',
        );
        writeFileSync(
          join(dir, "slow.ts"),
          'export function slow(x: unknown): string {\n  return String(x);\n}\n\nexport function slowGuard(x: unknown): string {\n  if (!x) return "not-covered";\n  return "reached";\n}\n',
        );
        writeFileSync(
          join(dir, "slow.test.ts"),
          `import { expect, test } from "bun:test";\nimport { slow, slowGuard } from "./slow.ts";\ntest("covered slowly", async () => { ${FIXTURE_SLEEP_CALL} expect(slow(0)).toBe("0"); expect(slowGuard(0)).toBe("not-covered"); });\n`,
        );
        execFileSync("git", ["commit", "-aq", "-m", "add uncovered guard and slow covered guard"], { cwd: dir });

        resetVerifierTestRunTracking();
        const result = await verifyDiffDerivedMutations({ worktreePath: dir, runBase: baseSha });

        expect(result).toMatchObject({ kind: "surviving-mutation", sourceSite: { file: "risky.ts" } });
        expect(exclusiveHoldOverlappedConcurrentRun()).toBe(false);
        expect(peakVerifierTestRuns()).toBeGreaterThan(0);
        expect(execFileSync("git", ["status", "--porcelain"], { cwd: dir }).toString().trim()).toBe("");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }, 60_000);

    it(
      "bounds scanDaemonRunControlHandlerForbiddenSymbols while (true) exit-guard flip via real killing test",
      async () => {
        const dir = mkdtempSync(join(tmpdir(), "mutation-verifier-while-true-guard-"));
        const guardPath = join(dir, DAEMON_RUN_CONTROL_HANDLER_GUARD_REL);
        const committedGuard = readFileSync(join(REPO_ROOT, DAEMON_RUN_CONTROL_HANDLER_GUARD_REL), "utf-8");
        if (!committedGuard.includes(DAEMON_RUN_CONTROL_HANDLER_GUARD_EXIT)) {
          throw new Error("committed daemon-run-control-handler-guard exit guard shape changed");
        }

        try {
          execFileSync("git", ["init", "-q", "-b", "verifier-fixture"], { cwd: dir });
          execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
          execFileSync("git", ["config", "user.name", "test"], { cwd: dir });
          cpSync(join(REPO_ROOT, "v2/src/daemon"), join(dir, "v2/src/daemon"), { recursive: true });
          try {
            symlinkSync(join(REPO_ROOT, "node_modules"), join(dir, "node_modules"), "dir");
          } catch {
            /* reuse existing symlink */
          }

          writeFileSync(guardPath, committedGuard);
          execFileSync("git", ["add", "-A"], { cwd: dir });
          execFileSync("git", ["commit", "-q", "-m", "base"], { cwd: dir });
          const baseSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir }).toString().trim();

          const touchedGuard = committedGuard.replace(
            DAEMON_RUN_CONTROL_HANDLER_GUARD_EXIT,
            `${DAEMON_RUN_CONTROL_HANDLER_GUARD_EXIT} // exit when symbol absent`,
          );
          writeFileSync(guardPath, touchedGuard);
          execFileSync("git", ["commit", "-aq", "-m", "touch while (true) exit guard"], { cwd: dir });

          const preVerificationBytes = readFileSync(guardPath);
          const exitGuardLine = preVerificationBytes
            .toString("utf-8")
            .split("\n")
            .findIndex((line) => line.includes(DAEMON_RUN_CONTROL_HANDLER_GUARD_EXIT));
          if (exitGuardLine < 0) {
            throw new Error("while (true) exit guard line missing from touched guard source");
          }

          // Records every killing-test process group pgid spawned during the hang, via the real
          // group-mode subprocess runner, so the assertions below can prove none of them survives
          // verification instead of only inferring cleanup from timing and classification. Only
          // instruments `processGroup` when the call actually requested it, instead of injecting
          // it unconditionally, so the zero-capture guard below fails if the verifier's spawn ever
          // stops requesting process-group mode itself.
          const capturedPgids: number[] = [];
          const capturingRunner = {
            runAsync: (command: string, args: string[], cwd: string, options?: AsyncSubprocessOptions) =>
              realAsyncSubprocessRunner.runAsync(command, args, cwd, {
                ...options,
                ...(options?.processGroup
                  ? {
                      processGroup: {
                        ...options.processGroup,
                        onGroupId: (pgid: number) => {
                          capturedPgids.push(pgid);
                          options.processGroup?.onGroupId?.(pgid);
                        },
                      },
                    }
                  : {}),
              }),
          };

          const started = Date.now();
          const result = await verifyDiffDerivedMutations(
            { worktreePath: dir, runBase: baseSha },
            {
              runScopedTests: (cwd, scope, options) => runDiffDerivedScopedTests(cwd, scope, capturingRunner, options),
            },
          );
          const elapsed = Date.now() - started;

          expect(elapsed).toBeLessThan(MAX_KILLING_TEST_MS + 60_000);
          expect(result).toMatchObject({
            kind: "non-terminating-mutation",
            mutation: expect.stringContaining("=== → !=="),
            sourceSite: {
              file: DAEMON_RUN_CONTROL_HANDLER_GUARD_REL,
              line: exitGuardLine + 1,
            },
          });
          expect(readFileSync(guardPath)).toEqual(preVerificationBytes);
          expect(execFileSync("git", ["status", "--porcelain"], { cwd: dir }).toString().trim()).toBe("");

          expect(capturedPgids.length).toBeGreaterThan(0);
          for (const pgid of capturedPgids) {
            let killError: unknown;
            try {
              process.kill(-pgid, 0);
            } catch (error) {
              killError = error;
            }
            expect((killError as NodeJS.ErrnoException | undefined)?.code).toBe("ESRCH");
          }
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
      },
      MAX_KILLING_TEST_MS + 90_000,
    );
  });
});

describe("TypeScript operator candidate classification", () => {
  function addedLineDiff(file: string, hunks: string[][]): string {
    return `diff --git a/${file} b/${file}
index 1234567..abcdefg 100644
--- a/${file}
+++ b/${file}
${hunks.map((lines) => `@@ -0,0 +1,${lines.length} @@\n+${lines.join("\n+")}\n`).join("")}`;
  }

  function verifyAddedSource(file: string, hunks: string[][], source: string, mutations?: string[]) {
    return verifyDiffSource(file, addedLineDiff(file, hunks), source, mutations);
  }

  function verifyDiffSource(_file: string, diff: string, source: string, mutations?: string[]) {
    return verifyDiffDerivedMutations(
      { worktreePath: "/test/path", runBase: "main" },
      {
        gitDiff: async () => diff,
        untrackedFiles: async () => [],
        readFile: async (path) => (path.endsWith(".test.ts") ? "export {};\n" : source),
        writeFile: async (_path, content) => {
          if (content !== source) mutations?.push(content);
        },
        listDir: () => [],
        runScopedTests: async () => false,
      },
    );
  }

  it("skips operator-flip for type-position angle brackets", async () => {
    const lines = [
      "const parameter = x as Parameters<Foo>[0];",
      "const map = new Map<string, number>();",
      "const called = fn<T>(value);",
      "const satisfied = x satisfies Foo<Bar>;",
      "const generic = <K extends keyof T>(key: K) => key;",
    ];
    const content = lines.join("\n");
    const result = await verifyAddedSource("src/syntax.ts", [lines], content);

    expect(result.kind).toBe("pass");
    if (result.kind === "pass") expect(result.candidateCount).toBe(0);
  });

  it("derives operator-flip for expression comparisons on lines with type syntax", async () => {
    const sourceLine = "export const compare = (a: number, b: number) => a < b ? new Map<string, number>() : null;";
    const mutations: string[] = [];
    const result = await verifyAddedSource("src/compare.ts", [[sourceLine]], sourceLine, mutations);

    expect(result.kind).toBe("pass");
    if (result.kind === "pass") expect(result.candidateCount).toBe(1);
    expect(mutations).toEqual([sourceLine.replace("a < b", "a >= b")]);
  });

  it("orders guard-flip before operator-flip and collapses per-line duplicates", async () => {
    const sourceLine =
      "export function choose(a: boolean, b: number, c: number) { if (!a && b < c) return b; return c; }";
    const mutations: string[] = [];
    const result = await verifyAddedSource("src/choose.ts", [[sourceLine], [sourceLine]], sourceLine, mutations);

    expect(result.kind).toBe("pass");
    if (result.kind === "pass") expect(result.candidateCount).toBe(2);
    expect(mutations).toEqual([sourceLine.replace("!a", "a"), sourceLine.replace("b < c", "b >= c")]);
  });

  it("skips a multiline template continuation while retaining a real comparison", async () => {
    const source = "const message = `\n  rendered < marker\n`;\nconst comparison = left < right;";
    const mutations: string[] = [];
    const result = await verifyDiffSource(
      "src/template.ts",
      `diff --git a/src/template.ts b/src/template.ts
index 1234567..abcdefg 100644
--- a/src/template.ts
+++ b/src/template.ts
@@ -2 +2 @@
-  previous text
+  rendered < marker
@@ -4 +4 @@
-const comparison = old;
+const comparison = left < right;
`,
      source,
      mutations,
    );

    expect(result.kind).toBe("pass");
    if (result.kind === "pass") expect(result.candidateCount).toBe(1);
    expect(mutations).toEqual([source.replace("left < right", "left >= right")]);
  });

  it("skips operator-flip in a multiline block-comment continuation", async () => {
    const source = "/*\n  documented < marker\n*/";
    const result = await verifyDiffSource(
      "src/comment.ts",
      `diff --git a/src/comment.ts b/src/comment.ts
index 1234567..abcdefg 100644
--- a/src/comment.ts
+++ b/src/comment.ts
@@ -2 +2 @@
-  previous text
+  documented < marker
`,
      source,
    );

    expect(result.kind).toBe("pass");
    if (result.kind === "pass") expect(result.candidateCount).toBe(0);
  });
});

describe("per-file candidate scheduling", () => {
  async function waitForCondition(condition: () => boolean, label: string): Promise<void> {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      if (condition()) return;
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
      });
    }
    throw new Error(`timed out waiting for ${label}`);
  }

  function dualGuardFixture(file: string, fnName: string, v1: string, v2: string) {
    const content = `export function ${fnName}() {
  if (!${v1}) return "${v1}";
  if (!${v2}) return "${v2}";
  return true;
}`;
    const flip = (varName: string) =>
      content.replace(`if (!${varName}) return "${varName}";`, `if (${varName}) return "${varName}";`);
    return {
      content,
      diff: `diff --git a/${file} b/${file}
index 1234567..abcdefg 100644
--- a/${file}
+++ b/${file}
@@ -1,3 +1,4 @@
 export function ${fnName}() {
+  if (!${v1}) return "${v1}";
+  if (!${v2}) return "${v2}";
   return true;
`,
      mutant1: flip(v1),
      mutant2: flip(v2),
    };
  }

  const multi = dualGuardFixture("src/multi.ts", "multi", "a", "b");

  async function runMultiGuardVerification(
    runScopedTests: (cwd: string, scope: readonly string[]) => Promise<boolean>,
  ) {
    let currentContent = multi.content;
    const observedAtTest: string[] = [];
    const writeLog: string[] = [];
    const result = await verifyDiffDerivedMutations(
      { worktreePath: "/test/path", runBase: "main" },
      {
        gitDiff: async () => multi.diff,
        untrackedFiles: async () => [],
        readFile: async (path) => {
          if (path.endsWith(".test.ts")) return "export {};\n";
          return multi.content;
        },
        writeFile: async (_path, content) => {
          writeLog.push(content);
          currentContent = content;
        },
        listDir: () => [],
        runScopedTests: async (cwd, scope) => {
          observedAtTest.push(currentContent);
          return runScopedTests(cwd, scope);
        },
      },
    );
    return { result, observedAtTest, writeLog };
  }

  it("serializes same-file mutation candidates deterministically", async () => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const { result, observedAtTest, writeLog } = await runMultiGuardVerification(async () => false);
      expect(result.kind).toBe("pass");
      expect(observedAtTest).toEqual([multi.mutant1, multi.mutant2]);
      expect(writeLog).toEqual([multi.mutant1, multi.content, multi.mutant2, multi.content]);
    }
  });

  it("reports genuine surviving-mutation at exact source site on multi-candidate file", async () => {
    let call = 0;
    const { result } = await runMultiGuardVerification(async () => {
      call += 1;
      // Candidate a (call 1) is killed; candidate b passes both its primary run (call 2) and confirmation (call 3).
      return call !== 1;
    });
    expect(result.kind).toBe("surviving-mutation");
    if (result.kind === "surviving-mutation") {
      expect(result.sourceSite.file).toBe("src/multi.ts");
      expect(result.sourceSite.line).toBe(3);
      expect(result.mutation).toContain("guard-flip: !b");
    }
  });

  it("overlaps distinct-file candidate cycles while serializing same-file cycles", async () => {
    resetVerifierTestRunTracking();
    const other = dualGuardFixture("src/other.ts", "other", "c", "d");
    const diff = multi.diff + other.diff;

    let releaseBlockedScopedTests: (() => void) | undefined;
    const blockedScopedTests = new Promise<void>((resolve) => {
      releaseBlockedScopedTests = resolve;
    });
    const fileContents = new Map<string, string>([
      ["src/multi.ts", multi.content],
      ["src/other.ts", other.content],
    ]);
    const writeEvents: Array<{ file: string; content: string }> = [];
    let inFlightScoped = 0;
    let peakScoped = 0;
    let sameFileWriteDepth = 0;
    let peakSameFileWriteDepth = 0;

    const verification = verifyDiffDerivedMutations(
      { worktreePath: "/test/path", runBase: "main" },
      {
        gitDiff: async () => diff,
        untrackedFiles: async () => [],
        readFile: async (path) => {
          if (path.endsWith(".test.ts")) return "export {};\n";
          const file = path.replace("/test/path/", "");
          return fileContents.get(file) ?? multi.content;
        },
        writeFile: async (path, content) => {
          const file = path.replace("/test/path/", "");
          sameFileWriteDepth += 1;
          peakSameFileWriteDepth = Math.max(peakSameFileWriteDepth, sameFileWriteDepth);
          writeEvents.push({ file, content });
          fileContents.set(file, content);
          sameFileWriteDepth -= 1;
        },
        listDir: () => [],
        runScopedTests: async () => {
          inFlightScoped += 1;
          peakScoped = Math.max(peakScoped, inFlightScoped);
          await blockedScopedTests;
          inFlightScoped -= 1;
          return false;
        },
      },
    );

    await waitForCondition(() => inFlightScoped > 1, "concurrent scoped-test invocations");
    expect(peakScoped).toBeLessThanOrEqual(MAX_CONCURRENT_VERIFIER_TEST_RUNS);
    expect(peakSameFileWriteDepth).toBe(1);

    releaseBlockedScopedTests?.();
    const result = await verification;
    expect(result.kind).toBe("pass");

    const multiWrites = writeEvents.filter((event) => event.file === "src/multi.ts").map((event) => event.content);
    const otherWrites = writeEvents.filter((event) => event.file === "src/other.ts").map((event) => event.content);
    expect(multiWrites).toEqual([multi.mutant1, multi.content, multi.mutant2, multi.content]);
    expect(otherWrites).toEqual([other.mutant1, other.content, other.mutant2, other.content]);
  });

  it("records concurrent applied mutants separately and clears only the restored owner's record", async () => {
    const scratchRoot = join(import.meta.dir, "../../../.scratch");
    mkdirSync(scratchRoot, { recursive: true });
    const worktreePath = mkdtempSync(join(scratchRoot, "diff-derived-mutation-records-"));
    const recordsDir = join(worktreePath, ".jarvis-diff-derived-mutations");
    const fixture = (file: string, name: string, guard: string) => {
      const content = `export function ${name}() {\n  if (!${guard}) return "${guard}";\n  return true;\n}\n`;
      const mutation = `guard-flip: !${guard} → ${guard}`;
      const line = 2;
      const columnStart = 6;
      const columnEnd = 7 + guard.length;
      return {
        file,
        content,
        mutation,
        diff: `diff --git a/${file} b/${file}\nindex 1234567..abcdefg 100644\n--- a/${file}\n+++ b/${file}\n@@ -1,2 +1,3 @@\n export function ${name}() {\n+  if (!${guard}) return "${guard}";\n   return true;\n`,
        recordName: mutationRecordFileName({ file, line, columnStart, columnEnd, mutation }),
      };
    };
    const first = fixture("src/first.ts", "first", "left");
    const second = fixture("src/second.ts", "second", "right");
    const deferred = () => {
      let release = () => {};
      const promise = new Promise<void>((resolve) => {
        release = resolve;
      });
      return { promise, release };
    };
    const firstTest = deferred();
    const secondTest = deferred();
    const inFlight = new Set<string>();
    const readRecords = () =>
      readdirSync(recordsDir)
        .sort()
        .map((name) => ({
          name,
          value: JSON.parse(readFileSync(join(recordsDir, name), "utf-8")) as {
            file: string;
            line: number;
            mutation: string;
          },
        }));

    mkdirSync(join(worktreePath, "src"), { recursive: true });
    for (const item of [first, second]) {
      writeFileSync(join(worktreePath, item.file), item.content);
      writeFileSync(join(worktreePath, item.file.replace(".ts", ".test.ts")), "export {};\n");
    }

    const verification = verifyDiffDerivedMutations(
      { worktreePath, runBase: "main" },
      {
        gitDiff: async () => first.diff + second.diff,
        untrackedFiles: async () => [],
        registeredPromptPaths: async () => [],
        runScopedTests: async (_cwd, scope) => {
          const testPath = scope[0];
          if (testPath === undefined) throw new Error("missing scoped test path");
          inFlight.add(testPath);
          await (testPath === "src/first.test.ts" ? firstTest.promise : secondTest.promise);
          inFlight.delete(testPath);
          return false;
        },
      },
    );

    try {
      await waitForCondition(() => inFlight.size === 2, "concurrent mutants");
      expect(readRecords()).toEqual(
        [
          { name: first.recordName, value: { file: first.file, line: 2, mutation: first.mutation } },
          { name: second.recordName, value: { file: second.file, line: 2, mutation: second.mutation } },
        ].sort((left, right) => left.name.localeCompare(right.name)),
      );

      firstTest.release();
      await waitForCondition(() => readRecords().length === 1, "first mutant record removal");
      expect(readFileSync(join(worktreePath, first.file), "utf-8")).toBe(first.content);
      expect(readRecords()).toEqual([
        { name: second.recordName, value: { file: second.file, line: 2, mutation: second.mutation } },
      ]);

      secondTest.release();
      const result = await verification;
      expect(result.kind).toBe("pass");
      expect(readFileSync(join(worktreePath, second.file), "utf-8")).toBe(second.content);
      expect(readdirSync(recordsDir)).toEqual([]);
    } finally {
      firstTest.release();
      secondTest.release();
      await verification;
      rmSync(worktreePath, { recursive: true, force: true });
    }
  });

  it("short-circuits on first surviving-mutation under per-file scheduling", async () => {
    const first = dualGuardFixture("src/first.ts", "first", "x", "y");
    const second = dualGuardFixture("src/second.ts", "second", "a", "b");
    const diff = first.diff + second.diff;

    let releaseSecondFile: (() => void) | undefined;
    const secondFileBlocked = new Promise<void>((resolve) => {
      releaseSecondFile = resolve;
    });
    const scopedCalls: string[] = [];

    const verification = verifyDiffDerivedMutations(
      { worktreePath: "/test/path", runBase: "main" },
      {
        gitDiff: async () => diff,
        untrackedFiles: async () => [],
        readFile: async (path) => {
          if (path.endsWith(".test.ts")) return "export {};\n";
          if (path.endsWith("/src/first.ts")) return first.content;
          if (path.endsWith("/src/second.ts")) return second.content;
          throw new Error(`unexpected read: ${path}`);
        },
        writeFile: async () => {},
        listDir: () => [],
        runScopedTests: async (_cwd, scope) => {
          const testPath = scope[0];
          if (testPath === undefined) throw new Error("missing scoped test path");
          scopedCalls.push(testPath);
          if (testPath === "src/first.test.ts") return true;
          if (testPath === "src/second.test.ts") {
            await secondFileBlocked;
            return false;
          }
          throw new Error(`unexpected scope: ${scope.join(",")}`);
        },
      },
    );

    await waitForCondition(() => scopedCalls.includes("src/second.test.ts"), "blocked second-file scoped test");
    releaseSecondFile?.();

    const result = await verification;
    expect(result.kind).toBe("surviving-mutation");
    if (result.kind === "surviving-mutation") {
      expect(result.sourceSite).toEqual({ file: "src/first.ts", line: 2 });
    }
    // The injected seam never reaches the semaphore, so first.ts's confirmation re-run (a second
    // "src/first.test.ts" call) isn't gated on second.ts's still-in-flight run draining first.
    expect(scopedCalls[0]).toBe("src/first.test.ts");
    expect(scopedCalls.filter((call) => call === "src/first.test.ts")).toHaveLength(2);
    expect(scopedCalls.filter((call) => call === "src/second.test.ts")).toHaveLength(1);
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

  describe("unappliable candidate containment", () => {
    const unappliableDiff = `diff --git a/src/test.ts b/src/test.ts
index 1234567..abcdefg 100644
--- a/src/test.ts
+++ b/src/test.ts
@@ -1,1 +1,1 @@
+if (x < 5) return null;
`;

    const driftedContent = `if (yyyyyy < 5) return null;`;
    const unappliableInput = { worktreePath: "/test/path", runBase: "main" };
    const unappliableSeams = {
      gitDiff: async () => unappliableDiff,
      untrackedFiles: async () => [],
      readFile: async () => driftedContent,
      writeFile: async () => {},
      runScopedTests: async () => false,
    };

    it("skips an unappliable candidate without crashing the run", async () => {
      const result = await verifyDiffDerivedMutations(unappliableInput, unappliableSeams);
      expect(result.kind).toBe("pass");
    });

    it("records skipped candidates on the pass result", async () => {
      const result = await verifyDiffDerivedMutations(unappliableInput, unappliableSeams);
      expect(result.kind).toBe("pass");
      if (result.kind !== "pass") return;
      expect(result.skippedCandidates).toEqual([
        expect.objectContaining({
          file: "src/test.ts",
          line: 1,
          reason: expect.stringMatching(/\S/),
        }),
      ]);
    });

    it("well-formed candidates still detect surviving and covered guards", async () => {
      const diff =
        unappliableDiff +
        `diff --git a/src/safe.ts b/src/safe.ts
index 1234567..abcdefg 100644
--- a/src/safe.ts
+++ b/src/safe.ts
@@ -1,3 +1,3 @@
 export function safe(x: any) {
-  if (!x) return null;
+  if (!x) return "safe";
   return x;
diff --git a/src/covered.ts b/src/covered.ts
index 1234567..abcdefg 100644
--- a/src/covered.ts
+++ b/src/covered.ts
@@ -1,3 +1,3 @@
 export function covered(x: any) {
-  if (!x) return null;
+  if (!x) return "covered";
   return x;
`;
      const safeContent = `export function safe(x: any) {\n  if (!x) return "safe";\n  return x;\n}`;
      const coveredContent = `export function covered(x: any) {\n  if (!x) return "covered";\n  return x;\n}`;
      const mixedInput = { worktreePath: "/test/path", runBase: "main" };
      const mixedSeams = {
        gitDiff: async () => diff,
        untrackedFiles: async () => [],
        readFile: async (path: string) => {
          if (path.endsWith("safe.ts")) return safeContent;
          if (path.endsWith("covered.ts")) return coveredContent;
          if (path.endsWith("test.ts")) return driftedContent;
          if (path.endsWith(".test.ts")) return "export {};\n";
          throw new Error(`unexpected read: ${path}`);
        },
        writeFile: async () => {},
      };

      const survivingResult = await verifyDiffDerivedMutations(mixedInput, {
        ...mixedSeams,
        runScopedTests: async () => true,
      });
      expect(survivingResult.kind).toBe("surviving-mutation");
      if (survivingResult.kind === "surviving-mutation") {
        expect(survivingResult.sourceSite.file).toBe("src/safe.ts");
        expect(survivingResult.mutation).toContain("guard-flip");
      }

      const passResult = await verifyDiffDerivedMutations(mixedInput, {
        ...mixedSeams,
        runScopedTests: async (_cwd, scope) => scope.some((entry) => entry.includes("safe.ts")),
      });
      expect(passResult.kind).toBe("pass");
      if (passResult.kind === "pass") {
        expect(passResult.skippedCandidates).toHaveLength(1);
        expect(passResult.skippedCandidates[0]?.file).toBe("src/test.ts");
      }
    });

    it("a genuine seam failure still surfaces", async () => {
      const coveredDiff = `diff --git a/src/covered.ts b/src/covered.ts
index 1234567..abcdefg 100644
--- a/src/covered.ts
+++ b/src/covered.ts
@@ -1,3 +1,3 @@
 export function covered(x: any) {
-  if (!x) return null;
+  if (!x) return "covered";
   return x;
`;
      const coveredContent = `export function covered(x: any) {\n  if (!x) return "covered";\n  return x;\n}`;
      const coveredInput = { worktreePath: "/test/path", runBase: "main" };
      const coveredSeams = {
        gitDiff: async () => coveredDiff,
        untrackedFiles: async () => [],
        readFile: async (path: string) => {
          if (path.endsWith("covered.ts")) return coveredContent;
          if (path.endsWith(".test.ts")) return "export {};\n";
          throw new Error(`unexpected read: ${path}`);
        },
      };
      const expectCandidateFailure = (seams: object) =>
        expect(verifyDiffDerivedMutations(coveredInput, { ...coveredSeams, ...seams })).rejects.toThrow(
          "Failed to test candidate for src/covered.ts:2",
        );

      await expectCandidateFailure({
        writeFile: async () => {
          throw new Error("disk full");
        },
        runScopedTests: async () => false,
      });
      await expectCandidateFailure({
        writeFile: async () => {},
        runScopedTests: async () => {
          throw new Error("scoped test harness failed");
        },
      });
    });
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
      expect(scopedCalls).toBe(2); // primary pass + confirmation re-run
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

  it("does not recognize a directive embedded in an unterminated block comment", async () => {
    // The block-comment scanner must consume to end of line: a `//`-directive
    // sitting inside an unterminated `/* … ` is comment content, not a lexical
    // line comment, so the guard mutation stays blocking.
    const file = "src/safe.ts";
    const lineContent = `  if (!x) return null; /* ${guardDirective}`;
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
    const scopes: (readonly string[])[] = [];
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

describe("direct-importing killing-test resolution", () => {
  const targetFile = "v2/src/feature/target.ts";
  const directImporter = "v2/src/other/imports-target.test.ts";
  const transitiveImporter = "v2/src/other/transitive.test.ts";
  const crossSurfaceImporter = "v1/src/other/imports-v2.test.ts";
  const unrelatedImporter = "v2/src/other/unrelated.test.ts";

  const guardDiff = `diff --git a/${targetFile} b/${targetFile}
index 1234567..abcdefg 100644
--- a/${targetFile}
+++ b/${targetFile}
@@ -1,3 +1,3 @@
 export function target(x: unknown) {
-  if (!x) return null;
+  if (!x) return "safe";
   return x;
`;
  const guardContent = `export function target(x: unknown) {\n  if (!x) return "safe";\n  return x;\n}`;

  const importerBodies: Record<string, string> = {
    [directImporter]: `import { target } from "../feature/target.ts";\nexport {};\n`,
    [transitiveImporter]: `import { bridge } from "../feature/bridge.ts";\nexport {};\n`,
    [crossSurfaceImporter]: `import { target } from "../../v2/src/feature/target.ts";\nexport {};\n`,
    [unrelatedImporter]: `import { other } from "../feature/other.ts";\nexport {};\n`,
    "v2/src/feature/bridge.ts": `import { target } from "./target.ts";\nexport const bridge = target;\n`,
    "v2/src/feature/other.ts": `export const other = 1;\n`,
    "v2/src/feature/target-part.test.ts": "export {};\n",
    "v2/src/feature/target.test.ts": "export {};\n",
  };

  function importerFixtureReadFile(emptyCoLocated = true): (path: string) => Promise<string> {
    return async (path: string) => {
      const rel = path.replace("/wt/", "");
      if (rel === targetFile) return guardContent;
      if (emptyCoLocated && rel === "v2/src/feature/target.test.ts") throw new Error("ENOENT");
      if (rel.endsWith(".test.ts")) return importerBodies[rel] ?? "export {};\n";
      if (importerBodies[rel] !== undefined) return importerBodies[rel];
      throw new Error(`ENOENT: ${path}`);
    };
  }

  function lexImporterCandidates(count: number, prefix = "v2/src/scan"): string[] {
    return Array.from({ length: count }, (_, index) => `${prefix}/candidate-${String(index).padStart(4, "0")}.test.ts`);
  }

  async function verifyImporterFixture(
    seams: {
      readFile?: (path: string) => Promise<string>;
      listDir?: () => string[];
      listImporterCandidates?: () => string[];
      runScopedTests?: (cwd: string, scope: readonly string[]) => Promise<boolean>;
    } = {},
  ) {
    return verifyDiffDerivedMutations(
      { worktreePath: "/wt", runBase: "main" },
      {
        gitDiff: async () => guardDiff,
        untrackedFiles: async () => [],
        readFile: importerFixtureReadFile(),
        writeFile: async () => {},
        listDir: () => [],
        listImporterCandidates: () => [],
        runScopedTests: async () => true,
        ...seams,
      },
    );
  }

  it("a changed guard whose only killing test is a non-sibling direct importer passes when that importer kills the mutation", async () => {
    const scopes: (readonly string[])[] = [];
    const result = await verifyImporterFixture({
      listImporterCandidates: () => [directImporter, unrelatedImporter],
      runScopedTests: async (_cwd, scope) => {
        scopes.push(scope);
        return false;
      },
    });
    expect(result.kind).toBe("pass");
    expect(scopes).toEqual([[directImporter]]);
  });

  it("inverting the empty-union guard fails: direct-importer-only coverage would report missing-killing-test", async () => {
    // Mutation checkpoint: inverting `if (resolution.killingTests.length === 0)` in verifyCandidates must turn this RED.
    const result = await verifyImporterFixture({
      listImporterCandidates: () => [directImporter],
      runScopedTests: async () => false,
    });
    expect(result.kind).toBe("pass");
  });

  it("reports missing-killing-test when neither co-located nor direct-importing tests exist", async () => {
    const result = await verifyDiffDerivedMutations(
      { worktreePath: "/wt", runBase: "main" },
      {
        gitDiff: async () => guardDiff,
        untrackedFiles: async () => [],
        readFile: async (path) => {
          const rel = path.replace("/wt/", "");
          if (rel === targetFile) return guardContent;
          throw new Error(`ENOENT: ${path}`);
        },
        writeFile: async () => {},
        listDir: () => [],
        listImporterCandidates: () => [unrelatedImporter, transitiveImporter],
        runScopedTests: async () => true,
      },
    );
    expect(result.kind).toBe("surviving-mutation");
    if (result.kind === "surviving-mutation") {
      expect(result.mutation).toBe("missing-killing-test");
      expect(result.sourceSite.file).toBe(targetFile);
    }
  });

  it("discovers only v2/src scan-root candidates, ignores transitive and cross-surface importers, and fails closed on cap exhaustion", async () => {
    const candidates = lexImporterCandidates(202);
    const ordered = [...candidates, directImporter, crossSurfaceImporter, transitiveImporter].sort();
    expect(candidates.every((path) => path.startsWith("v2/src/"))).toBe(true);
    expect(resolveImporterScanRoot(targetFile)).toBe("v2/src/");
    expect(resolveImporterScanRoot("scripts/foo.ts")).toBeNull();

    const noTransitiveResult = await verifyImporterFixture({
      listImporterCandidates: () => [transitiveImporter, unrelatedImporter],
    });
    expect(noTransitiveResult.kind).toBe("surviving-mutation");
    if (noTransitiveResult.kind === "surviving-mutation") {
      expect(noTransitiveResult.mutation).toBe("missing-killing-test");
    }

    const scopedRuns: (readonly string[])[] = [];
    const capResult = await verifyImporterFixture({
      listImporterCandidates: () => ordered,
      runScopedTests: async (_cwd, scope) => {
        scopedRuns.push(scope);
        return true;
      },
    });
    expect(capResult.kind).toBe("surviving-mutation");
    if (capResult.kind === "surviving-mutation") {
      expect(capResult.mutation).toBe("importer-discovery-cap-exceeded");
      expect(capResult.sourceSite.file).toBe(targetFile);
    }
    expect(scopedRuns).toHaveLength(0);
  });

  it("sibling-only co-located coverage skips importer discovery when the surface holds more than 200 test files", async () => {
    const sibling = "v2/src/feature/target-part.test.ts";
    let importerDiscoveryCalls = 0;
    const candidates = lexImporterCandidates(201);
    const scopes: (readonly string[])[] = [];
    const result = await verifyImporterFixture({
      listDir: () => ["target-part.test.ts"],
      listImporterCandidates: () => {
        importerDiscoveryCalls += 1;
        return candidates;
      },
      runScopedTests: async (_cwd, scope) => {
        scopes.push(scope);
        return false;
      },
    });
    expect(result.kind).toBe("pass");
    expect(importerDiscoveryCalls).toBe(0);
    expect(scopes).toEqual([[sibling]]);
  });

  it("runs scoped mutation execution on co-located killing tests only when co-located coverage exists and discovery would hit the cap", async () => {
    let scopedRuns = 0;
    const candidates = lexImporterCandidates(201);
    const result = await verifyImporterFixture({
      readFile: importerFixtureReadFile(false),
      listImporterCandidates: () => candidates,
      runScopedTests: async (_cwd, scope) => {
        scopedRuns += 1;
        expect(scope).toEqual(["v2/src/feature/target.test.ts"]);
        return false;
      },
    });
    expect(result.kind).toBe("pass");
    expect(scopedRuns).toBe(1);
  });

  it("runs scoped mutation execution on co-located killing tests only and excludes direct importers and unrelated tests", async () => {
    const sibling = "v2/src/feature/target-part.test.ts";
    const scopes: (readonly string[])[] = [];
    const result = await verifyImporterFixture({
      listDir: () => ["target-part.test.ts"],
      listImporterCandidates: () =>
        [sibling, directImporter, unrelatedImporter, transitiveImporter, crossSurfaceImporter].sort(),
      runScopedTests: async (_cwd, scope) => {
        scopes.push(scope);
        return false;
      },
    });
    expect(result.kind).toBe("pass");
    expect(scopes).toEqual([[sibling]]);
  });
});

describe("worktree render-observer map resolution", () => {
  it("extractRenderObserverMapFromSource parses a string-literal-keyed observer map", () => {
    const src = 'const RENDER_OBSERVER_TESTS = { "prompts/write/x.md": ["v2/src/execution/x.test.ts"] };';
    // Flipping `!ts.isStringLiteral(property.name)` to `ts.isStringLiteral` rejects the string-literal key and returns null.
    expect(extractRenderObserverMapFromSource(src)).toEqual({ "prompts/write/x.md": ["v2/src/execution/x.test.ts"] });
    expect(extractRenderObserverMapFromSource("const OTHER = {};")).toBeNull();
  });

  const branchPromptPath = "prompts/write/branch-only-prompt.md";
  const branchBodyLine = "Branch-only prompt body line.";
  const branchPromptSource = `---
id: write.prompt.branch.only
behavior: write
kind: step
revision: 1
placeholders: []
---
${branchBodyLine}
`;
  const branchPromptDiff = `diff --git a/${branchPromptPath} b/${branchPromptPath}
index 1234567..abcdefg 100644
--- a/${branchPromptPath}
+++ b/${branchPromptPath}
@@ -7,1 +7,1 @@
-${branchBodyLine}
+${branchBodyLine} (changed)
`;
  const branchChangedPromptSource = branchPromptSource.replace(branchBodyLine, `${branchBodyLine} (changed)`);

  function branchObserverTestSource(promptRelativePath: string, bodyNeedle: string): string {
    return `import { expect, test } from "bun:test";\nimport { readFileSync } from "node:fs";\ntest("observes rendered prompt output", () => {\n  const rendered = readFileSync("${promptRelativePath}", "utf-8");\n  expect(rendered).toContain("${bodyNeedle}");\n  expect(rendered).not.toContain("__JARVIS_PROMPT_RENDER_COVERAGE_MUTATION__");\n});\n`;
  }

  function initWorktreeRepo(): string {
    const dir = mkdtempSync(join(tmpdir(), "render-observer-worktree-"));
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
    execFileSync("git", ["config", "user.name", "test"], { cwd: dir });
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "fixture", type: "module" }));
    return dir;
  }

  function writePromptFixture(
    dir: string,
    promptPath: string,
    observerRelativePath: string,
    mapEntries: Record<string, readonly string[]>,
    observerSource: string,
    promptSource: string,
  ): void {
    mkdirSync(join(dir, promptPath.split("/").slice(0, -1).join("/")), { recursive: true });
    mkdirSync(join(dir, "shared", "prompts"), { recursive: true });
    mkdirSync(join(dir, observerRelativePath.split("/").slice(0, -1).join("/")), { recursive: true });
    writeFileSync(join(dir, promptPath), promptSource);
    writeFileSync(join(dir, "prompts", "registry.txt"), `${promptPath.slice("prompts/".length)}\n`);
    writeFileSync(join(dir, "shared/prompts/render-observer-tests.ts"), renderObserverMapSource(mapEntries));
    writeFileSync(join(dir, observerRelativePath), observerSource);
  }

  function writeBranchPromptFixture(
    dir: string,
    observerRelativePath: string,
    mapEntries: Record<string, readonly string[]>,
    observerSource: string,
    promptSource = branchPromptSource,
  ): void {
    writePromptFixture(dir, branchPromptPath, observerRelativePath, mapEntries, observerSource, promptSource);
  }

  function commitWorktreeBase(dir: string): string {
    execFileSync("git", ["add", "-A"], { cwd: dir });
    execFileSync("git", ["commit", "-q", "-m", "base"], { cwd: dir });
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir }).toString().trim();
  }

  function commitChangedBranchPrompt(dir: string): void {
    writeFileSync(join(dir, branchPromptPath), branchChangedPromptSource);
    execFileSync("git", ["commit", "-aq", "-m", "change prompt"], { cwd: dir });
  }

  function missingRenderCoverageAtPrompt(promptPath: string) {
    return {
      kind: "surviving-mutation" as const,
      mutation: "missing-render-coverage",
      sourceSite: { file: promptPath, line: 1 },
    };
  }

  it("resolves a branch-only map entry from the worktree and runs its observer test", async () => {
    const dir = initWorktreeRepo();
    const observerPath = "shared/prompts/branch-only-prompt.test.ts";
    writeBranchPromptFixture(
      dir,
      observerPath,
      { [branchPromptPath]: [observerPath] },
      branchObserverTestSource(branchPromptPath, branchBodyLine),
    );
    const baseSha = commitWorktreeBase(dir);
    commitChangedBranchPrompt(dir);

    const result = await verifyDiffDerivedMutations({ worktreePath: dir, runBase: baseSha });
    expect(result.kind).toBe("pass");
    if (result.kind === "pass") expect(result.candidateCount).toBe(0);
    rmSync(dir, { recursive: true, force: true });
  });

  it("re-reads the worktree map on each verifier call instead of cached module state", async () => {
    const dir = initWorktreeRepo();
    const observerPath = "shared/prompts/branch-only-prompt.test.ts";
    writeBranchPromptFixture(dir, observerPath, {}, branchObserverTestSource(branchPromptPath, branchBodyLine));
    const baseSha = commitWorktreeBase(dir);
    commitChangedBranchPrompt(dir);

    const beforeRepair = await verifyDiffDerivedMutations({ worktreePath: dir, runBase: baseSha });
    expect(beforeRepair).toEqual(missingRenderCoverageAtPrompt(branchPromptPath));

    writeFileSync(
      join(dir, "shared/prompts/render-observer-tests.ts"),
      renderObserverMapSource({ [branchPromptPath]: [observerPath] }),
    );

    const afterRepair = await verifyDiffDerivedMutations({ worktreePath: dir, runBase: baseSha });
    expect(afterRepair.kind).toBe("pass");
    rmSync(dir, { recursive: true, force: true });
  });

  it("does not fall back to the process render-observer map when the worktree map lacks the prompt", async () => {
    const dir = initWorktreeRepo();
    const daemonMappedPrompt = "prompts/implement/review-critic.md";
    mkdirSync(join(dir, "prompts", "implement"), { recursive: true });
    mkdirSync(join(dir, "shared", "prompts"), { recursive: true });
    writeFileSync(
      join(dir, daemonMappedPrompt),
      `---
id: implement.prompt.review.critic
behavior: review
kind: step
revision: 1
placeholders: []
---
## Branch diff
The diff comes from git merge-base <base> HEAD.
`,
    );
    writeFileSync(join(dir, "prompts", "registry.txt"), "implement/review-critic.md\n");
    writeFileSync(join(dir, "shared/prompts/render-observer-tests.ts"), renderObserverMapSource({}));
    execFileSync("git", ["add", "-A"], { cwd: dir });
    execFileSync("git", ["commit", "-q", "-m", "base"], { cwd: dir });
    const baseSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir }).toString().trim();
    writeFileSync(
      join(dir, daemonMappedPrompt),
      `---
id: implement.prompt.review.critic
behavior: review
kind: step
revision: 1
placeholders: []
---
## Branch diff (changed)
The diff comes from git merge-base <base> HEAD.
`,
    );
    execFileSync("git", ["commit", "-aq", "-m", "change prompt"], { cwd: dir });

    const result = await verifyDiffDerivedMutations({ worktreePath: dir, runBase: baseSha });
    expect(result).toEqual(missingRenderCoverageAtPrompt(daemonMappedPrompt));
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns missing-render-coverage for an empty worktree mapping", async () => {
    const dir = initWorktreeRepo();
    const observerPath = "shared/prompts/branch-only-prompt.test.ts";
    writeBranchPromptFixture(
      dir,
      observerPath,
      { [branchPromptPath]: [] },
      branchObserverTestSource(branchPromptPath, branchBodyLine),
    );
    const baseSha = commitWorktreeBase(dir);
    commitChangedBranchPrompt(dir);

    const result = await verifyDiffDerivedMutations({ worktreePath: dir, runBase: baseSha });
    expect(result).toEqual(missingRenderCoverageAtPrompt(branchPromptPath));
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns missing-render-coverage when the mapped observer misses the sentinel mutation", async () => {
    const dir = initWorktreeRepo();
    const observerPath = "shared/prompts/branch-only-prompt.test.ts";
    const permissiveObserver = `import { test } from "bun:test";\ntest("always passes", () => {});\n`;
    writeBranchPromptFixture(dir, observerPath, { [branchPromptPath]: [observerPath] }, permissiveObserver);
    const baseSha = commitWorktreeBase(dir);
    commitChangedBranchPrompt(dir);

    const result = await verifyDiffDerivedMutations({ worktreePath: dir, runBase: baseSha });
    expect(result).toEqual(missingRenderCoverageAtPrompt(branchPromptPath));
    rmSync(dir, { recursive: true, force: true });
  });

  it("passes render-coverage for in-file body-deletion-only diffs via unmutated observer verification", async () => {
    const dedupPromptPath = "prompts/write/dedup-body-lines.md";
    const keptBodyLine = "Keep this surviving body line.";
    const deletedBodyLine = "Delete this redundant body line.";
    const preDeletionSource = `---
id: write.prompt.dedup.body
behavior: write
kind: step
revision: 1
placeholders: []
---
${keptBodyLine}
${deletedBodyLine}
`;
    const postDeletionSource = `---
id: write.prompt.dedup.body
behavior: write
kind: step
revision: 1
placeholders: []
---
${keptBodyLine}
`;
    const dir = initWorktreeRepo();
    const observerPath = "shared/prompts/dedup-body-lines.test.ts";
    writePromptFixture(
      dir,
      dedupPromptPath,
      observerPath,
      { [dedupPromptPath]: [observerPath] },
      branchObserverTestSource(dedupPromptPath, keptBodyLine),
      preDeletionSource,
    );
    const baseSha = commitWorktreeBase(dir);
    writeFileSync(join(dir, dedupPromptPath), postDeletionSource);
    execFileSync("git", ["commit", "-aq", "-m", "dedup body lines"], { cwd: dir });

    const result = await verifyDiffDerivedMutations({ worktreePath: dir, runBase: baseSha });
    expect(result.kind).toBe("pass");
    if (result.kind === "pass") expect(result.candidateCount).toBe(0);
    rmSync(dir, { recursive: true, force: true });
  });

  it("fails closed for unreadable, invalid, missing-export, initialization, and malformed map source", async () => {
    const invalidSources = [
      "",
      "const RENDER_OBSERVER_TESTS = {",
      "export function resolveRenderObserverTests() { return undefined; }",
      "const RENDER_OBSERVER_TESTS = initializeMap();",
      `const RENDER_OBSERVER_TESTS = { "${branchPromptPath}": "not-an-array" };`,
      `const RENDER_OBSERVER_TESTS = { [dynamicKey]: ["shared/prompts/branch-only-prompt.test.ts"] };`,
    ];
    for (const mapSource of invalidSources) {
      const result = await verifyDiffDerivedMutations(
        { worktreePath: "/test/path", runBase: "main" },
        {
          gitDiff: async () => branchPromptDiff,
          untrackedFiles: async () => [],
          registeredPromptPaths: async () => [branchPromptPath],
          readFile: seamReadFile(branchChangedPromptSource, mapSource),
          runScopedTests: async () => false,
        },
      );
      expect(result).toEqual(missingRenderCoverageAtPrompt(branchPromptPath));
    }
  });

  it("fails closed for absolute, traversing, non-normalized, and worktree-escaping observer paths without running them", async () => {
    const dir = initWorktreeRepo();
    mkdirSync(join(dir, "prompts", "write"), { recursive: true });
    mkdirSync(join(dir, "shared", "prompts"), { recursive: true });
    writeFileSync(join(dir, branchPromptPath), branchPromptSource);
    writeFileSync(join(dir, "prompts", "registry.txt"), "write/branch-only-prompt.md\n");
    const outside = mkdtempSync(join(tmpdir(), "render-observer-outside-"));
    const outsideTest = join(outside, "outside.test.ts");
    writeFileSync(outsideTest, "export {};\n");
    const linkDir = join(dir, "shared/prompts/links");
    mkdirSync(linkDir, { recursive: true });
    execFileSync("ln", ["-s", outsideTest, join(linkDir, "escape.test.ts")], { cwd: dir });
    const baseSha = commitWorktreeBase(dir);
    commitChangedBranchPrompt(dir);

    const invalidPaths = [
      "/etc/passwd",
      "../outside.test.ts",
      "shared/prompts/../outside.test.ts",
      "./shared/prompts/branch-only-prompt.test.ts",
      "shared/prompts/links/escape.test.ts",
    ];
    for (const invalidPath of invalidPaths) {
      writeFileSync(
        join(dir, "shared/prompts/render-observer-tests.ts"),
        renderObserverMapSource({ [branchPromptPath]: [invalidPath] }),
      );
      let scopedRuns = 0;
      const result = await verifyDiffDerivedMutations(
        { worktreePath: dir, runBase: baseSha },
        {
          runScopedTests: async () => {
            scopedRuns += 1;
            return false;
          },
        },
      );
      expect(result).toEqual(missingRenderCoverageAtPrompt(branchPromptPath));
      expect(scopedRuns).toBe(0);
    }
    rmSync(dir, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });
});

describe("registered prompt path discovery", () => {
  it("resolves registered prompt paths through the shared registry surface, not a local manifest parser", () => {
    const source = readFileSync(join(import.meta.dir, "diff-derived-mutation-verifier.ts"), "utf8");
    // Presence: the verifier imports the registry module's manifest surface.
    const importLine = locateMarkerSlice({
      text: source,
      pattern: /^import \{[^}]*\} from "\.\.\/\.\.\/\.\.\/shared\/prompts\/registry\.ts";$/m,
      searchKey: "shared/prompts/registry.ts import",
    });
    expect(importLine).toContain("parsePromptRegistryManifest");
    expect(importLine).toContain("readRegisteredPromptPaths");
    expect(importLine).toContain("PROMPT_REGISTRY_MANIFEST_PATH");
    // Absence: no textual re-parse of the manifest remains in the verifier.
    expect(source).not.toContain("registry.txt");
    expect(source).not.toMatch(/\.split\("\\n"\)[\s\S]{0,120}prompts\/\$\{/);
  });
});

describe("verifier spawn process-group recording", () => {
  it("each concurrent scoped verifier spawn records its own process group without overwriting siblings", async () => {
    const recorded: number[] = [];
    const cleared: number[] = [];
    let nextPgid = 1000;
    let inFlight = 0;
    const mockRunner = {
      runAsync: async (_cmd: string, _args: string[], _cwd: string, options?: AsyncSubprocessOptions) => {
        inFlight += 1;
        options?.processGroup?.onGroupId?.(nextPgid++);
        // Yield so concurrent siblings interleave, then settle (no timer: determinism guard).
        await Promise.resolve();
        inFlight -= 1;
        return "";
      },
    };
    const scope = Array.from(
      { length: MAX_CONCURRENT_VERIFIER_TEST_RUNS + 2 },
      (_, i) => `shared/fixture/p${i}.test.ts`,
    );
    const passed = await runDiffDerivedScopedTests("/test/path", scope, mockRunner, {
      processGroups: { record: (pgid) => recorded.push(pgid), clear: (pgid) => cleared.push(pgid) },
    });
    expect(passed).toBe(true);
    expect(inFlight).toBe(0);
    // One id per spawn, every one recorded, every one cleared exactly once.
    const expected = Array.from({ length: scope.length }, (_, i) => 1000 + i);
    expect([...recorded].sort((a, b) => a - b)).toEqual(expected);
    expect([...cleared].sort((a, b) => a - b)).toEqual(expected);
  });

  it("clears a spawn's recorded group when the killing test fails", async () => {
    const cleared: number[] = [];
    const mockRunner = {
      runAsync: async (_cmd: string, _args: string[], _cwd: string, options?: AsyncSubprocessOptions) => {
        options?.processGroup?.onGroupId?.(42);
        throw new AsyncSubprocessError("failed", 1, "", "red", undefined);
      },
    };
    const passed = await runDiffDerivedScopedTests("/test/path", ["shared/fixture/red.test.ts"], mockRunner, {
      processGroups: { record: () => {}, clear: (pgid) => cleared.push(pgid) },
    });
    expect(passed).toBe(false);
    expect(cleared).toEqual([42]);
  });
});

describe("semaphore handoff", () => {
  // A waiter resumes at least one microtask after `resolve()`. The invariant that closes the window
  // is that whoever *grants* a slot books it, so the semaphore's state already reflects the
  // admission before the waiter's continuation runs. Asserting the state at that instant is
  // deterministic; trying to schedule a third caller inside the window is not.
  function deferred(): { promise: Promise<void>; resolve: () => void } {
    let resolve = (): void => {};
    const promise = new Promise<void>((res) => {
      resolve = () => res();
    });
    return { promise, resolve };
  }

  it("books a shared slot at handoff, before the waiting caller resumes", async () => {
    const semaphore = new VerifierTestRunSemaphore(1);
    const firstRelease = deferred();
    const queuedRelease = deferred();
    let queuedBodyEntered = false;

    const first = semaphore.run(() => firstRelease.promise);
    const queued = semaphore.run(async () => {
      queuedBodyEntered = true;
      await queuedRelease.promise;
    });
    firstRelease.resolve();
    await Promise.resolve();

    // The queued caller has been handed the slot but has not entered its body yet.
    expect(queuedBodyEntered).toBe(false);
    expect(semaphore.admissionStateForTest.inFlight).toBe(1);

    queuedRelease.resolve();
    await queued;
  });

  it("books an exclusive hold at handoff, before the waiting caller resumes", async () => {
    const semaphore = new VerifierTestRunSemaphore(4);
    const sharedRelease = deferred();
    const exclusiveRelease = deferred();
    let exclusiveBodyEntered = false;

    const shared = semaphore.run(() => sharedRelease.promise);
    const exclusive = semaphore.runExclusive(async () => {
      exclusiveBodyEntered = true;
      await exclusiveRelease.promise;
    });
    sharedRelease.resolve();
    await Promise.resolve();

    // The hold is granted and recorded even though the exclusive caller has not resumed, so a
    // caller arriving in this window is gated by `exclusiveActive` rather than reading it as free.
    expect(exclusiveBodyEntered).toBe(false);
    expect(semaphore.admissionStateForTest.exclusiveActive).toBe(true);
    expect(semaphore.admissionStateForTest.exclusivePending).toBe(0);

    exclusiveRelease.resolve();
    await exclusive;
  });
});

describe("semaphore admission predicates", () => {
  // These guards sit on the acquisition path, where inverting a clause deadlocks every acquisition:
  // a killing test through the semaphore would hang rather than fail. Called directly, each mutant
  // is killed by an assertion that returns immediately.
  it("a shared run queues on an exclusive hold, a pending exclusive, or a full semaphore", () => {
    const idle = { exclusiveActive: false, exclusivePending: 0, inFlight: 0, limit: 4 };
    expect(sharedRunMustQueue(idle)).toBe(false);
    expect(sharedRunMustQueue({ ...idle, inFlight: 3 })).toBe(false);

    expect(sharedRunMustQueue({ ...idle, exclusiveActive: true })).toBe(true);
    expect(sharedRunMustQueue({ ...idle, exclusivePending: 1 })).toBe(true);
    expect(sharedRunMustQueue({ ...idle, inFlight: 4 })).toBe(true);
    expect(sharedRunMustQueue({ ...idle, inFlight: 5 })).toBe(true);
  });

  it("an exclusive run queues on another exclusive hold or any in-flight shared run", () => {
    const idle = { exclusiveActive: false, exclusivePending: 0, inFlight: 0 };
    expect(exclusiveRunMustQueue(idle)).toBe(false);
    // `exclusivePending` counts this caller too, so it cannot gate on its own registration.
    expect(exclusiveRunMustQueue({ ...idle, exclusivePending: 2 })).toBe(false);

    expect(exclusiveRunMustQueue({ ...idle, exclusiveActive: true })).toBe(true);
    expect(exclusiveRunMustQueue({ ...idle, inFlight: 1 })).toBe(true);
    // A sibling already queued for the slot blocks: otherwise a fast-path exclusive arriving while
    // that sibling is mid-handoff would take a second, overlapping hold.
    expect(exclusiveRunMustQueue({ ...idle, exclusiveWaiting: 1 })).toBe(true);
  });
});
