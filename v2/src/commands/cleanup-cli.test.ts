import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { type AsyncSubprocessRunner, realAsyncSubprocessRunner } from "../../../shared/subprocess.ts";
import type { CliDeps } from "../cli/deps.ts";
import type { IpcClient } from "../ipc/client.ts";
import { openStateStore } from "../persistence/state-store.ts";
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
    for (const argv of [
      ["--yes", "--abandon", "some-workspace"],
      ["-y", "--abandon", "some-workspace"],
    ]) {
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

  test("invalid syntax prints usage and exits 1", async () => {
    for (const argv of [["--bogus"], ["--abandon", "name", "extra"], ["one", "two"]]) {
      const cap = captureIo();
      const code = await runCleanupCliCommand(argv, cap.io, makeDeps());

      expect(code).toBe(1);
      expect(cap.read().stderr).toContain("usage: jarvis cleanup");
    }
  });
});

type ScopedProject = {
  branch: string;
  root: string;
  spec: string;
  worktree: string;
};

type ScopedCleanupFixture = {
  calls: Array<{ args: string[]; cmd: string; cwd: string | undefined }>;
  deadSocket: string;
  jarvisRoot: string;
  other: ScopedProject;
  root: string;
  runner: AsyncSubprocessRunner;
  selected: ScopedProject;
};

async function makeScopedCleanupFixture(label: string): Promise<ScopedCleanupFixture> {
  const root = mkdtempSync(join(tmpdir(), `jarvis-cleanup-scope-${label}-`));
  const jarvisRoot = join(root, "jarvis-home");
  const calls: ScopedCleanupFixture["calls"] = [];

  async function makeProject(project: "selected" | "other"): Promise<ScopedProject> {
    const projectRoot = join(root, project);
    mkdirSync(projectRoot, { recursive: true });
    await realAsyncSubprocessRunner.runAsync("git", ["init"], projectRoot);
    await realAsyncSubprocessRunner.runAsync("git", ["config", "user.email", "t@t.com"], projectRoot);
    await realAsyncSubprocessRunner.runAsync("git", ["config", "user.name", "T"], projectRoot);
    writeFileSync(join(projectRoot, "README.md"), "# Test\n");
    await realAsyncSubprocessRunner.runAsync("git", ["add", "."], projectRoot);
    await realAsyncSubprocessRunner.runAsync("git", ["commit", "-m", "Initial"], projectRoot);
    const branch = `${project}-merged`;
    await realAsyncSubprocessRunner.runAsync("git", ["branch", branch], projectRoot);
    const worktree = join(jarvisRoot, "worktrees", project, branch);
    mkdirSync(dirname(worktree), { recursive: true });
    await realAsyncSubprocessRunner.runAsync("git", ["worktree", "add", worktree, branch], projectRoot);
    const spec = join(projectRoot, "v2", "spec", `${project}-spec`);
    mkdirSync(spec, { recursive: true });
    writeFileSync(join(spec, "index.md"), `# ${project}\n\n## Acceptance criteria\n\n- [x] done\n`);
    return { branch, root: projectRoot, spec, worktree };
  }

  const selected = await makeProject("selected");
  const other = await makeProject("other");
  const runner: AsyncSubprocessRunner = {
    runAsync: async (cmd, args, cwd, options) => {
      calls.push({ cmd, args: [...args], cwd });
      if (cmd === "gh" && args[0] === "pr" && args[1] === "view") {
        return JSON.stringify({ state: "MERGED", mergedAt: "2026-01-01T00:00:00Z" });
      }
      if (cmd === "gh" && args[0] === "pr" && args[1] === "list") {
        if (args.includes("--state") && args[args.indexOf("--state") + 1] === "open") return "[]";
        const branch = args[args.indexOf("--head") + 1];
        const oid = (await realAsyncSubprocessRunner.runAsync("git", ["rev-parse", branch!], cwd)).trim();
        return JSON.stringify([{ number: 1, state: "MERGED", mergedAt: "2026-01-01T00:00:00Z", headRefOid: oid }]);
      }
      return realAsyncSubprocessRunner.runAsync(cmd, args, cwd, options);
    },
  };
  const deadSocket = join(jarvisRoot, "daemon-deadbeefdeadbeef.sock");
  mkdirSync(jarvisRoot, { recursive: true });
  writeFileSync(deadSocket, "");
  return { calls, deadSocket, jarvisRoot, other, root, runner, selected };
}

