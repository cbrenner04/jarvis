import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { type AsyncSubprocessRunner, realAsyncSubprocessRunner } from "../../../shared/subprocess.ts";
import type { CliDeps } from "../cli/deps.ts";
import type { IpcClient } from "../ipc/client.ts";
import { captureIo, cliMain, makeIpcClient } from "../testing/cli-test-helpers.ts";
import { withFixedUuid } from "../testing/fixed-uuid.ts";
import { createPromptFunction, runCleanupCliCommand } from "./cleanup-cli.ts";

// Abandon-path deps: no worktrees exist, so a parsed `--abandon <name>` fails
// name resolution ("No worktree found") — distinguishable from a usage error.
function makeDeps(): CliDeps {
  return {
    readProjectRegistry: () => ({}),
    connectIpcClient: async () => ({}) as IpcClient,
    socketPath: "/nonexistent/daemon.sock",
    jarvisRoot: "/nonexistent/jarvis-home",
    subprocessRunner: { runAsync: async () => "" },
    promptConfirm: async () => false,
  } as unknown as CliDeps;
}

describe("runCleanupCliCommand argument parsing", () => {
  test("--abandon <name> --dry-run parses both flags (documented order)", async () => {
    const cap = captureIo();
    const code = await runCleanupCliCommand(["--abandon", "some-workspace", "--dry-run"], cap.io, makeDeps());

    expect(code).toBe(1);
    expect(cap.read().stderr).not.toContain("usage: jarvis cleanup");
    expect(cap.read().stderr).toContain('No worktree found matching name "some-workspace"');
  });

  test("--dry-run --abandon <name> behaves identically (flag-order independence)", async () => {
    const cap = captureIo();
    const code = await runCleanupCliCommand(["--dry-run", "--abandon", "some-workspace"], cap.io, makeDeps());

    expect(code).toBe(1);
    expect(cap.read().stderr).not.toContain("usage: jarvis cleanup");
    expect(cap.read().stderr).toContain('No worktree found matching name "some-workspace"');
  });

  test("--abandon <name> alone keeps current behavior", async () => {
    const cap = captureIo();
    const code = await runCleanupCliCommand(["--abandon", "some-workspace"], cap.io, makeDeps());

    expect(code).toBe(1);
    expect(cap.read().stderr).not.toContain("usage: jarvis cleanup");
    expect(cap.read().stderr).toContain('No worktree found matching name "some-workspace"');
  });

  test("--yes and -y parse without changing abandon resolution", async () => {
    for (const argv of [["--yes", "--abandon", "some-workspace"], ["-y", "--abandon", "some-workspace"]]) {
      const cap = captureIo();
      const code = await runCleanupCliCommand(argv, cap.io, makeDeps());

      expect(code).toBe(1);
      expect(cap.read().stderr).not.toContain("usage: jarvis cleanup");
      expect(cap.read().stderr).toContain('No worktree found matching name "some-workspace"');
    }
  });

  test("--abandon without a name prints usage and exits 1", async () => {
    for (const argv of [["--abandon"], ["--abandon", "--dry-run"], ["--abandon", "--yes"], ["--abandon", "-y"]]) {
      const cap = captureIo();
      const code = await runCleanupCliCommand(argv, cap.io, makeDeps());

      expect(code).toBe(1);
      expect(cap.read().stderr).toContain("usage: jarvis cleanup");
    }
  });

  test("--yes cannot be combined with --dry-run", async () => {
    for (const argv of [
      ["--yes", "--dry-run"],
      ["--dry-run", "--yes"],
      ["-y", "--dry-run"],
      ["--dry-run", "-y"],
    ]) {
      const cap = captureIo();
      const code = await runCleanupCliCommand(argv, cap.io, makeDeps());

      expect(code).toBe(1);
      expect(cap.read().stderr).toContain("usage: jarvis cleanup");
    }
  });

  test("--abandon <name> --dry-run previews a real workspace without prompting or mutating", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "jarvis-cleanup-cli-"));
    try {
      const projectRoot = join(tempRoot, "project");
      const jarvisRoot = join(tempRoot, "jarvis-home");
      mkdirSync(projectRoot, { recursive: true });
      await realAsyncSubprocessRunner.runAsync("git", ["init"], projectRoot);
      await realAsyncSubprocessRunner.runAsync("git", ["config", "user.email", "t@t.com"], projectRoot);
      await realAsyncSubprocessRunner.runAsync("git", ["config", "user.name", "T"], projectRoot);
      writeFileSync(join(projectRoot, "README.md"), "# Test\n");
      await realAsyncSubprocessRunner.runAsync("git", ["add", "."], projectRoot);
      await realAsyncSubprocessRunner.runAsync("git", ["commit", "-m", "Initial"], projectRoot);
      const branch = "ws-dry-run";
      await realAsyncSubprocessRunner.runAsync("git", ["branch", branch], projectRoot);
      const worktreePath = join(jarvisRoot, "worktrees", "project", branch);
      mkdirSync(dirname(worktreePath), { recursive: true });
      await realAsyncSubprocessRunner.runAsync("git", ["worktree", "add", worktreePath, branch], projectRoot);

      const cap = captureIo();
      const deps = {
        readProjectRegistry: () => ({ project: { root: projectRoot } }),
        connectIpcClient: async () => ({}) as IpcClient,
        socketPath: "/nonexistent/daemon.sock",
        jarvisRoot,
        subprocessRunner: {
          runAsync: async (cmd: string, args: string[], cwd?: string) =>
            cmd === "gh" ? "[]" : realAsyncSubprocessRunner.runAsync(cmd, args, cwd ?? projectRoot),
        },
        promptConfirm: async () => {
          throw new Error("dry-run must not prompt");
        },
      } as unknown as CliDeps;

      for (const argv of [
        ["--abandon", branch, "--dry-run"],
        ["--dry-run", "--abandon", branch],
      ]) {
        const code = await runCleanupCliCommand(argv, cap.io, deps);
        expect(code).toBe(0);
      }
      expect(cap.read().stdout).toContain("Preview abandon");
      expect(cap.read().stdout).toContain("dry-run");

      const list = await realAsyncSubprocessRunner.runAsync("git", ["worktree", "list"], projectRoot);
      expect(list).toContain(worktreePath);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test("unrecognized arguments print usage and exit 1", async () => {
    for (const argv of [["bogus"], ["--dry-run", "bogus"], ["--abandon", "name", "extra"]]) {
      const cap = captureIo();
      const code = await runCleanupCliCommand(argv, cap.io, makeDeps());

      expect(code).toBe(1);
      expect(cap.read().stderr).toContain("usage: jarvis cleanup");
    }
  });
});

