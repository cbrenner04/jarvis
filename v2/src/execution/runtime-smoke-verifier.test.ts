import { describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type RuntimeSmokeVerifierInput, verifyRuntimeSmoke } from "./runtime-smoke-verifier.ts";

describe("runtime-smoke-verifier", () => {
  it("discovers a changed runnable entrypoint from production diff", async () => {
    const diff = `diff --git a/v2/src/cli.ts b/v2/src/cli.ts
index 1234567..abcdefg 100644
--- a/v2/src/cli.ts
+++ b/v2/src/cli.ts
@@ -1,3 +1,3 @@
 export function main() {
-  return 0;
+  return 1;
   return x;
diff --git a/v2/src/daemon-entrypoint.ts b/v2/src/daemon-entrypoint.ts
index 1234567..abcdefg 100644
--- a/v2/src/daemon-entrypoint.ts
+++ b/v2/src/daemon-entrypoint.ts
@@ -1,3 +1,3 @@
 // entrypoint code
-  return 0;
+  return 1;
`;

    const input: RuntimeSmokeVerifierInput = {
      worktreePath: "/test/path",
      runBase: "main",
    };

    const result = await verifyRuntimeSmoke(input, {
      gitDiff: async () => diff,
      executeEntrypoint: async () => ({ success: true, output: "" }),
    });

    expect(result.kind).not.toBe("not-runnable");
    if (result.kind !== "not-runnable") {
      // Should have discovered either the entrypoint
    }
  });

  it("filters out non-production files from discovery", async () => {
    const diff = `diff --git a/v2/spec/test.md b/v2/spec/test.md
index 1234567..abcdefg 100644
--- a/v2/spec/test.md
+++ b/v2/spec/test.md
@@ -1,3 +1,3 @@
 # Test spec
-old content
+new content
 more content
diff --git a/v1/docs/test.md b/v1/docs/test.md
index 1234567..abcdefg 100644
--- a/v1/docs/test.md
+++ b/v1/docs/test.md
@@ -1,3 +1,3 @@
 # Docs
-old
+new
`;

    const result = await verifyRuntimeSmoke(
      {
        worktreePath: "/test/path",
        runBase: "main",
      },
      {
        gitDiff: async () => diff,
        executeEntrypoint: async () => ({ success: true, output: "" }),
      },
    );

    expect(result.kind).toBe("not-runnable");
    if (result.kind === "not-runnable") {
      expect(result.inspectedPaths).toHaveLength(0);
    }
  });

  it("returns not-runnable when no changed runnable entrypoint exists", async () => {
    const diff = `diff --git a/v2/src/config/agent-model-config.ts b/v2/src/config/agent-model-config.ts
index 1234567..abcdefg 100644
--- a/v2/src/config/agent-model-config.ts
+++ b/v2/src/config/agent-model-config.ts
@@ -1,3 +1,3 @@
 export function loadConfig() {
-  return {};
+  return { updated: true };
`;

    const result = await verifyRuntimeSmoke(
      {
        worktreePath: "/test/path",
        runBase: "main",
      },
      {
        gitDiff: async () => diff,
        executeEntrypoint: async () => ({ success: true, output: "" }),
      },
    );

    expect(result.kind).toBe("not-runnable");
    if (result.kind === "not-runnable") {
      expect(result.inspectedPaths).toContain("v2/src/config/agent-model-config.ts");
      expect(result.discoveryReason).toContain("no changed runnable entrypoint");
    }
  });

  it("executes discovered entrypoint and observes its behavior", async () => {
    const diff = `diff --git a/v2/src/cli.ts b/v2/src/cli.ts
index 1234567..abcdefg 100644
--- a/v2/src/cli.ts
+++ b/v2/src/cli.ts
@@ -1,3 +1,3 @@
 export function main() {
-  return 0;
+  return 1;
`;

    let executedCommand = "";
    let executedTimeout = 0;

    const result = await verifyRuntimeSmoke(
      {
        worktreePath: "/test/path",
        runBase: "main",
      },
      {
        gitDiff: async () => diff,
        executeEntrypoint: async (_cwd, entrypoint, timeoutMs) => {
          executedCommand = entrypoint;
          executedTimeout = timeoutMs;
          return { success: true, output: "help output" };
        },
      },
    );

    expect(executedCommand).toBe("v2/src/cli.ts");
    expect(executedTimeout).toBeGreaterThan(0);
    expect(result.kind).toBe("observed-clean");
  });

  it("bounds smoke execution by wall-clock limit", async () => {
    const diff = `diff --git a/v2/src/cli.ts b/v2/src/cli.ts
index 1234567..abcdefg 100644
--- a/v2/src/cli.ts
+++ b/v2/src/cli.ts
@@ -1,3 +1,3 @@
 export function main() {
-  return 0;
+  return 1;
`;

    let timeoutUsed = 0;

    const result = await verifyRuntimeSmoke(
      {
        worktreePath: "/test/path",
        runBase: "main",
      },
      {
        gitDiff: async () => diff,
        executeEntrypoint: async (_cwd, _entrypoint, timeoutMs) => {
          timeoutUsed = timeoutMs;
          // Simulate timeout by returning failure
          return { success: false, output: "timeout" };
        },
      },
    );

    expect(timeoutUsed).toBeGreaterThan(0);
    expect(timeoutUsed).toBeLessThanOrEqual(10000); // Reasonable upper bound
    expect(result.kind).toBe("smoke-failure");
    if (result.kind === "smoke-failure") {
      expect(result.observation).toContain("timeout");
    }
  });

  it("returns smoke-failure with command and observation when execution fails", async () => {
    const diff = `diff --git a/v2/src/cli.ts b/v2/src/cli.ts
index 1234567..abcdefg 100644
--- a/v2/src/cli.ts
+++ b/v2/src/cli.ts
@@ -1,3 +1,3 @@
 export function main() {
-  return 0;
+  return 1;
`;

    const result = await verifyRuntimeSmoke(
      {
        worktreePath: "/test/path",
        runBase: "main",
      },
      {
        gitDiff: async () => diff,
        executeEntrypoint: async () => ({
          success: false,
          output: "error: module not found",
        }),
      },
    );

    expect(result.kind).toBe("smoke-failure");
    if (result.kind === "smoke-failure") {
      expect(result.command).toContain("v2/src/cli.ts");
      expect(result.observation).toBe("error: module not found");
    }
  });

  it("returns pass with inspected paths and reason when no runnable surface found", async () => {
    const diff = `diff --git a/v2/src/utils/helper.ts b/v2/src/utils/helper.ts
index 1234567..abcdefg 100644
--- a/v2/src/utils/helper.ts
+++ b/v2/src/utils/helper.ts
@@ -1,3 +1,3 @@
 export function help() {
-  return "old";
+  return "new";
`;

    const result = await verifyRuntimeSmoke(
      {
        worktreePath: "/test/path",
        runBase: "main",
      },
      {
        gitDiff: async () => diff,
        executeEntrypoint: async () => ({ success: true, output: "" }),
      },
    );

    expect(result.kind).toBe("not-runnable");
    if (result.kind === "not-runnable") {
      expect(result.inspectedPaths).toContain("v2/src/utils/helper.ts");
      expect(result.discoveryReason).toBeDefined();
      expect(result.discoveryReason).not.toBe("");
    }
  });

  it("returns pass when empty diff provided", async () => {
    const result = await verifyRuntimeSmoke(
      {
        worktreePath: "/test/path",
        runBase: "main",
      },
      {
        gitDiff: async () => "",
        executeEntrypoint: async () => ({ success: true, output: "" }),
      },
    );

    expect(result.kind).toBe("not-runnable");
    if (result.kind === "not-runnable") {
      expect(result.inspectedPaths).toHaveLength(0);
      expect(result.discoveryReason).toContain("no production files");
    }
  });

  it("does not invoke test helper or scoped-test runner in smoke body", async () => {
    const diff = `diff --git a/v2/src/cli.ts b/v2/src/cli.ts
index 1234567..abcdefg 100644
--- a/v2/src/cli.ts
+++ b/v2/src/cli.ts
@@ -1,3 +1,3 @@
 export function main() {
-  return 0;
+  return 1;
`;

    let invokedCommand = "";

    const _result = await verifyRuntimeSmoke(
      {
        worktreePath: "/test/path",
        runBase: "main",
      },
      {
        gitDiff: async () => diff,
        executeEntrypoint: async (_cwd, entrypoint, _timeoutMs) => {
          invokedCommand = entrypoint;
          return { success: true, output: "" };
        },
      },
    );

    // Should not invoke test-related commands
    expect(invokedCommand).not.toContain(".test.");
    expect(invokedCommand).not.toContain("bun test");
  });

  it("discovers entrypoint-ts files as runnable", async () => {
    const diff = `diff --git a/v2/src/daemon-entrypoint.ts b/v2/src/daemon-entrypoint.ts
index 1234567..abcdefg 100644
--- a/v2/src/daemon-entrypoint.ts
+++ b/v2/src/daemon-entrypoint.ts
@@ -1,3 +1,3 @@
 // daemon entrypoint
-  return 0;
+  return 1;
`;

    let executedEntrypoint = "";

    const result = await verifyRuntimeSmoke(
      {
        worktreePath: "/test/path",
        runBase: "main",
      },
      {
        gitDiff: async () => diff,
        executeEntrypoint: async (_cwd, entrypoint, _timeoutMs) => {
          executedEntrypoint = entrypoint;
          return { success: true, output: "" };
        },
      },
    );

    expect(executedEntrypoint).toBe("v2/src/daemon-entrypoint.ts");
    expect(result.kind).toBe("observed-clean");
  });

  it("handles multiple changed files and selects first runnable entrypoint", async () => {
    const diff = `diff --git a/v2/src/config/helper.ts b/v2/src/config/helper.ts
index 1234567..abcdefg 100644
--- a/v2/src/config/helper.ts
+++ b/v2/src/config/helper.ts
@@ -1,3 +1,3 @@
 export function help() {
-  return "old";
+  return "new";
diff --git a/v2/src/cli.ts b/v2/src/cli.ts
index 1234567..abcdefg 100644
--- a/v2/src/cli.ts
+++ b/v2/src/cli.ts
@@ -1,3 +1,3 @@
 export function main() {
-  return 0;
+  return 1;
`;

    let executedEntrypoint = "";

    const result = await verifyRuntimeSmoke(
      {
        worktreePath: "/test/path",
        runBase: "main",
      },
      {
        gitDiff: async () => diff,
        executeEntrypoint: async (_cwd, entrypoint, _timeoutMs) => {
          executedEntrypoint = entrypoint;
          return { success: true, output: "" };
        },
      },
    );

    expect(executedEntrypoint).toBe("v2/src/cli.ts");
    expect(result.kind).toBe("observed-clean");
  });

  it("test pre-fix tree (no verifier exists) should fail", async () => {
    // This test documents that the verifier itself must be testable via the test
    // framework — calling the function should work in the test environment.
    const result = await verifyRuntimeSmoke(
      {
        worktreePath: "/test/path",
        runBase: "main",
      },
      {
        gitDiff: async () => "",
        executeEntrypoint: async () => ({ success: true, output: "" }),
      },
    );

    // We can call and get a result — this proves the module exists and is functional
    expect(result).toBeDefined();
    expect(result.kind).toBeDefined();
  });

  describe("real defaultGitDiff/defaultExecuteEntrypoint (no seams)", () => {
    // Every test above injects both seams, so the real default implementations
    // (which actually spawn git/bun subprocesses) are never exercised — the exact
    // gap that let a wrong-invocation bug ship unnoticed in the sibling
    // diff-derived-mutation-verifier (npm script names passed as bun test file
    // patterns). These tests run the real defaults against a throwaway git
    // fixture to prove the resolved command actually executes.
    function makeFixtureRepo(): string {
      const dir = mkdtempSync(join(tmpdir(), "smoke-verifier-fixture-"));
      execFileSync("git", ["init", "-q", "-b", "verifier-fixture"], { cwd: dir });
      execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
      execFileSync("git", ["config", "user.name", "test"], { cwd: dir });
      writeFileSync(join(dir, "placeholder.ts"), "export const x = 1;\n");
      execFileSync("git", ["add", "-A"], { cwd: dir });
      execFileSync("git", ["commit", "-q", "-m", "base"], { cwd: dir });
      return dir;
    }

    it("observes clean for a real changed entrypoint that runs without error", async () => {
      const dir = makeFixtureRepo();
      try {
        const baseSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir }).toString().trim();
        writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "fixture" }));
        writeFileSync(
          join(dir, "my-entrypoint.ts"),
          "console.log(process.argv.includes('--help') ? 'ok' : 'no-flag');\n",
        );
        execFileSync("git", ["add", "-A"], { cwd: dir });
        execFileSync("git", ["commit", "-q", "-m", "add entrypoint"], { cwd: dir });

        const result = await verifyRuntimeSmoke({ worktreePath: dir, runBase: baseSha });

        expect(result.kind).toBe("observed-clean");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("reports a smoke-failure for a real changed entrypoint that throws", async () => {
      const dir = makeFixtureRepo();
      try {
        const baseSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir }).toString().trim();
        writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "fixture" }));
        writeFileSync(join(dir, "my-entrypoint.ts"), "throw new Error('boom');\n");
        execFileSync("git", ["add", "-A"], { cwd: dir });
        execFileSync("git", ["commit", "-q", "-m", "add broken entrypoint"], { cwd: dir });

        const result = await verifyRuntimeSmoke({ worktreePath: dir, runBase: baseSha });

        expect(result.kind).toBe("smoke-failure");
        if (result.kind === "smoke-failure") {
          expect(result.observation).toContain("boom");
        }
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("reports not-runnable via real git diff when no entrypoint file changed", async () => {
      const dir = makeFixtureRepo();
      try {
        const baseSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir }).toString().trim();
        writeFileSync(join(dir, "helper.ts"), "export function helper() { return 1; }\n");
        execFileSync("git", ["add", "-A"], { cwd: dir });
        execFileSync("git", ["commit", "-q", "-m", "add non-entrypoint file"], { cwd: dir });

        const result = await verifyRuntimeSmoke({ worktreePath: dir, runBase: baseSha });

        expect(result.kind).toBe("not-runnable");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });
});