function scopedCleanupDeps(
  fixture: ScopedCleanupFixture,
  promptConfirm: (message: string) => Promise<boolean>,
): CliDeps {
  return {
    readProjectRegistry: () => ({ selected: { root: fixture.selected.root }, other: { root: fixture.other.root } }),
    jarvisRoot: fixture.jarvisRoot,
    socketPath: join(fixture.jarvisRoot, "invoking.sock"),
    socketDiscovery: async () => [],
    connectIpcClient: async () => makeIpcClient([], { staleResetPreflight: { listRuns: [] } }),
    subprocessRunner: fixture.runner,
    promptConfirm,
  } as unknown as CliDeps;
}

function seedScopedCleanupStore(fixture: ScopedCleanupFixture): void {
  const store = openStateStore();
  for (const [project, item] of Object.entries({ selected: fixture.selected, other: fixture.other })) {
    store.createRun({
      project,
      specRef: `${project}-spec`,
      worktreePath: item.worktree,
      branch: item.branch,
      specPath: `v2/spec/${project}-spec/index.md`,
      status: "completed",
    });
  }
  store.close();
}

async function refExists(project: ScopedProject): Promise<boolean> {
  try {
    await realAsyncSubprocessRunner.runAsync(
      "git",
      ["show-ref", "--verify", `refs/heads/${project.branch}`],
      project.root,
    );
    return true;
  } catch {
    return false;
  }
}

function expectOtherProjectUntouched(fixture: ScopedCleanupFixture): void {
  expect(existsSync(fixture.other.worktree)).toBe(true);
  expect(existsSync(fixture.other.spec)).toBe(true);
  expect(existsSync(join(fixture.other.root, "v2", "spec", "completed", "other-spec"))).toBe(false);
  const projectOwnedCalls = fixture.calls.filter(
    (call) =>
      (call.cwd === fixture.other.root || call.cwd === fixture.other.worktree) &&
      !(call.cmd === "git" && call.args[0] === "rev-parse"),
  );
  expect(projectOwnedCalls).toEqual([]);
}

async function withScopedCleanupFixture(
  label: string,
  test: (fixture: ScopedCleanupFixture) => Promise<void>,
): Promise<void> {
  const fixture = await makeScopedCleanupFixture(label);
  const previousHome = process.env.JARVIS_HOME;
  process.env.JARVIS_HOME = fixture.jarvisRoot;
  try {
    seedScopedCleanupStore(fixture);
    fixture.calls.length = 0;
    await test(fixture);
  } finally {
    if (previousHome === undefined) delete process.env.JARVIS_HOME;
    else process.env.JARVIS_HOME = previousHome;
    rmSync(fixture.root, { recursive: true, force: true });
  }
}