describe("createPromptFunction", () => {
  function fakeTtyStdin(): EventEmitter & { isTTY: boolean; pause: () => void } {
    return Object.assign(new EventEmitter(), { isTTY: true, pause: () => {} });
  }

  test("non-TTY stdin resolves 'no' immediately without attaching listeners", async () => {
    const attached: string[] = [];
    const stdin = {
      isTTY: false,
      once: (event: string) => attached.push(event),
      off: () => {},
      pause: () => {},
    };
    let out = "";
    const prompt = createPromptFunction(stdin, (s) => {
      out += s;
    });

    expect(await prompt("Apply cleanup? [y/N] ")).toBe(false);
    expect(attached).toEqual([]);
    expect(out).toContain('assuming "no"');
  });

  test("stdin end/close during a TTY prompt resolves 'no' and detaches listeners", async () => {
    for (const event of ["end", "close"]) {
      const stdin = fakeTtyStdin();
      const prompt = createPromptFunction(stdin, () => {});

      const pending = prompt("Apply cleanup? [y/N] ");
      stdin.emit(event);

      expect(await pending).toBe(false);
      expect(stdin.listenerCount("data")).toBe(0);
      expect(stdin.listenerCount("end")).toBe(0);
      expect(stdin.listenerCount("close")).toBe(0);
    }
  });

  test("TTY 'y' answer still confirms; other answers decline", async () => {
    for (const [answer, expected] of [
      ["y\n", true],
      ["yes\n", true],
      ["n\n", false],
      ["\n", false],
    ] as const) {
      const stdin = fakeTtyStdin();
      const prompt = createPromptFunction(stdin, () => {});

      const pending = prompt("Apply cleanup? [y/N] ");
      stdin.emit("data", Buffer.from(answer));

      expect(await pending).toBe(expected);
      expect(stdin.listenerCount("data")).toBe(0);
    }
  });
});

