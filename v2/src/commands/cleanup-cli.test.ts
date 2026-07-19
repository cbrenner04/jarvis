import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { realAsyncSubprocessRunner } from "../../../shared/subprocess.ts";
import type { CliDeps } from "../cli/deps.ts";
import type { IpcClient } from "../ipc/client.ts";
import { createPromptFunction, runCleanupCliCommand } from "./cleanup-cli.ts";

function captureIo() {
  let stdout = "";
  let stderr = "";
  return {
    io: {
      stdout: (s: string) => {
        stdout += s;
      },
      stderr: (s: string) => {
        stderr += s;
      },
    },
    read: () => ({ stdout, stderr }),
  };
}

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

  test("--abandon without a name prints usage and exits 1", async () => {
    for (const argv of [["--abandon"], ["--abandon", "--dry-run"]]) {
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
