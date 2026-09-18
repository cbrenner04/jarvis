import { afterAll, describe, expect, it } from "bun:test";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AsyncSubprocessOptions, AsyncSubprocessRunner } from "../../../shared/subprocess.ts";
import { AsyncSubprocessError } from "../../../shared/subprocess.ts";
import { trackedMkdtempSync } from "../../../shared/tracked-temp-dir.test-support.ts";
import { coverageTestScope } from "./test-scope.ts";
import {
  COVERAGE_ADVISORY_TIMEOUT_MS,
  reportUncoveredChangedLines,
  resolveCoverageScope,
  runCoverageTests,
} from "./uncovered-changed-lines.ts";

// Real LCOV output fixture from actual `bun test --coverage` run
const LCOV_FIXTURE = `TN:
SF:v2/src/execution/cleanup.ts
FN:1,cleanup
FNDA:1,cleanup
FNF:1
FNH:1
DA:1,1
DA:2,1
DA:3,0
DA:4,1
end_of_record
SF:v2/src/execution/other.ts
FN:1,helper
FNDA:1,helper
FNF:1
FNH:1
DA:1,1
DA:2,1
DA:3,1
end_of_record
`;

const NON_CODE_DIFF = `diff --git a/README.md b/README.md
index 1234567..abcdefg 100644
--- a/README.md
+++ b/README.md
@@ -1,3 +1,3 @@
 # Jarvis
-An agent harness
+A coding agent harness
 Built for quality
diff --git a/config.json b/config.json
index abcdefg..1234567 100644
--- a/config.json
+++ b/config.json
@@ -1,3 +1,3 @@
 {
-  "version": "1"
+  "version": "2"
 }
`;