describe("cleanup command through main", () => {
  const LIST_REQUEST_ID = "00000000-0000-4000-8000-0000000000c1";
  let cleanupTmp: string;
  let cleanupProjectRoot: string;
  let cleanupJarvisRoot: string;

  // A subprocess runner that reports every branch's PR as merged, and otherwise
  // delegates git to the real runner rooted in the temp project.
  function mergedPrRunner(projectRoot: string): AsyncSubprocessRunner {
    return {
      runAsync: async (cmd, args) => {
        if (cmd === "gh" && args[0] === "pr" && args[1] === "view") {
          return JSON.stringify({ state: "MERGED", mergedAt: "2026-01-01T00:00:00Z" });
        }
        return realAsyncSubprocessRunner.runAsync(cmd, args, projectRoot);
      },
    };
  }

  async function materializeMergedWorktree(branch: string): Promise<string> {
    await realAsyncSubprocessRunner.runAsync("git", ["branch", branch], cleanupProjectRoot);
    const worktreesRoot = join(cleanupJarvisRoot, "worktrees", "project");
    const worktreePath = join(worktreesRoot, branch);
    mkdirSync(worktreesRoot, { recursive: true });
    await realAsyncSubprocessRunner.runAsync("git", ["worktree", "add", worktreePath, branch], cleanupProjectRoot);
    return worktreePath;
  }

  // A daemon list-response reporting no runs for the queried branch (→ eligible).
  const noRunsFrame = { kind: "response", id: LIST_REQUEST_ID, result: { runs: [] } };

  beforeEach(async () => {
    cleanupTmp = mkdtempSync(join(tmpdir(), "jarvis-cli-cleanup-"));
    cleanupProjectRoot = join(cleanupTmp, "project");
    cleanupJarvisRoot = join(cleanupTmp, "jarvis-home");
    mkdirSync(cleanupProjectRoot, { recursive: true });
    await realAsyncSubprocessRunner.runAsync("git", ["init"], cleanupProjectRoot);
    await realAsyncSubprocessRunner.runAsync("git", ["config", "user.email", "t@t.com"], cleanupProjectRoot);
    await realAsyncSubprocessRunner.runAsync("git", ["config", "user.name", "T"], cleanupProjectRoot);
    writeFileSync(join(cleanupProjectRoot, "README.md"), "# Test\n");
    await realAsyncSubprocessRunner.runAsync("git", ["add", "."], cleanupProjectRoot);
    await realAsyncSubprocessRunner.runAsync("git", ["commit", "-m", "Initial"], cleanupProjectRoot);
  });

  afterEach(() => {
    rmSync(cleanupTmp, { recursive: true, force: true });
  });

  test("cleanup --dry-run through main discovers a real merged worktree and previews without mutating", async () => {
    const worktreePath = await materializeMergedWorktree("dry-run-merged");
    const cap = captureIo();

    const code = await withFixedUuid(LIST_REQUEST_ID, () =>
      cliMain(["cleanup", "--dry-run"], cap.io, {
        readProjectRegistry: () => ({ project: { root: cleanupProjectRoot } }),
        jarvisRoot: cleanupJarvisRoot,
        subprocessRunner: mergedPrRunner(cleanupProjectRoot),
        connectIpcClient: async () => makeIpcClient([noRunsFrame]),
      }),
    );

    expect(code).toBe(0);
    expect(cap.read().stdout).toContain(worktreePath);
    expect(cap.read().stdout).toContain("dry-run");
    // Not mutated.
    const list = await realAsyncSubprocessRunner.runAsync("git", ["worktree", "list"], cleanupProjectRoot);
    expect(list).toContain(worktreePath);
  });

  test("cleanup [y/N] decline through main changes nothing", async () => {
    const worktreePath = await materializeMergedWorktree("decline-merged");
    const cap = captureIo();

    const code = await withFixedUuid(LIST_REQUEST_ID, () =>
      cliMain(["cleanup"], cap.io, {
        readProjectRegistry: () => ({ project: { root: cleanupProjectRoot } }),
        jarvisRoot: cleanupJarvisRoot,
        subprocessRunner: mergedPrRunner(cleanupProjectRoot),
        connectIpcClient: async () => makeIpcClient([noRunsFrame]),
        promptConfirm: async () => false,
      }),
    );

    expect(code).toBe(0);
    expect(cap.read().stdout).toContain("Cancelled");
    const list = await realAsyncSubprocessRunner.runAsync("git", ["worktree", "list"], cleanupProjectRoot);
    expect(list).toContain(worktreePath);
  });

  test("cleanup without --yes uses non-interactive stdin's fail-closed default", async () => {
    const worktreePath = await materializeMergedWorktree("non-interactive-decline");
    const cap = captureIo();
    const nonInteractiveStdin = {
      isTTY: false,
      once: () => {
        throw new Error("non-TTY stdin must not attach listeners");
      },
      off: () => {},
      pause: () => {},
    };

    const code = await withFixedUuid(LIST_REQUEST_ID, () =>
      cliMain(["cleanup"], cap.io, {
        readProjectRegistry: () => ({ project: { root: cleanupProjectRoot } }),
        jarvisRoot: cleanupJarvisRoot,
        subprocessRunner: mergedPrRunner(cleanupProjectRoot),
        connectIpcClient: async () => makeIpcClient([noRunsFrame]),
        promptConfirm: createPromptFunction(nonInteractiveStdin, () => {}),
      }),
    );

    expect(code).toBe(0);
    const list = await realAsyncSubprocessRunner.runAsync("git", ["worktree", "list"], cleanupProjectRoot);
    expect(list).toContain(worktreePath);
  });

  test.each([
    ["default cleanup", "yes-merged", ["cleanup", "--yes"]],
    ["--abandon", "yes-abandon", ["cleanup", "--yes", "--abandon", "yes-abandon"]],
  ])("cleanup --yes applies %s without prompting", async (_kind, branch, args) => {
    const worktreePath = await materializeMergedWorktree(branch);
    const cap = captureIo();

    const code = await withFixedUuid(LIST_REQUEST_ID, () =>
      cliMain(args, cap.io, {
        readProjectRegistry: () => ({ project: { root: cleanupProjectRoot } }),
        jarvisRoot: cleanupJarvisRoot,
        subprocessRunner: mergedPrRunner(cleanupProjectRoot),
        connectIpcClient: async () => makeIpcClient([noRunsFrame]),
        promptConfirm: async () => {
          throw new Error("--yes must not prompt");
        },
      }),
    );

    expect(code).toBe(0);
    const list = await realAsyncSubprocessRunner.runAsync("git", ["worktree", "list"], cleanupProjectRoot);
    expect(list).not.toContain(worktreePath);
  });

  test("cleanup with invalid arguments prints usage and exits 1", async () => {
    const cap = captureIo();

    const code = await cliMain(["cleanup", "invalid"], cap.io, {
      readProjectRegistry: () => ({ project: { root: cleanupProjectRoot } }),
      jarvisRoot: cleanupJarvisRoot,
      connectIpcClient: async () => makeIpcClient([]),
    });

    expect(code).toBe(1);
    expect(cap.read().stderr).toContain("usage: jarvis cleanup");
  });

  test("cleanup with daemon connection failure prints error and exits 1", async () => {
    const cap = captureIo();

    const code = await cliMain(["cleanup"], cap.io, {
      readProjectRegistry: () => ({ project: { root: cleanupProjectRoot } }),
      jarvisRoot: cleanupJarvisRoot,
      connectIpcClient: async () => {
        throw new Error("Daemon unreachable");
      },
    });

    expect(code).toBe(1);
    expect(cap.read().stderr).toContain("Daemon unreachable");
  });
});
