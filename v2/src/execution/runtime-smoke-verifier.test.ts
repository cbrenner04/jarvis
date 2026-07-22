import { describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type RuntimeSmokeVerifierInput, runDaemonHandshake, verifyRuntimeSmoke } from "./runtime-smoke-verifier.ts";

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

  it("executes the daemon entrypoint for a daemon-only production diff", async () => {
    const result = await verifyMappedEntrypoint(
      "v2/src/daemon/daemon.ts",
      "v2/src/daemon-entrypoint.ts",
      ["daemon", "start/status/stop"],
      true,
    );

    expect(result.kind).toBe("observed-clean");
  });

  it("executes the CLI entrypoint for a CLI-only production diff", async () => {
    const result = await verifyMappedEntrypoint("v2/src/cli/deps.ts", "v2/src/cli.ts", ["help"], false);

    expect(result.kind).toBe("smoke-failure");
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

  describe("daemon handshake lifecycle", () => {
    type Invocation = { args: string[]; timeoutMs: number; home: string | undefined };

    function lifecycleSeams(outcomes: readonly (string | Error)[], clock: readonly number[]) {
      const invocations: Invocation[] = [];
      const homes = new Set<string>();
      let outcomeIndex = 0;
      let clockIndex = 0;
      let daemonAlive = false;
      return {
        invocations,
        homes,
        daemonAlive: () => daemonAlive,
        seams: {
          now: () => clock[clockIndex++] ?? clock.at(-1) ?? 0,
          mkdtemp: async () => {
            const home = "/isolated/runtime-home";
            homes.add(home);
            return home;
          },
          remove: async (home: string) => {
            homes.delete(home);
          },
          runAsync: async (
            _cmd: string,
            args: string[],
            _cwd: string,
            options: { timeoutMs?: number; env?: NodeJS.ProcessEnv },
          ) => {
            invocations.push({ args, timeoutMs: options.timeoutMs ?? -1, home: options.env?.JARVIS_HOME });
            const outcome = outcomes[outcomeIndex++];
            if (outcome instanceof Error) throw outcome;
            if (args.at(-1) === "start") daemonAlive = true;
            if (args.includes("stop")) daemonAlive = false;
            return outcome ?? "";
          },
          readPid: async () => (daemonAlive ? 42 : null),
          isProcessAlive: () => daemonAlive,
          terminateProcess: () => {
            daemonAlive = false;
          },
        },
      };
    }

    it("shares the wall-clock bound across successful interactions and removes local state", async () => {
      const fixture = lifecycleSeams(
        ["started\n", "running loaded=a current=a\n", "stopped\n", "stopped\n"],
        [0, 0, 10, 20, 30],
      );

      await expect(runDaemonHandshake("/worktree", 50, fixture.seams)).resolves.toEqual({ success: true, output: "" });

      expect(fixture.invocations.map(({ args }) => args.at(-1))).toEqual(["start", "status", "stop", "--force"]);
      expect(fixture.invocations.map(({ timeoutMs }) => timeoutMs)).toEqual([50, 40, 30, 20]);
      expect(fixture.invocations.every(({ home }) => home === "/isolated/runtime-home")).toBe(true);
      expect(fixture.homes.has("/isolated/runtime-home")).toBe(false);
      expect(fixture.daemonAlive()).toBe(false);
    });

    it("fails an incompatible interaction, force-stops the daemon, and removes local state", async () => {
      const fixture = lifecycleSeams(["started\n", "stopped\n", "stopped\n"], [0, 0, 10, 20]);

      await expect(runDaemonHandshake("/worktree", 50, fixture.seams)).resolves.toEqual({
        success: false,
        command: "bun run v2/src/cli.ts daemon status",
        output: "daemon status was not compatible: stopped\n",
      });

      expect(fixture.invocations.map(({ args }) => args.at(-1))).toEqual(["start", "status", "--force"]);
      expect(fixture.homes.has("/isolated/runtime-home")).toBe(false);
      expect(fixture.daemonAlive()).toBe(false);
    });

    it("does not start after setup exhausts the deadline", async () => {
      const fixture = lifecycleSeams(["stopped\n"], [0, 50]);

      await expect(runDaemonHandshake("/worktree", 50, fixture.seams)).resolves.toEqual({
        success: false,
        command: "bun run v2/src/cli.ts daemon start",
        output: "runtime smoke deadline expired before bun run v2/src/cli.ts daemon start",
      });

      expect(fixture.invocations).toEqual([]);
      expect(fixture.homes.has("/isolated/runtime-home")).toBe(false);
      expect(fixture.daemonAlive()).toBe(false);
    });

    it("does not launch status after its deadline guard expires", async () => {
      const fixture = lifecycleSeams(["started\n"], [0, 0, 50, 50]);

      await expect(runDaemonHandshake("/worktree", 50, fixture.seams)).resolves.toMatchObject({
        success: false,
        command: "bun run v2/src/cli.ts daemon status",
      });

      expect(fixture.invocations.map(({ args }) => args.at(-1))).toEqual(["start"]);
      expect(fixture.invocations.every(({ timeoutMs }) => timeoutMs > 0)).toBe(true);
      expect(fixture.daemonAlive()).toBe(false);
      expect(fixture.homes.has("/isolated/runtime-home")).toBe(false);
    });

    it("does not launch stop or forced cleanup after their deadline guards expire", async () => {
      const fixture = lifecycleSeams(["started\n", "running loaded=a current=a\n"], [0, 0, 10, 50, 50]);

      await expect(runDaemonHandshake("/worktree", 50, fixture.seams)).resolves.toMatchObject({
        success: false,
        command: "bun run v2/src/cli.ts daemon stop",
      });

      expect(fixture.invocations.map(({ args }) => args.at(-1))).toEqual(["start", "status"]);
      expect(fixture.invocations.every(({ timeoutMs }) => timeoutMs > 0)).toBe(true);
      expect(fixture.daemonAlive()).toBe(false);
      expect(fixture.homes.has("/isolated/runtime-home")).toBe(false);
    });

    it("reaps the daemon before removing local state when forced cleanup fails", async () => {
      const fixture = lifecycleSeams(
        ["started\n", new Error("status failed"), new Error("forced stop failed")],
        [0, 0, 10, 20],
      );

      await expect(runDaemonHandshake("/worktree", 50, fixture.seams)).resolves.toEqual({
        success: false,
        command: "bun run v2/src/cli.ts daemon status",
        output: "status failed",
      });

      expect(fixture.invocations.map(({ args }) => args.at(-1))).toEqual(["start", "status", "--force"]);
      expect(fixture.homes.has("/isolated/runtime-home")).toBe(false);
      expect(fixture.daemonAlive()).toBe(false);
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

    it("observes clean through the real CLI probe contract", async () => {
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
    });

    function copyRuntimeTree(dir: string): void {
      cpSync(join(process.cwd(), "v2", "src"), join(dir, "v2", "src"), { recursive: true });
      cpSync(join(process.cwd(), "shared"), join(dir, "shared"), { recursive: true });
      cpSync(join(process.cwd(), "scripts"), join(dir, "scripts"), { recursive: true });
      writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "fixture", type: "module" }));
    }

    function runtimeFixture(): { dir: string; baseSha: string } {
      const dir = makeFixtureRepo();
      copyRuntimeTree(dir);
      execFileSync("git", ["add", "-A"], { cwd: dir });
      execFileSync("git", ["commit", "-q", "-m", "runtime tree"], { cwd: dir });
      return { dir, baseSha: execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir }).toString().trim() };
    }

    it("observes clean through the real CLI-daemon handshake and cleans its local home", async () => {
      const { dir, baseSha } = runtimeFixture();
      try {
        writeFileSync(
          join(dir, "v2", "src", "daemon-entrypoint.ts"),
          `${readFileSync(join(dir, "v2", "src", "daemon-entrypoint.ts"), "utf8")}\n// smoke change\n`,
        );
        execFileSync("git", ["add", "-A"], { cwd: dir });
        execFileSync("git", ["commit", "-q", "-m", "change daemon entrypoint"], { cwd: dir });

        const result = await verifyRuntimeSmoke({ worktreePath: dir, runBase: baseSha });
        if (result.kind === "smoke-failure")
          throw new Error(`real handshake failed: ${result.command}: ${result.observation}`);
        expect(result.kind).toBe("observed-clean");
        expect(readdirSync(dir).filter((name) => name.startsWith(".runtime-smoke-")).length).toBe(0);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("fails the real CLI-daemon handshake when executable trees disagree and cleans its local home", async () => {
      const { dir, baseSha } = runtimeFixture();
      try {
        const driftMarker = join(dir, "daemon-drift-complete");
        writeFileSync(
          join(dir, "v2", "src", "daemon-entrypoint.ts"),
          `${readFileSync(join(process.cwd(), "v2", "src", "daemon-entrypoint.ts"), "utf8")}\n// smoke change\n`,
        );
        const daemonPath = join(dir, "v2", "src", "daemon", "daemon.ts");
        const daemonSource = readFileSync(daemonPath, "utf8");
        writeFileSync(
          daemonPath,
          `import { execFileSync } from "node:child_process";\nimport { appendFileSync, writeFileSync } from "node:fs";\n${daemonSource.replace(
            "loadedExecutableDigest = await getExecutableTreeDigest(import.meta.dir, realAsyncSubprocessRunner);",
            `loadedExecutableDigest = await getExecutableTreeDigest(import.meta.dir, realAsyncSubprocessRunner);\n    appendFileSync(${JSON.stringify(join(dir, "v2", "src", "daemon-entrypoint.ts"))}, "\\n// changed after daemon startup\\n");\n    execFileSync("git", ["add", "-A"]);\n    execFileSync("git", ["commit", "-q", "-m", "daemon drift"]);\n    writeFileSync(${JSON.stringify(driftMarker)}, "complete");`,
          )}`,
        );
        execFileSync("git", ["add", "-A"], { cwd: dir });
        execFileSync("git", ["commit", "-q", "-m", "change daemon entrypoint"], { cwd: dir });

        execFileSync("bun", ["run", "v2/src/daemon-entrypoint.ts", "--help"], { cwd: dir });
        expect(() => readFileSync(driftMarker, "utf8")).toThrow();

        const result = await verifyRuntimeSmoke({ worktreePath: dir, runBase: baseSha });

        expect(result.kind).toBe("smoke-failure");
        if (result.kind === "smoke-failure") {
          expect(result.command).toBe("bun run v2/src/cli.ts daemon status");
          expect(result.observation).toContain("daemon status");
        }
        expect(readFileSync(driftMarker, "utf8")).toBe("complete");
        expect(readdirSync(dir).filter((name) => name.startsWith(".runtime-smoke-")).length).toBe(0);
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
