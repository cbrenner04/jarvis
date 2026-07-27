import { describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type RuntimeSmokeVerifierInput, verifyRuntimeSmoke } from "./runtime-smoke-verifier.ts";

describe("runtime-smoke-verifier", () => {
  async function verifyMappedEntrypoint(
    changedFile: string,
    expectedEntrypoint: string,
    expectedArgs: readonly string[],
    success: boolean,
  ) {
    const diff = `diff --git a/${changedFile} b/${changedFile}
index 1234567..abcdefg 100644
--- a/${changedFile}
+++ b/${changedFile}
@@ -1,3 +1,3 @@
 export function changed() {
-  return 0;
+  return 1;
 }
`;
    let executedEntrypoint = "";
    let executedArgs: readonly string[] = [];
    const sourceFiles = new Map<string, string>([
      ["v2/src/daemon-entrypoint.ts", 'import "./daemon/daemon";'],
      ["v2/src/daemon/daemon.ts", "export {};"],
      ["v2/src/cli.ts", 'import "./cli/deps.ts";'],
      ["v2/src/cli/deps.ts", 'import "../daemon/daemon-lifecycle.ts";'],
      ["v2/src/daemon/daemon-lifecycle.ts", "export {};"],
    ]);
    const result = await verifyRuntimeSmoke(
      { worktreePath: "/test/path", runBase: "main" },
      {
        gitDiff: async () => diff,
        readSourceFile: async (path) => sourceFiles.get(path.replace("/test/path/", "")) ?? null,
        executeEntrypoint: async (_cwd, entrypoint, args) => {
          executedEntrypoint = entrypoint;
          executedArgs = args;
          return { success, output: "cli failed" };
        },
      },
    );

    expect(executedEntrypoint).toBe(expectedEntrypoint);
    expect(executedArgs).toEqual(expectedArgs);
    return result;
  }

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

  it("executes daemon lifecycle handshake for a daemon-only production diff", async () => {
    const diff = `diff --git a/v2/src/daemon/daemon.ts b/v2/src/daemon/daemon.ts
index 1234567..abcdefg 100644
--- a/v2/src/daemon/daemon.ts
+++ b/v2/src/daemon/daemon.ts
@@ -1,3 +1,3 @@
 export function daemon() {
-  return 0;
+  return 1;
`;
    const executedCommands: string[] = [];
    const sourceFiles = new Map<string, string>([
      ["v2/src/daemon-entrypoint.ts", 'import "./daemon/daemon";'],
      ["v2/src/daemon/daemon.ts", "export {};"],
      ["v2/src/cli.ts", 'import "./cli/deps.ts";'],
      ["v2/src/cli/deps.ts", "export {};"],
    ]);

    const result = await verifyRuntimeSmoke(
      { worktreePath: "/test/path", runBase: "main" },
      {
        gitDiff: async () => diff,
        readSourceFile: async (path) => sourceFiles.get(path.replace("/test/path/", "")) ?? null,
        executeEntrypoint: async (_cwd, entrypoint, args) => {
          executedCommands.push(`${entrypoint} ${args.join(" ")}`);
          if (args[0] === "daemon") {
            if (args[1] === "start") {
              return { success: true, output: JSON.stringify({ pid: 12345, state: "running" }) };
            }
            if (args[1] === "status") {
              return { success: true, output: "running loaded=abc current=def" };
            }
            if (args[1] === "stop") {
              return { success: true, output: "stopped" };
            }
          }
          return { success: false, output: "unexpected command" };
        },
        readPidFile: async () => null,
        getCurrentTime: () => 1000,
      },
    );

    expect(executedCommands).toContain("v2/src/cli.ts daemon start");
    expect(executedCommands).toContain("v2/src/cli.ts daemon status");
    expect(executedCommands).toContain("v2/src/cli.ts daemon stop");
    expect(result.kind).toBe("observed-clean");
  });

  it("executes the CLI entrypoint for a CLI-only production diff", async () => {
    const result = await verifyMappedEntrypoint("v2/src/cli/deps.ts", "v2/src/cli.ts", ["help"], false);

    expect(result.kind).toBe("smoke-failure");
  });

  it("detects daemon start failure and returns smoke-failure", async () => {
    const diff = `diff --git a/v2/src/daemon/daemon.ts b/v2/src/daemon/daemon.ts
index 1234567..abcdefg 100644
--- a/v2/src/daemon/daemon.ts
+++ b/v2/src/daemon/daemon.ts
@@ -1,3 +1,3 @@
 export function daemon() {
-  return 0;
+  return 1;
`;
    const sourceFiles = new Map<string, string>([
      ["v2/src/daemon-entrypoint.ts", 'import "./daemon/daemon";'],
      ["v2/src/daemon/daemon.ts", "export {};"],
    ]);

    const result = await verifyRuntimeSmoke(
      { worktreePath: "/test/path", runBase: "main" },
      {
        gitDiff: async () => diff,
        readSourceFile: async (path) => sourceFiles.get(path.replace("/test/path/", "")) ?? null,
        executeEntrypoint: async (_cwd, _entrypoint, args) => {
          if (args[0] === "daemon" && args[1] === "start") {
            return { success: false, output: "daemon failed to bind socket" };
          }
          return { success: true, output: "" };
        },
        readPidFile: async () => null,
        getCurrentTime: () => 1000,
      },
    );

    expect(result.kind).toBe("smoke-failure");
    if (result.kind === "smoke-failure") {
      expect(result.command).toContain("daemon start");
      expect(result.observation).toContain("failed to bind socket");
    }
  });

  it("detects daemon status failure and returns smoke-failure", async () => {
    const diff = `diff --git a/v2/src/daemon/daemon.ts b/v2/src/daemon/daemon.ts
index 1234567..abcdefg 100644
--- a/v2/src/daemon/daemon.ts
+++ b/v2/src/daemon/daemon.ts
@@ -1,3 +1,3 @@
 export function daemon() {
-  return 0;
+  return 1;
`;
    const sourceFiles = new Map<string, string>([
      ["v2/src/daemon-entrypoint.ts", 'import "./daemon/daemon";'],
      ["v2/src/daemon/daemon.ts", "export {};"],
    ]);

    const result = await verifyRuntimeSmoke(
      { worktreePath: "/test/path", runBase: "main" },
      {
        gitDiff: async () => diff,
        readSourceFile: async (path) => sourceFiles.get(path.replace("/test/path/", "")) ?? null,
        executeEntrypoint: async (_cwd, _entrypoint, args) => {
          if (args[0] === "daemon" && args[1] === "start") {
            return { success: true, output: JSON.stringify({ pid: 12345, state: "running" }) };
          }
          if (args[0] === "daemon" && args[1] === "status") {
            return { success: false, output: "ipc connection failed" };
          }
          return { success: true, output: "" };
        },
        readPidFile: async () => 12345,
        getCurrentTime: () => 1000,
      },
    );

    expect(result.kind).toBe("smoke-failure");
    if (result.kind === "smoke-failure") {
      expect(result.command).toContain("daemon status");
    }
  });

  it("detects daemon stop failure and returns smoke-failure", async () => {
    const diff = `diff --git a/v2/src/daemon/daemon.ts b/v2/src/daemon/daemon.ts
index 1234567..abcdefg 100644
--- a/v2/src/daemon/daemon.ts
+++ b/v2/src/daemon/daemon.ts
@@ -1,3 +1,3 @@
 export function daemon() {
-  return 0;
+  return 1;
`;
    const sourceFiles = new Map<string, string>([
      ["v2/src/daemon-entrypoint.ts", 'import "./daemon/daemon";'],
      ["v2/src/daemon/daemon.ts", "export {};"],
    ]);

    const result = await verifyRuntimeSmoke(
      { worktreePath: "/test/path", runBase: "main" },
      {
        gitDiff: async () => diff,
        readSourceFile: async (path) => sourceFiles.get(path.replace("/test/path/", "")) ?? null,
        executeEntrypoint: async (_cwd, _entrypoint, args) => {
          if (args[0] === "daemon" && args[1] === "start") {
            return { success: true, output: JSON.stringify({ pid: 12345, state: "running" }) };
          }
          if (args[0] === "daemon" && args[1] === "status") {
            return { success: true, output: "running loaded=abc current=def" };
          }
          if (args[0] === "daemon" && args[1] === "stop") {
            return { success: false, output: "failed to stop daemon" };
          }
          return { success: true, output: "" };
        },
        readPidFile: async () => 12345,
        getCurrentTime: () => 1000,
      },
    );

    expect(result.kind).toBe("smoke-failure");
    if (result.kind === "smoke-failure") {
      expect(result.command).toContain("daemon stop");
    }
  });

  it("detects invalid PID in start response and returns smoke-failure", async () => {
    const diff = `diff --git a/v2/src/daemon/daemon.ts b/v2/src/daemon/daemon.ts
index 1234567..abcdefg 100644
--- a/v2/src/daemon/daemon.ts
+++ b/v2/src/daemon/daemon.ts
@@ -1,3 +1,3 @@
 export function daemon() {
-  return 0;
+  return 1;
`;
    const sourceFiles = new Map<string, string>([
      ["v2/src/daemon-entrypoint.ts", 'import "./daemon/daemon";'],
      ["v2/src/daemon/daemon.ts", "export {};"],
    ]);

    const result = await verifyRuntimeSmoke(
      { worktreePath: "/test/path", runBase: "main" },
      {
        gitDiff: async () => diff,
        readSourceFile: async (path) => sourceFiles.get(path.replace("/test/path/", "")) ?? null,
        executeEntrypoint: async (_cwd, _entrypoint, args) => {
          if (args[0] === "daemon" && args[1] === "start") {
            return { success: true, output: JSON.stringify({ pid: 0, state: "running" }) };
          }
          return { success: true, output: "" };
        },
        readPidFile: async () => null,
        getCurrentTime: () => 1000,
      },
    );

    expect(result.kind).toBe("smoke-failure");
    if (result.kind === "smoke-failure") {
      expect(result.observation).toContain("invalid pid");
    }
  });

  it("detects negative PID in start response and returns smoke-failure", async () => {
    const diff = `diff --git a/v2/src/daemon/daemon.ts b/v2/src/daemon/daemon.ts
index 1234567..abcdefg 100644
--- a/v2/src/daemon/daemon.ts
+++ b/v2/src/daemon/daemon.ts
@@ -1,3 +1,3 @@
 export function daemon() {
-  return 0;
+  return 1;
`;
    const sourceFiles = new Map<string, string>([
      ["v2/src/daemon-entrypoint.ts", 'import "./daemon/daemon";'],
      ["v2/src/daemon/daemon.ts", "export {};"],
    ]);

    const result = await verifyRuntimeSmoke(
      { worktreePath: "/test/path", runBase: "main" },
      {
        gitDiff: async () => diff,
        readSourceFile: async (path) => sourceFiles.get(path.replace("/test/path/", "")) ?? null,
        executeEntrypoint: async (_cwd, _entrypoint, args) => {
          if (args[0] === "daemon" && args[1] === "start") {
            return { success: true, output: JSON.stringify({ pid: -1, state: "running" }) };
          }
          return { success: true, output: "" };
        },
        readPidFile: async () => null,
        getCurrentTime: () => 1000,
      },
    );

    expect(result.kind).toBe("smoke-failure");
    if (result.kind === "smoke-failure") {
      expect(result.observation).toContain("invalid pid");
    }
  });

  it("detects missing 'running' state in status output and returns smoke-failure", async () => {
    const diff = `diff --git a/v2/src/daemon/daemon.ts b/v2/src/daemon/daemon.ts
index 1234567..abcdefg 100644
--- a/v2/src/daemon/daemon.ts
+++ b/v2/src/daemon/daemon.ts
@@ -1,3 +1,3 @@
 export function daemon() {
-  return 0;
+  return 1;
`;
    const sourceFiles = new Map<string, string>([
      ["v2/src/daemon-entrypoint.ts", 'import "./daemon/daemon";'],
      ["v2/src/daemon/daemon.ts", "export {};"],
    ]);

    const result = await verifyRuntimeSmoke(
      { worktreePath: "/test/path", runBase: "main" },
      {
        gitDiff: async () => diff,
        readSourceFile: async (path) => sourceFiles.get(path.replace("/test/path/", "")) ?? null,
        executeEntrypoint: async (_cwd, _entrypoint, args) => {
          if (args[0] === "daemon" && args[1] === "start") {
            return { success: true, output: JSON.stringify({ pid: 12345, state: "running" }) };
          }
          if (args[0] === "daemon" && args[1] === "status") {
            return { success: true, output: "stopped loaded=abc current=def" };
          }
          return { success: true, output: "" };
        },
        readPidFile: async () => 12345,
        getCurrentTime: () => 1000,
      },
    );

    expect(result.kind).toBe("smoke-failure");
    if (result.kind === "smoke-failure") {
      expect(result.observation).toContain("not in running state");
    }
  });

  it("detects invalid JSON in start response and returns smoke-failure", async () => {
    const diff = `diff --git a/v2/src/daemon/daemon.ts b/v2/src/daemon/daemon.ts
index 1234567..abcdefg 100644
--- a/v2/src/daemon/daemon.ts
+++ b/v2/src/daemon/daemon.ts
@@ -1,3 +1,3 @@
 export function daemon() {
-  return 0;
+  return 1;
`;
    const sourceFiles = new Map<string, string>([
      ["v2/src/daemon-entrypoint.ts", 'import "./daemon/daemon";'],
      ["v2/src/daemon/daemon.ts", "export {};"],
    ]);

    const result = await verifyRuntimeSmoke(
      { worktreePath: "/test/path", runBase: "main" },
      {
        gitDiff: async () => diff,
        readSourceFile: async (path) => sourceFiles.get(path.replace("/test/path/", "")) ?? null,
        executeEntrypoint: async (_cwd, _entrypoint, args) => {
          if (args[0] === "daemon" && args[1] === "start") {
            return { success: true, output: "not valid json" };
          }
          return { success: true, output: "" };
        },
        readPidFile: async () => null,
        getCurrentTime: () => 1000,
      },
    );

    expect(result.kind).toBe("smoke-failure");
    if (result.kind === "smoke-failure") {
      expect(result.observation).toContain("invalid JSON");
    }
  });

  it("selects the CLI for daemon modules not loaded by the daemon entrypoint", async () => {
    const result = await verifyMappedEntrypoint("v2/src/daemon/daemon-lifecycle.ts", "v2/src/cli.ts", ["help"], true);

    expect(result.kind).toBe("observed-clean");
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
        executeEntrypoint: async (_cwd, entrypoint, _args, timeoutMs) => {
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

  it("bounds daemon lifecycle by shared wall-clock deadline", async () => {
    const diff = `diff --git a/v2/src/daemon/daemon.ts b/v2/src/daemon/daemon.ts
index 1234567..abcdefg 100644
--- a/v2/src/daemon/daemon.ts
+++ b/v2/src/daemon/daemon.ts
@@ -1,3 +1,3 @@
 export function daemon() {
-  return 0;
+  return 1;
`;
    const sourceFiles = new Map<string, string>([
      ["v2/src/daemon-entrypoint.ts", 'import "./daemon/daemon";'],
      ["v2/src/daemon/daemon.ts", "export {};"],
    ]);

    const recordedTimeouts: number[] = [];
    let timeNow = 1000;

    const result = await verifyRuntimeSmoke(
      { worktreePath: "/test/path", runBase: "main" },
      {
        gitDiff: async () => diff,
        readSourceFile: async (path) => sourceFiles.get(path.replace("/test/path/", "")) ?? null,
        executeEntrypoint: async (_cwd, _entrypoint, args, timeoutMs) => {
          recordedTimeouts.push(timeoutMs);
          timeNow += 100; // Simulate command taking 100ms
          if (args[0] === "daemon" && args[1] === "start") {
            return { success: true, output: JSON.stringify({ pid: 12345, state: "running" }) };
          }
          if (args[0] === "daemon" && args[1] === "status") {
            return { success: true, output: "running loaded=abc current=def" };
          }
          if (args[0] === "daemon" && args[1] === "stop") {
            return { success: true, output: "stopped" };
          }
          return { success: true, output: "" };
        },
        readPidFile: async () => null,
        getCurrentTime: () => timeNow,
      },
    );

    expect(result.kind).toBe("observed-clean");
    // Each command gets a decreasing timeout as time advances
    expect(recordedTimeouts.length).toBe(3);
    expect(recordedTimeouts[0] ?? 0).toBeGreaterThan(recordedTimeouts[1] ?? 0);
    expect(recordedTimeouts[1] ?? 0).toBeGreaterThan(recordedTimeouts[2] ?? 0);
    // All timeouts should be positive and within the wall-clock budget
    expect(recordedTimeouts.every((t) => t > 0)).toBe(true);
  });

  it("bounds smoke execution by wall-clock limit for CLI", async () => {
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
        executeEntrypoint: async (_cwd, _entrypoint, _args, timeoutMs) => {
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

    const executedCommands: string[] = [];

    const result = await verifyRuntimeSmoke(
      {
        worktreePath: "/test/path",
        runBase: "main",
      },
      {
        gitDiff: async () => diff,
        executeEntrypoint: async (_cwd, entrypoint, args) => {
          executedCommands.push(`${entrypoint} ${args.join(" ")}`);
          if (args[0] === "daemon") {
            if (args[1] === "start") {
              return { success: true, output: JSON.stringify({ pid: 12345, state: "running" }) };
            }
            if (args[1] === "status") {
              return { success: true, output: "running loaded=abc current=def" };
            }
            if (args[1] === "stop") {
              return { success: true, output: "stopped" };
            }
          }
          return { success: true, output: "" };
        },
        readPidFile: async () => null,
        getCurrentTime: () => 1000,
      },
    );

    expect(executedCommands).toContain("v2/src/cli.ts daemon start");
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

  describe("input validation guards", () => {
    it("daemon lifecycle rejects zero PID from start response", async () => {
      const diff = `diff --git a/v2/src/daemon/daemon.ts b/v2/src/daemon/daemon.ts
index 1234567..abcdefg 100644
--- a/v2/src/daemon/daemon.ts
+++ b/v2/src/daemon/daemon.ts
@@ -1,3 +1,3 @@
 export function daemon() {
-  return 0;
+  return 1;
`;
      const sourceFiles = new Map<string, string>([
        ["v2/src/daemon-entrypoint.ts", 'import "./daemon/daemon";'],
        ["v2/src/daemon/daemon.ts", "export {};"],
      ]);

      const result = await verifyRuntimeSmoke(
        { worktreePath: "/test/path", runBase: "main" },
        {
          gitDiff: async () => diff,
          readSourceFile: async (path) => sourceFiles.get(path.replace("/test/path/", "")) ?? null,
          executeEntrypoint: async (_cwd, _entrypoint, args) => {
            if (args[0] === "daemon" && args[1] === "start") {
              return { success: true, output: JSON.stringify({ pid: 0 }) };
            }
            return { success: true, output: "" };
          },
          readPidFile: async () => null,
          getCurrentTime: () => 1000,
        },
      );

      expect(result.kind).toBe("smoke-failure");
    });

    it("daemon lifecycle rejects missing PID field in start response", async () => {
      const diff = `diff --git a/v2/src/daemon/daemon.ts b/v2/src/daemon/daemon.ts
index 1234567..abcdefg 100644
--- a/v2/src/daemon/daemon.ts
+++ b/v2/src/daemon/daemon.ts
@@ -1,3 +1,3 @@
 export function daemon() {
-  return 0;
+  return 1;
`;
      const sourceFiles = new Map<string, string>([
        ["v2/src/daemon-entrypoint.ts", 'import "./daemon/daemon";'],
        ["v2/src/daemon/daemon.ts", "export {};"],
      ]);

      const result = await verifyRuntimeSmoke(
        { worktreePath: "/test/path", runBase: "main" },
        {
          gitDiff: async () => diff,
          readSourceFile: async (path) => sourceFiles.get(path.replace("/test/path/", "")) ?? null,
          executeEntrypoint: async (_cwd, _entrypoint, args) => {
            if (args[0] === "daemon" && args[1] === "start") {
              return { success: true, output: JSON.stringify({ state: "running" }) };
            }
            return { success: true, output: "" };
          },
          readPidFile: async () => null,
          getCurrentTime: () => 1000,
        },
      );

      expect(result.kind).toBe("smoke-failure");
    });

    it("daemon lifecycle accepts valid positive PID in start response", async () => {
      const diff = `diff --git a/v2/src/daemon/daemon.ts b/v2/src/daemon/daemon.ts
index 1234567..abcdefg 100644
--- a/v2/src/daemon/daemon.ts
+++ b/v2/src/daemon/daemon.ts
@@ -1,3 +1,3 @@
 export function daemon() {
-  return 0;
+  return 1;
`;
      const sourceFiles = new Map<string, string>([
        ["v2/src/daemon-entrypoint.ts", 'import "./daemon/daemon";'],
        ["v2/src/daemon/daemon.ts", "export {};"],
      ]);

      const result = await verifyRuntimeSmoke(
        { worktreePath: "/test/path", runBase: "main" },
        {
          gitDiff: async () => diff,
          readSourceFile: async (path) => sourceFiles.get(path.replace("/test/path/", "")) ?? null,
          executeEntrypoint: async (_cwd, _entrypoint, args) => {
            if (args[0] === "daemon" && args[1] === "start") {
              return { success: true, output: JSON.stringify({ pid: 1, state: "running" }) };
            }
            if (args[0] === "daemon" && args[1] === "status") {
              return { success: true, output: "running loaded=abc current=def" };
            }
            if (args[0] === "daemon" && args[1] === "stop") {
              return { success: true, output: "stopped" };
            }
            return { success: true, output: "" };
          },
          readPidFile: async () => null,
          getCurrentTime: () => 1000,
        },
      );

      expect(result.kind).toBe("observed-clean");
    });

    it("daemon lifecycle accepts large positive PID", async () => {
      const diff = `diff --git a/v2/src/daemon/daemon.ts b/v2/src/daemon/daemon.ts
index 1234567..abcdefg 100644
--- a/v2/src/daemon/daemon.ts
+++ b/v2/src/daemon/daemon.ts
@@ -1,3 +1,3 @@
 export function daemon() {
-  return 0;
+  return 1;
`;
      const sourceFiles = new Map<string, string>([
        ["v2/src/daemon-entrypoint.ts", 'import "./daemon/daemon";'],
        ["v2/src/daemon/daemon.ts", "export {};"],
      ]);

      const result = await verifyRuntimeSmoke(
        { worktreePath: "/test/path", runBase: "main" },
        {
          gitDiff: async () => diff,
          readSourceFile: async (path) => sourceFiles.get(path.replace("/test/path/", "")) ?? null,
          executeEntrypoint: async (_cwd, _entrypoint, args) => {
            if (args[0] === "daemon" && args[1] === "start") {
              return { success: true, output: JSON.stringify({ pid: 999999, state: "running" }) };
            }
            if (args[0] === "daemon" && args[1] === "status") {
              return { success: true, output: "running loaded=abc current=def" };
            }
            if (args[0] === "daemon" && args[1] === "stop") {
              return { success: true, output: "stopped" };
            }
            return { success: true, output: "" };
          },
          readPidFile: async () => null,
          getCurrentTime: () => 1000,
        },
      );

      expect(result.kind).toBe("observed-clean");
    });

    it("daemon lifecycle rejects string PID in start response", async () => {
      const diff = `diff --git a/v2/src/daemon/daemon.ts b/v2/src/daemon/daemon.ts
index 1234567..abcdefg 100644
--- a/v2/src/daemon/daemon.ts
+++ b/v2/src/daemon/daemon.ts
@@ -1,3 +1,3 @@
 export function daemon() {
-  return 0;
+  return 1;
`;
      const sourceFiles = new Map<string, string>([
        ["v2/src/daemon-entrypoint.ts", 'import "./daemon/daemon";'],
        ["v2/src/daemon/daemon.ts", "export {};"],
      ]);

      const result = await verifyRuntimeSmoke(
        { worktreePath: "/test/path", runBase: "main" },
        {
          gitDiff: async () => diff,
          readSourceFile: async (path) => sourceFiles.get(path.replace("/test/path/", "")) ?? null,
          executeEntrypoint: async (_cwd, _entrypoint, args) => {
            if (args[0] === "daemon" && args[1] === "start") {
              return { success: true, output: JSON.stringify({ pid: "12345", state: "running" }) };
            }
            return { success: true, output: "" };
          },
          readPidFile: async () => null,
          getCurrentTime: () => 1000,
        },
      );

      expect(result.kind).toBe("smoke-failure");
    });

    it("daemon lifecycle rejects status without 'running' keyword", async () => {
      const diff = `diff --git a/v2/src/daemon/daemon.ts b/v2/src/daemon/daemon.ts
index 1234567..abcdefg 100644
--- a/v2/src/daemon/daemon.ts
+++ b/v2/src/daemon/daemon.ts
@@ -1,3 +1,3 @@
 export function daemon() {
-  return 0;
+  return 1;
`;
      const sourceFiles = new Map<string, string>([
        ["v2/src/daemon-entrypoint.ts", 'import "./daemon/daemon";'],
        ["v2/src/daemon/daemon.ts", "export {};"],
      ]);

      const result = await verifyRuntimeSmoke(
        { worktreePath: "/test/path", runBase: "main" },
        {
          gitDiff: async () => diff,
          readSourceFile: async (path) => sourceFiles.get(path.replace("/test/path/", "")) ?? null,
          executeEntrypoint: async (_cwd, _entrypoint, args) => {
            if (args[0] === "daemon" && args[1] === "start") {
              return { success: true, output: JSON.stringify({ pid: 12345, state: "starting" }) };
            }
            if (args[0] === "daemon" && args[1] === "status") {
              return { success: true, output: "starting loaded=abc current=def" };
            }
            return { success: true, output: "" };
          },
          readPidFile: async () => 12345,
          getCurrentTime: () => 1000,
        },
      );

      expect(result.kind).toBe("smoke-failure");
    });

    it("daemon lifecycle accepts status containing 'running' keyword", async () => {
      const diff = `diff --git a/v2/src/daemon/daemon.ts b/v2/src/daemon/daemon.ts
index 1234567..abcdefg 100644
--- a/v2/src/daemon/daemon.ts
+++ b/v2/src/daemon/daemon.ts
@@ -1,3 +1,3 @@
 export function daemon() {
-  return 0;
+  return 1;
`;
      const sourceFiles = new Map<string, string>([
        ["v2/src/daemon-entrypoint.ts", 'import "./daemon/daemon";'],
        ["v2/src/daemon/daemon.ts", "export {};"],
      ]);

      const result = await verifyRuntimeSmoke(
        { worktreePath: "/test/path", runBase: "main" },
        {
          gitDiff: async () => diff,
          readSourceFile: async (path) => sourceFiles.get(path.replace("/test/path/", "")) ?? null,
          executeEntrypoint: async (_cwd, _entrypoint, args) => {
            if (args[0] === "daemon" && args[1] === "start") {
              return { success: true, output: JSON.stringify({ pid: 12345, state: "running" }) };
            }
            if (args[0] === "daemon" && args[1] === "status") {
              return { success: true, output: "running loaded=abc current=def" };
            }
            if (args[0] === "daemon" && args[1] === "stop") {
              return { success: true, output: "stopped" };
            }
            return { success: true, output: "" };
          },
          readPidFile: async () => 12345,
          getCurrentTime: () => 1000,
        },
      );

      expect(result.kind).toBe("observed-clean");
    });
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

    it(
      "observes clean through the real CLI probe contract",
      async () => {
        const dir = makeFixtureRepo();
        try {
          const baseSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir }).toString().trim();
          writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "fixture" }));
          mkdirSync(join(dir, "v2", "src"), { recursive: true });
          writeFileSync(
            join(dir, "v2", "src", "cli.ts"),
            "if (process.argv[2] !== 'help') throw new Error('expected help');\n",
          );
          execFileSync("git", ["add", "-A"], { cwd: dir });
          execFileSync("git", ["commit", "-q", "-m", "add entrypoint"], { cwd: dir });

          const result = await verifyRuntimeSmoke({ worktreePath: dir, runBase: baseSha });

          expect(result.kind).toBe("observed-clean");
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
      },
      { timeout: 60_000 },
    );

    it(
      "detects daemon start failure when executable tree mismatches",
      async () => {
        const dir = makeFixtureRepo();
        try {
          const baseSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir }).toString().trim();
          writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "fixture" }));
          mkdirSync(join(dir, "v2", "src"), { recursive: true });
          // Create a daemon-entrypoint that will fail when CLI tries to use it
          writeFileSync(
            join(dir, "v2", "src", "daemon-entrypoint.ts"),
            "throw new Error('incompatible daemon entrypoint');\n",
          );
          execFileSync("git", ["add", "-A"], { cwd: dir });
          execFileSync("git", ["commit", "-q", "-m", "add broken daemon"], { cwd: dir });

          const result = await verifyRuntimeSmoke({ worktreePath: dir, runBase: baseSha });

          expect(result.kind).toBe("smoke-failure");
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
      },
      { timeout: 60_000 },
    );

    it(
      "reports not-runnable via real git diff when no entrypoint file changed",
      async () => {
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
      },
      { timeout: 60_000 },
    );
  });
});