describe("named cleanup project scope", () => {
  test("named cleanup scopes project-owned preview and apply to one registered project", async () => {
    // @mutate v2/src/commands/cleanup-cli.ts "const cleanupRegistry = projectName === undefined ? registry : { [projectName]: registry[projectName]! };" -> "const cleanupRegistry = registry;"
    for (const scenario of [
      { name: "dry-run", argv: ["selected", "--dry-run"], apply: false, interactive: false },
      { name: "interactive", argv: ["selected"], apply: true, interactive: true },
      { name: "yes", argv: ["selected", "--yes"], apply: true, interactive: false },
      { name: "short-yes", argv: ["selected", "-y"], apply: true, interactive: false },
    ] as const) {
      let promptCalls = 0;
      await withScopedCleanupFixture(scenario.name, async (fixture) => {
        const cap = captureIo();
        const code = await runCleanupCliCommand(
          scenario.argv,
          cap.io,
          scopedCleanupDeps(fixture, async () => {
            promptCalls += 1;
            return true;
          }),
        );

        expect(code).toBe(0);
        expect(cap.read().stdout).toContain(fixture.selected.worktree);
        expect(cap.read().stdout).toContain(fixture.selected.spec);
        expect(cap.read().stdout).toContain(`refs/heads/${fixture.selected.branch}`);
        expect(cap.read().stdout).not.toContain(fixture.other.root);
        expectOtherProjectUntouched(fixture);
        expect(await refExists(fixture.other)).toBe(true);
        expect(promptCalls).toBe(scenario.interactive ? 1 : 0);
        if (scenario.apply) {
          expect(existsSync(fixture.selected.worktree)).toBe(false);
          expect(await refExists(fixture.selected)).toBe(false);
          expect(existsSync(fixture.selected.spec)).toBe(false);
          expect(existsSync(join(fixture.selected.root, "v2", "spec", "completed", "selected-spec"))).toBe(true);
          expect(existsSync(fixture.deadSocket)).toBe(false);
        } else {
          expect(existsSync(fixture.selected.worktree)).toBe(true);
          expect(await refExists(fixture.selected)).toBe(true);
          expect(existsSync(fixture.selected.spec)).toBe(true);
          expect(existsSync(fixture.deadSocket)).toBe(true);
        }
      });
    }
  });

  test("declined named cleanup leaves the selected project untouched", async () => {
    await withScopedCleanupFixture("decline", async (fixture) => {
      const cap = captureIo();
      const code = await runCleanupCliCommand(
        ["selected"],
        cap.io,
        scopedCleanupDeps(fixture, async () => false),
      );

      expect(code).toBe(0);
      expect(cap.read().stdout).toContain("Cancelled");
      expect(cap.read().stdout).toContain(fixture.selected.worktree);
      expect(cap.read().stdout).not.toContain(fixture.other.root);
      expect(existsSync(fixture.selected.worktree)).toBe(true);
      expect(existsSync(fixture.selected.spec)).toBe(true);
      expect(await refExists(fixture.selected)).toBe(true);
      expectOtherProjectUntouched(fixture);
      expect(await refExists(fixture.other)).toBe(true);
    });
  });

  test("named dry-run reports global dead sockets without reaping them", async () => {
    await withScopedCleanupFixture("socket-preview", async (fixture) => {
      const cap = captureIo();
      const code = await runCleanupCliCommand(
        ["selected", "--dry-run"],
        cap.io,
        scopedCleanupDeps(fixture, async () => {
          throw new Error("dry-run must not prompt");
        }),
      );

      expect(code).toBe(0);
      expect(cap.read().stdout).toContain(fixture.deadSocket);
      expect(existsSync(fixture.deadSocket)).toBe(true);
      expect(existsSync(fixture.selected.worktree)).toBe(true);
      expect(existsSync(fixture.selected.spec)).toBe(true);
      expect(await refExists(fixture.selected)).toBe(true);
      expectOtherProjectUntouched(fixture);
    });
  });

  test("bare cleanup keeps every registered project in scope", async () => {
    await withScopedCleanupFixture("bare", async (fixture) => {
      const cap = captureIo();
      const code = await runCleanupCliCommand(
        ["--dry-run"],
        cap.io,
        scopedCleanupDeps(fixture, async () => {
          throw new Error("dry-run must not prompt");
        }),
      );

      expect(code).toBe(0);
      expect(cap.read().stdout).toContain(fixture.selected.worktree);
      expect(cap.read().stdout).toContain(fixture.other.worktree);
      expect(fixture.calls.some((call) => call.cwd === fixture.selected.root)).toBe(true);
      expect(fixture.calls.some((call) => call.cwd === fixture.other.root)).toBe(true);
    });
  });

  test("named cleanup spares a shared ref held by another registered project", async () => {
    const root = mkdtempSync(join(tmpdir(), "jarvis-cleanup-shared-ref-"));
    const selectedRoot = join(root, "selected");
    const otherRoot = join(root, "other");
    const jarvisRoot = join(root, "jarvis-home");
    try {
      mkdirSync(selectedRoot, { recursive: true });
      await realAsyncSubprocessRunner.runAsync("git", ["init"], selectedRoot);
      await realAsyncSubprocessRunner.runAsync("git", ["config", "user.email", "t@t.com"], selectedRoot);
      await realAsyncSubprocessRunner.runAsync("git", ["config", "user.name", "T"], selectedRoot);
      writeFileSync(join(selectedRoot, "README.md"), "# Test\n");
      await realAsyncSubprocessRunner.runAsync("git", ["add", "."], selectedRoot);
      await realAsyncSubprocessRunner.runAsync("git", ["commit", "-m", "Initial"], selectedRoot);
      const branch = "shared-merged";
      await realAsyncSubprocessRunner.runAsync("git", ["branch", branch], selectedRoot);
      await realAsyncSubprocessRunner.runAsync("git", ["branch", "other-root"], selectedRoot);
      await realAsyncSubprocessRunner.runAsync("git", ["worktree", "add", otherRoot, "other-root"], selectedRoot);

      const runner: AsyncSubprocessRunner = {
        runAsync: async (cmd, args, cwd, options) => {
          if (cmd === "gh" && args[0] === "pr" && args[1] === "list") {
            if (args.includes("--state") && args[args.indexOf("--state") + 1] === "open") return "[]";
            const oid = (await realAsyncSubprocessRunner.runAsync("git", ["rev-parse", branch], cwd)).trim();
            return JSON.stringify([{ number: 1, state: "MERGED", mergedAt: "2026-01-01T00:00:00Z", headRefOid: oid }]);
          }
          return realAsyncSubprocessRunner.runAsync(cmd, args, cwd, options);
        },
      };
      const cap = captureIo();
      const code = await runCleanupCliCommand(["selected", "--yes"], cap.io, {
        readProjectRegistry: () => ({ selected: { root: selectedRoot }, other: { root: otherRoot } }),
        jarvisRoot,
        socketPath: join(jarvisRoot, "invoking.sock"),
        socketDiscovery: async () => [],
        connectIpcClient: async () =>
          makeIpcClient([], {
            staleResetPreflight: {
              listRuns: [{ runId: "other-live", project: "other", branch, status: "in-progress", isLive: true }],
            },
          }),
        subprocessRunner: runner,
        promptConfirm: async () => {
          throw new Error("--yes must not prompt");
        },
      } as unknown as CliDeps);

      expect(code).toBe(0);
      expect(cap.read().stdout).toContain(`Skipped ref prune: selected refs/heads/${branch} — daemon reports live run`);
      expect(
        await realAsyncSubprocessRunner.runAsync(
          "git",
          ["rev-parse", "--verify", `refs/heads/${branch}`],
          selectedRoot,
        ),
      ).toBeTruthy();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("cleanup rejects an unknown project before daemon discovery or cleanup survey", async () => {
    // @mutate v2/src/commands/cleanup-cli.ts "if (projectName !== undefined && !Object.hasOwn(registry, projectName)) {" -> "if (false) {"
    const root = mkdtempSync(join(tmpdir(), "jarvis-cleanup-unknown-"));
    const socket = join(root, "daemon-dead.sock");
    writeFileSync(socket, "");
    const calls = { registry: 0, sockets: 0, connect: 0, subprocess: 0, prompt: 0 };
    const cap = captureIo();
    const code = await runCleanupCliCommand(["missing"], cap.io, {
      readProjectRegistry: () => {
        calls.registry += 1;
        return { selected: { root } };
      },
      socketDiscovery: async () => {
        calls.sockets += 1;
        return [];
      },
      connectIpcClient: async () => {
        calls.connect += 1;
        return makeIpcClient([]);
      },
      subprocessRunner: {
        runAsync: async () => {
          calls.subprocess += 1;
          return "";
        },
      },
      promptConfirm: async () => {
        calls.prompt += 1;
        return true;
      },
      jarvisRoot: root,
    } as unknown as CliDeps);

    expect(code).toBe(1);
    expect(cap.read().stderr).toContain("missing");
    expect(calls).toEqual({ registry: 1, sockets: 0, connect: 0, subprocess: 0, prompt: 0 });
    expect(existsSync(socket)).toBe(true);
    rmSync(root, { recursive: true, force: true });
  });

  test("cleanup rejects a project combined with abandon before registry access", async () => {
    // @mutate v2/src/commands/cleanup-cli.ts "if (projectName !== undefined && abandonName !== undefined) {" -> "if (false) {"
    for (const project of ["selected", "unknown"]) {
      let registryCalls = 0;
      let daemonCalls = 0;
      const cap = captureIo();
      const code = await runCleanupCliCommand([project, "--abandon", "workspace"], cap.io, {
        readProjectRegistry: () => {
          registryCalls += 1;
          return { selected: { root: "/selected" } };
        },
        connectIpcClient: async () => {
          daemonCalls += 1;
          return makeIpcClient([]);
        },
      } as unknown as CliDeps);

      expect(code).toBe(1);
      expect(cap.read().stderr).toContain("usage: jarvis cleanup [<project>]");
      expect(registryCalls).toBe(0);
      expect(daemonCalls).toBe(0);
    }
  });

  test("cleanup rejects more than one positional project before reading the registry", async () => {
    // @mutate v2/src/commands/cleanup-cli.ts "if (positionals.length > 1) {" -> "if (false) {"
    let registryCalls = 0;
    let daemonCalls = 0;
    const cap = captureIo();
    const code = await runCleanupCliCommand(["selected", "other"], cap.io, {
      readProjectRegistry: () => {
        registryCalls += 1;
        return {};
      },
      connectIpcClient: async () => {
        daemonCalls += 1;
        return makeIpcClient([]);
      },
    } as unknown as CliDeps);

    expect(code).toBe(1);
    expect(cap.read().stderr).toContain("usage: jarvis cleanup [<project>]");
    expect(registryCalls).toBe(0);
    expect(daemonCalls).toBe(0);
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
      runAsync: async (cmd, args, cwd) => {
        if (cmd === "gh" && args[0] === "pr" && args[1] === "view") {
          return JSON.stringify({ state: "MERGED", mergedAt: "2026-01-01T00:00:00Z" });
        }
        if (cmd === "gh" && args[0] === "pr" && args[1] === "list") {
          if (args.includes("--state") && args[args.indexOf("--state") + 1] === "open") return "[]";
          const headIndex = args.indexOf("--head");
          const branch = headIndex >= 0 ? args[headIndex + 1] : undefined;
          if (branch === undefined) return "[]";
          try {
            const oid = (
              await realAsyncSubprocessRunner.runAsync("git", ["rev-parse", branch], cwd ?? projectRoot)
            ).trim();
            return JSON.stringify([{ number: 1, state: "MERGED", mergedAt: "2026-01-01T00:00:00Z", headRefOid: oid }]);
          } catch {
            return "[]";
          }
        }
        // Pass through all other commands, don't apply a default cwd - let git commands run from their specified cwd
        return realAsyncSubprocessRunner.runAsync(cmd, args, cwd ?? projectRoot);
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

  function connectOlderDigestLive(invokingSocket: string, branch: string) {
    return async (socketPath: string) => {
      if (socketPath === invokingSocket) {
        throw Object.assign(new Error("connect ENOENT"), { code: "ENOENT" });
      }
      return makeIpcClient([], {
        staleResetPreflight: {
          listRuns: [{ runId: "live-run", project: "project", branch, status: "in-progress", isLive: true }],
        },
      });
    };
  }

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
        connectIpcClient: async () => makeIpcClient([], { staleResetPreflight: { listRuns: [] } }),
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

    const code = await cliMain(["cleanup", "invalid", "extra"], cap.io, {
      readProjectRegistry: () => ({ project: { root: cleanupProjectRoot } }),
      jarvisRoot: cleanupJarvisRoot,
      connectIpcClient: async () => makeIpcClient([]),
    });

    expect(code).toBe(1);
    expect(cap.read().stderr).toContain("usage: jarvis cleanup");
  });

  test("continues cleanup when keyed socket has no listener", async () => {
    const branch = "no-listener-merged";
    const worktreePath = await materializeMergedWorktree(branch);
    const stranded = join(cleanupProjectRoot, "v2", "spec", "stranded");
    mkdirSync(stranded, { recursive: true });
    writeFileSync(join(stranded, "index.md"), "# Stranded\n\n## Acceptance criteria\n\n- [x] done\n");
    const deadSocket = join(cleanupJarvisRoot, "daemon-deadbeefdeadbeef.sock");
    mkdirSync(dirname(deadSocket), { recursive: true });
    writeFileSync(deadSocket, "");
    const rawSocketError = `connect ENOENT ${deadSocket}`;
    const events: Array<{ stream: "stdout" | "stderr"; text: string }> = [];

    const code = await cliMain(
      ["cleanup", "--yes"],
      {
        stdout: (text) => events.push({ stream: "stdout", text }),
        stderr: (text) => events.push({ stream: "stderr", text }),
      },
      {
        readProjectRegistry: () => ({ project: { root: cleanupProjectRoot } }),
        jarvisRoot: cleanupJarvisRoot,
        subprocessRunner: mergedPrRunner(cleanupProjectRoot),
        socketPath: deadSocket,
        socketDiscovery: async () => [],
        connectIpcClient: async () => {
          throw Object.assign(new Error(rawSocketError), { code: "ENOENT" });
        },
        promptConfirm: async () => {
          throw new Error("--yes must not prompt");
        },
      },
    );

    const stdout = events
      .filter((event) => event.stream === "stdout")
      .map((event) => event.text)
      .join("");
    const stderr = events
      .filter((event) => event.stream === "stderr")
      .map((event) => event.text)
      .join("");
    expect(code).toBe(1);
    expect(events[0]?.stream).toBe("stderr");
    expect(stderr.trim().split("\n")).toHaveLength(1);
    expect(stderr).toContain("No daemon is listening");
    expect(stderr).toContain("jarvis daemon start");
    expect(stderr).not.toContain(deadSocket);
    expect(stderr).not.toContain("connect ENOENT");
    expect(stdout).toContain(`Skipped merged worktree: ${worktreePath}`);
    expect(stdout).toContain("Daemon unreachable; run `jarvis daemon start`");
    expect(stdout).toContain(`Skipped stranded artifact: ${stranded}`);
    expect(stdout).not.toContain(rawSocketError);
    expect(existsSync(deadSocket)).toBe(false);
    expect(existsSync(worktreePath)).toBe(true);
  });

  test("discovered older-digest daemon suppresses no-listener stderr and blocks live run", async () => {
    const branch = "older-digest-cli-live";
    const worktreePath = await materializeMergedWorktree(branch);
    const invokingSocket = join(cleanupJarvisRoot, "daemon-invoking.sock");
    const olderSocket = join(cleanupJarvisRoot, "daemon-older.sock");
    const events: Array<{ stream: "stdout" | "stderr"; text: string }> = [];

    const code = await cliMain(
      ["cleanup", "--dry-run"],
      {
        stdout: (text) => events.push({ stream: "stdout", text }),
        stderr: (text) => events.push({ stream: "stderr", text }),
      },
      {
        readProjectRegistry: () => ({ project: { root: cleanupProjectRoot } }),
        jarvisRoot: cleanupJarvisRoot,
        subprocessRunner: mergedPrRunner(cleanupProjectRoot),
        socketPath: invokingSocket,
        socketDiscovery: async () => [olderSocket],
        connectIpcClient: connectOlderDigestLive(invokingSocket, branch),
      },
    );

    const stdout = events
      .filter((event) => event.stream === "stdout")
      .map((event) => event.text)
      .join("");
    const stderr = events
      .filter((event) => event.stream === "stderr")
      .map((event) => event.text)
      .join("");
    expect(code).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).not.toContain("Daemon unreachable");
    expect(stdout).not.toContain(`Skipped merged worktree: ${worktreePath}`);
    expect(stdout).toContain("No eligible worktrees or stranded artifacts");
    expect(stdout).not.toContain(worktreePath);
    expect(existsSync(worktreePath)).toBe(true);
  });

  test("invoking-socket hard error does not abort cleanup when discovered peer answers", async () => {
    const branch = "peer-answers-eacces";
    const worktreePath = await materializeMergedWorktree(branch);
    const invokingSocket = join(cleanupJarvisRoot, "daemon-invoking.sock");
    const peerSocket = join(cleanupJarvisRoot, "daemon-peer.sock");
    const events: Array<{ stream: "stdout" | "stderr"; text: string }> = [];

    const code = await cliMain(
      ["cleanup", "--dry-run"],
      {
        stdout: (text) => events.push({ stream: "stdout", text }),
        stderr: (text) => events.push({ stream: "stderr", text }),
      },
      {
        readProjectRegistry: () => ({ project: { root: cleanupProjectRoot } }),
        jarvisRoot: cleanupJarvisRoot,
        subprocessRunner: mergedPrRunner(cleanupProjectRoot),
        socketPath: invokingSocket,
        socketDiscovery: async () => [peerSocket],
        connectIpcClient: async (socketPath) => {
          if (socketPath === invokingSocket) {
            throw Object.assign(new Error("connect EACCES /private/daemon.sock"), { code: "EACCES" });
          }
          return makeIpcClient([], { staleResetPreflight: { listRuns: [] } });
        },
      },
    );

    const stdout = events
      .filter((event) => event.stream === "stdout")
      .map((event) => event.text)
      .join("");
    const stderr = events
      .filter((event) => event.stream === "stderr")
      .map((event) => event.text)
      .join("");
    expect(code).toBe(0);
    expect(stderr).toBe("");
    expect(stderr).not.toContain("EACCES");
    expect(stderr).not.toContain("No daemon is listening");
    expect(stdout).toContain(worktreePath);
    expect(existsSync(worktreePath)).toBe(true);
  });

  test("abandon refuses when keyed daemon absent", async () => {
    const cap = captureIo();
    const socketPath = join(cleanupJarvisRoot, "daemon-absent.sock");

    const code = await cliMain(["cleanup", "--abandon", "some-workspace"], cap.io, {
      readProjectRegistry: () => ({ project: { root: cleanupProjectRoot } }),
      jarvisRoot: cleanupJarvisRoot,
      socketPath,
      connectIpcClient: async () => {
        throw Object.assign(new Error(`connect ECONNREFUSED ${socketPath}`), { code: "ECONNREFUSED" });
      },
    });

    expect(code).toBe(1);
    expect(cap.read().stdout).toBe("");
    expect(cap.read().stderr).toBe("Cannot abandon: no daemon is listening; run `jarvis daemon start`\n");
  });

  test("cleanup with daemon connection failure prints error and exits 1", async () => {
    const cap = captureIo();
    const preservedSocket = join(cleanupJarvisRoot, "daemon-preserved.sock");
    mkdirSync(dirname(preservedSocket), { recursive: true });
    writeFileSync(preservedSocket, "");

    const code = await cliMain(["cleanup"], cap.io, {
      readProjectRegistry: () => ({ project: { root: cleanupProjectRoot } }),
      jarvisRoot: cleanupJarvisRoot,
      connectIpcClient: async () => {
        throw Object.assign(new Error("connect EACCES /private/daemon.sock"), { code: "EACCES" });
      },
    });

    expect(code).toBe(1);
    expect(cap.read().stderr).toContain("connect EACCES");
    expect(existsSync(preservedSocket)).toBe(true);
  });
});