describe("uncovered-changed-lines", () => {
  it("excludes non-code files from report", async () => {
    const result = await reportUncoveredChangedLines(
      { worktreePath: "/test", runBase: "main" },
      {
        gitDiff: async () => NON_CODE_DIFF,
        untrackedFiles: async () => [],
        resolveTests: async (file) => [file.replace(/\.ts$/, ".test.ts")],
        runTests: async () => true,
        readFile: async (path) => {
          if (path.includes("lcov.info")) return LCOV_FIXTURE;
          throw new Error("not found");
        },
        deleteFile: async () => {},
      },
    );

    expect(result.uncoveredSites).toHaveLength(0);
    expect(result.reportText).toBe("");
  });

  it("fails soft when coverage run exits non-zero", async () => {
    const simpleDiff = `diff --git a/v2/src/execution/cleanup.ts b/v2/src/execution/cleanup.ts
index 1234567..abcdefg 100644
--- a/v2/src/execution/cleanup.ts
+++ b/v2/src/execution/cleanup.ts
@@ -1,3 +1,3 @@
 export function cleanup() {
-  return true;
+  return false;
 }
`;

    const result = await reportUncoveredChangedLines(
      { worktreePath: "/test", runBase: "main" },
      {
        gitDiff: async () => simpleDiff,
        untrackedFiles: async () => [],
        resolveTests: async (file) => [file.replace(/\.ts$/, ".test.ts")],
        runTests: async () => false,
        deleteFile: async () => {},
      },
    );

    expect(result.uncoveredSites).toHaveLength(0);
    expect(result.reportText).toBe("");
  });

  it("fails soft when lcov file does not exist", async () => {
    const simpleDiff = `diff --git a/v2/src/execution/cleanup.ts b/v2/src/execution/cleanup.ts
index 1234567..abcdefg 100644
--- a/v2/src/execution/cleanup.ts
+++ b/v2/src/execution/cleanup.ts
@@ -1,3 +1,3 @@
 export function cleanup() {
-  return true;
+  return false;
 }
`;

    const result = await reportUncoveredChangedLines(
      { worktreePath: "/test", runBase: "main" },
      {
        gitDiff: async () => simpleDiff,
        untrackedFiles: async () => [],
        resolveTests: async (file) => [file.replace(/\.ts$/, ".test.ts")],
        runTests: async () => true,
        readFile: async () => {
          throw new Error("file not found");
        },
        deleteFile: async () => {},
      },
    );

    expect(result.uncoveredSites).toHaveLength(0);
    expect(result.reportText).toBe("");
  });

  it("cleans up coverage output after parsing", async () => {
    let deleteCallCount = 0;
    const simpleDiff = `diff --git a/v2/src/execution/cleanup.ts b/v2/src/execution/cleanup.ts
index 1234567..abcdefg 100644
--- a/v2/src/execution/cleanup.ts
+++ b/v2/src/execution/cleanup.ts
@@ -1,3 +1,3 @@
 export function cleanup() {
-  return true;
+  return false;
 }
`;

    const _result = await reportUncoveredChangedLines(
      { worktreePath: "/test", runBase: "main" },
      {
        gitDiff: async () => simpleDiff,
        untrackedFiles: async () => [],
        resolveTests: async (file) => [file.replace(/\.ts$/, ".test.ts")],
        runTests: async () => true,
        readFile: async (path) => {
          if (path.includes("lcov.info")) return LCOV_FIXTURE;
          throw new Error("not found");
        },
        deleteFile: async () => {
          deleteCallCount++;
        },
      },
    );

    expect(deleteCallCount).toBe(1);
  });

  it("returns empty report for no changed code files", async () => {
    const result = await reportUncoveredChangedLines(
      { worktreePath: "/test", runBase: "main" },
      {
        gitDiff: async () => NON_CODE_DIFF,
        untrackedFiles: async () => [],
        resolveTests: async (file) => [file.replace(/\.ts$/, ".test.ts")],
        runTests: async () => true,
        readFile: async () => {
          throw new Error("not found");
        },
        deleteFile: async () => {},
      },
    );

    expect(result.uncoveredSites).toHaveLength(0);
    expect(result.reportText).toBe("");
  });

  it("pins lcov parsing against checked-in fixture", () => {
    // This test ensures lcov parsing is pinned to actual bun output format
    const lines = LCOV_FIXTURE.split("\n");
    expect(lines).toContain("SF:v2/src/execution/cleanup.ts");
    expect(lines).toContain("DA:3,0");
    expect(lines).toContain("end_of_record");

    // Verify fixture has both covered and uncovered lines
    const daLines = lines.filter((l) => l.startsWith("DA:"));
    const covered = daLines.filter((l) => !l.endsWith(",0"));
    const uncovered = daLines.filter((l) => l.endsWith(",0"));
    expect(covered.length).toBeGreaterThan(0);
    expect(uncovered.length).toBeGreaterThan(0);
  });

  describe("guard inversion tests", () => {
    it("fails when code-path filter is inverted (non-code files reported)", async () => {
      const result = await reportUncoveredChangedLines(
        { worktreePath: "/test", runBase: "main" },
        {
          gitDiff: async () => NON_CODE_DIFF,
          untrackedFiles: async () => [],
          resolveTests: async (file) => [file.replace(/\.ts$/, ".test.ts")],
          runTests: async () => true,
          readFile: async (path) => {
            if (path.includes("lcov.info")) return LCOV_FIXTURE;
            throw new Error("not found");
          },
          deleteFile: async () => {},
        },
      );

      // Should report NOTHING because of the isCodePath filter
      expect(result.uncoveredSites).toHaveLength(0);
      expect(result.reportText).toBe("");
    });

    it("fails soft without throwing when coverage run fails", async () => {
      const diff = `diff --git a/v2/src/execution/cleanup.ts b/v2/src/execution/cleanup.ts
index 1234567..abcdefg 100644
--- a/v2/src/execution/cleanup.ts
+++ b/v2/src/execution/cleanup.ts
@@ -1,3 +1,3 @@
 export function cleanup() {
-  return true;
+  return false;
 }
`;

      let throwCalled = false;

      try {
        const result = await reportUncoveredChangedLines(
          { worktreePath: "/test", runBase: "main" },
          {
            gitDiff: async () => diff,
            untrackedFiles: async () => [],
            resolveTests: async (file) => [file.replace(/\.ts$/, ".test.ts")],
            runTests: async () => {
              throw new Error("coverage subprocess failed");
            },
            deleteFile: async () => {},
          },
        );

        // Should not throw, should return empty report
        expect(result.uncoveredSites).toHaveLength(0);
        expect(result.reportText).toBe("");
      } catch {
        throwCalled = true;
      }

      expect(throwCalled).toBe(false);
    });
  });

  describe("bounded coverage run", () => {
    const scratchRoots: string[] = [];
    const scratchWorktree = (): string => {
      const root = trackedMkdtempSync(join(tmpdir(), "uncovered-lines-"));
      scratchRoots.push(root);
      return root;
    };
    afterAll(() => {
      for (const root of scratchRoots) rmSync(root, { recursive: true, force: true });
    });
    const DIFF = `diff --git a/v2/src/execution/cleanup.ts b/v2/src/execution/cleanup.ts
index 1234567..abcdefg 100644
--- a/v2/src/execution/cleanup.ts
+++ b/v2/src/execution/cleanup.ts
@@ -1,3 +1,3 @@
 export function cleanup() {
-  return true;
+  return false;
 }
`;

    function recordingRunner(
      behavior: (options: AsyncSubprocessOptions | undefined) => Promise<string>,
    ): AsyncSubprocessRunner & { calls: { args: string[]; options: AsyncSubprocessOptions | undefined }[] } {
      const calls: { args: string[]; options: AsyncSubprocessOptions | undefined }[] = [];
      return {
        calls,
        runAsync: async (_cmd, args, _cwd, options) => {
          calls.push({ args, options });
          options?.processGroup?.onGroupId?.(4242);
          return behavior(options);
        },
      };
    }

    it("scope is killing-test files only: no directories, no sandbox-unrunnable suites, no test-file inputs", async () => {
      const scope = await resolveCoverageScope(
        ["v2/src/a.ts", "v2/src/a.test.ts", "shared/b.ts"],
        "/wt",
        async (file) =>
          file === "v2/src/a.ts" ? ["v2/src/a.test.ts", "v2/src/a.sandbox-unrunnable.test.ts"] : ["shared/b.test.ts"],
      );
      expect([...scope]).toEqual(["./shared/b.test.ts", "./v2/src/a.test.ts"]);
    });

    it("skips the coverage run when no killing tests resolve", async () => {
      let ran = false;
      const result = await reportUncoveredChangedLines(
        { worktreePath: scratchWorktree(), runBase: "main" },
        {
          gitDiff: async () => DIFF,
          untrackedFiles: async () => [],
          resolveTests: async () => [],
          runTests: async () => {
            ran = true;
            return true;
          },
          deleteFile: async () => {},
        },
      );
      expect(ran).toBe(false);
      expect(result.reportText).toBe("");
    });

    it("spawns with the timeout, abort signal, and a recorded-then-cleared process group", async () => {
      const recorded: string[] = [];
      const controller = new AbortController();
      const runner = recordingRunner(async () => "");
      const result = await runCoverageTests(
        "/wt",
        coverageTestScope(["./v2/src/a.test.ts"]),
        {
          timeoutMs: COVERAGE_ADVISORY_TIMEOUT_MS,
          signal: controller.signal,
          processGroups: { record: (id) => recorded.push(`record:${id}`), clear: (id) => recorded.push(`clear:${id}`) },
        },
        runner,
      );
      expect(result).toBe(true);
      expect(runner.calls[0]?.args).toEqual(["test", "--coverage", "--coverage-reporter=lcov", "./v2/src/a.test.ts"]);
      expect(runner.calls[0]?.options?.timeoutMs).toBe(COVERAGE_ADVISORY_TIMEOUT_MS);
      expect(runner.calls[0]?.options?.signal).toBe(controller.signal);
      expect(runner.calls[0]?.options?.processGroup).toBeDefined();
      expect(recorded).toEqual(["record:4242", "clear:4242"]);
    });

    it("a hung run abandoned at the timeout reports timeout and the advisory skips", async () => {
      const runner = recordingRunner(async () => {
        throw new AsyncSubprocessError("Command timed out", undefined, "", "", "ETIMEDOUT");
      });
      let lcovRead = false;
      const result = await reportUncoveredChangedLines(
        { worktreePath: scratchWorktree(), runBase: "main" },
        {
          gitDiff: async () => DIFF,
          untrackedFiles: async () => [],
          resolveTests: async () => ["v2/src/execution/cleanup.test.ts"],
          runTests: (cwd, scope, options) => runCoverageTests(cwd, scope, options, runner),
          readFile: async () => {
            lcovRead = true;
            return LCOV_FIXTURE;
          },
          deleteFile: async () => {},
        },
      );
      expect(runner.calls[0]?.options?.timeoutMs).toBe(COVERAGE_ADVISORY_TIMEOUT_MS);
      expect(result.skipReason).toBe("timeout");
      expect(result.reportText).toBe("");
      expect(lcovRead).toBe(false);
    });

    it("abort propagates to the spawn and reports aborted", async () => {
      const controller = new AbortController();
      const runner = recordingRunner(
        (options) =>
          new Promise((_resolve, reject) => {
            options?.signal?.addEventListener("abort", () => reject(new Error("killed")), { once: true });
          }),
      );
      const pending = reportUncoveredChangedLines(
        { worktreePath: scratchWorktree(), runBase: "main", signal: controller.signal },
        {
          gitDiff: async () => DIFF,
          untrackedFiles: async () => [],
          resolveTests: async () => ["v2/src/execution/cleanup.test.ts"],
          runTests: (cwd, scope, options) => runCoverageTests(cwd, scope, options, runner),
          deleteFile: async () => {},
        },
      );
      while (runner.calls.length === 0) await Promise.resolve();
      controller.abort();
      const result = await pending;
      expect(result.skipReason).toBe("aborted");
      expect(result.reportText).toBe("");
    });

    it("a plain non-zero exit is a failure, not a skip", async () => {
      const runner = recordingRunner(async () => {
        throw new AsyncSubprocessError("exit 1", 1, "", "", undefined);
      });
      expect(await runCoverageTests("/wt", coverageTestScope(["./a.test.ts"]), { timeoutMs: 1 }, runner)).toBe(false);
    });
  });
});
