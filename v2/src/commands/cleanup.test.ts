import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ProjectRegistryEntry } from "../../../shared/project-registry.ts";
import type { AsyncSubprocessRunner } from "../../../shared/subprocess.ts";
import { realAsyncSubprocessRunner } from "../../../shared/subprocess.ts";
import type { StateStore } from "../persistence/state-store.ts";
import {
  type DaemonClient,
  type DiscoveredWorktree,
  discoverMaterializedWorktrees,
  performWorktreeRemovals,
  runCleanupCommand,
} from "./cleanup.ts";

describe("cleanup: end-to-end via runCleanupCommand", () => {
  let tempRoot: string;
  let projectRoot: string;
  let jarvisRoot: string;

  function createSpec(name: string, criterion: string, intent?: string): { source: string; readyIntent?: string } {
    const source = join(projectRoot, "v2", "spec", name);
    mkdirSync(source, { recursive: true });
    writeFileSync(join(source, "index.md"), `# Plan\n\n## Acceptance criteria\n\n- ${criterion}\n`);
    if (intent === undefined) return { source };

    writeFileSync(join(source, "intent.md"), intent);
    const readyIntent = join(projectRoot, "v2", "spec", "ready-intents", `${name}.md`);
    mkdirSync(dirname(readyIntent), { recursive: true });
    writeFileSync(readyIntent, intent);
    return { source, readyIntent };
  }

  async function materializeWorktree(branch: string, message: string): Promise<string> {
    await realAsyncSubprocessRunner.runAsync("git", ["add", "."], projectRoot);
    await realAsyncSubprocessRunner.runAsync("git", ["commit", "-m", message], projectRoot);
    await realAsyncSubprocessRunner.runAsync("git", ["branch", branch], projectRoot);
    const worktreePath = join(jarvisRoot, "worktrees", "project", branch);
    mkdirSync(dirname(worktreePath), { recursive: true });
    await realAsyncSubprocessRunner.runAsync("git", ["worktree", "add", worktreePath, branch], projectRoot);
    return worktreePath;
  }

  beforeEach(async () => {
    tempRoot = join(process.env.TMPDIR || "/tmp", `jarvis-cleanup-e2e-${Date.now()}-${Math.random()}`);
    mkdirSync(tempRoot, { recursive: true });

    projectRoot = join(tempRoot, "project");
    jarvisRoot = join(tempRoot, "jarvis-home");

    mkdirSync(projectRoot, { recursive: true });
    await realAsyncSubprocessRunner.runAsync("git", ["init"], projectRoot);
    await realAsyncSubprocessRunner.runAsync("git", ["config", "user.email", "test@test.com"], projectRoot);
    await realAsyncSubprocessRunner.runAsync("git", ["config", "user.name", "Test User"], projectRoot);
    writeFileSync(join(projectRoot, "README.md"), "# Test\n");
    await realAsyncSubprocessRunner.runAsync("git", ["add", "."], projectRoot);
    await realAsyncSubprocessRunner.runAsync("git", ["commit", "-m", "Initial"], projectRoot);
  });

  afterEach(() => {
    rmSync(tempRoot, { recursive: true, force: true });
  });

  test("runCleanupCommand with --dry-run previews eligible worktree without removal", async () => {
    // Create a merged worktree
    const branch = "merged-branch";
    await realAsyncSubprocessRunner.runAsync("git", ["branch", branch], projectRoot);

    const worktreesRoot = join(jarvisRoot, "worktrees", "project");
    const worktreePath = join(worktreesRoot, branch);
    mkdirSync(worktreesRoot, { recursive: true });
    await realAsyncSubprocessRunner.runAsync("git", ["worktree", "add", worktreePath, branch], projectRoot);

    const registry: Record<string, ProjectRegistryEntry> = { project: { root: projectRoot } };
    const daemonClient: DaemonClient = async () => [];
    const store: StateStore = { findRunByProjectBranch: () => null } as unknown as StateStore;

    let stdout = "";
    const io = {
      stdout: (s: string) => {
        stdout += s;
      },
      stderr: () => {},
    };

    // Mock runner that reports PR as merged
    const mockRunner: AsyncSubprocessRunner = {
      runAsync: async (cmd, args) => {
        if (cmd === "gh" && args[0] === "pr" && args[1] === "view") {
          return JSON.stringify({ state: "MERGED", mergedAt: "2026-01-01T00:00:00Z" });
        }
        return realAsyncSubprocessRunner.runAsync(cmd, args, projectRoot);
      },
    };

    const code = await runCleanupCommand({ dryRun: true }, registry, jarvisRoot, mockRunner, daemonClient, store, io);

    expect(code).toBe(0);
    expect(stdout).toContain("dry-run");
    expect(stdout).toContain(worktreePath);

    // Verify worktree still exists
    const listOutput = await realAsyncSubprocessRunner.runAsync("git", ["worktree", "list"], projectRoot);
    expect(listOutput).toContain(worktreePath);
  });

  test("runCleanupCommand confirms and removes eligible worktree via git worktree remove + prune + branch -D", async () => {
    const branch = "eligible-merge";
    await realAsyncSubprocessRunner.runAsync("git", ["branch", branch], projectRoot);

    const worktreesRoot = join(jarvisRoot, "worktrees", "project");
    const worktreePath = join(worktreesRoot, branch);
    mkdirSync(worktreesRoot, { recursive: true });
    await realAsyncSubprocessRunner.runAsync("git", ["worktree", "add", worktreePath, branch], projectRoot);

    const registry: Record<string, ProjectRegistryEntry> = { project: { root: projectRoot } };
    const daemonClient: DaemonClient = async () => [];
    const store: StateStore = { findRunByProjectBranch: () => null } as unknown as StateStore;

    let stdout = "";
    const io = {
      stdout: (s: string) => {
        stdout += s;
      },
      stderr: () => {},
    };

    const mockRunner: AsyncSubprocessRunner = {
      runAsync: async (cmd, args) => {
        if (cmd === "gh" && args[0] === "pr" && args[1] === "view") {
          return JSON.stringify({ state: "MERGED", mergedAt: "2026-01-01T00:00:00Z" });
        }
        return realAsyncSubprocessRunner.runAsync(cmd, args, projectRoot);
      },
    };

    const code = await runCleanupCommand(
      { promptConfirm: async () => true },
      registry,
      jarvisRoot,
      mockRunner,
      daemonClient,
      store,
      io,
    );

    expect(code).toBe(0);
    expect(stdout).toContain("Retired");

    // Verify worktree is gone
    const listOutput = await realAsyncSubprocessRunner.runAsync("git", ["worktree", "list"], projectRoot);
    expect(listOutput).not.toContain(worktreePath);
  });

  test("retires before archiving a complete durable spec and prunes only its consumed intent", async () => {
    const branch = "plan/archive-me";
    const specName = "20260717T000000Z-archive-me";
    const intent = "---\nname: archive-me\n---\n";
    const { source } = createSpec(specName, "[x] Done", intent);
    const worktreePath = await materializeWorktree(branch, "spec");
    const run = {
      status: "completed",
      specPath: join(worktreePath, "v2", "spec", specName, "index.md"),
    };
    const store: StateStore = { findRunByProjectBranch: () => run } as unknown as StateStore;
    const order: string[] = [];
    const mockRunner: AsyncSubprocessRunner = {
      runAsync: async (cmd, args, cwd) => {
        if (cmd === "gh" && args[1] === "view")
          return JSON.stringify({ state: "MERGED", mergedAt: "2026-01-01T00:00:00Z" });
        if (cmd === "gh" && args[1] === "list") {
          order.push("inspect archive");
          return "[]";
        }
        if (cmd === "git" && args[0] === "worktree" && args[1] === "remove") order.push("retire");
        return realAsyncSubprocessRunner.runAsync(cmd, args, cwd ?? projectRoot);
      },
    };
    let stdout = "";
    const io = { stdout: (s: string) => (stdout += s), stderr: () => {} };

    expect(
      await runCleanupCommand(
        { promptConfirm: async () => true },
        { project: { root: projectRoot } },
        jarvisRoot,
        mockRunner,
        async () => [],
        store,
        io,
      ),
    ).toBe(0);
    expect(order).toEqual(["retire", "inspect archive"]);
    expect(existsSync(source)).toBe(false);
    expect(existsSync(join(projectRoot, "v2", "spec", "completed", specName))).toBe(true);
    expect(existsSync(join(projectRoot, "v2", "spec", "ready-intents", `${specName}.md`))).toBe(false);
    expect(stdout).toContain("pruned consumed ready-intent");
  });

  test("preserves artifacts when retirement fails and reports post-retirement archive refusals", async () => {
    const branch = "plan/refuse-archive";
    const specName = "20260717T000001Z-refuse-archive";
    const { source, readyIntent } = createSpec(specName, "[ ] Incomplete", "intent\n");
    const worktreePath = await materializeWorktree(branch, "incomplete spec");
    const store: StateStore = {
      findRunByProjectBranch: () => ({
        status: "completed",
        specPath: join(worktreePath, "v2", "spec", specName, "index.md"),
      }),
    } as unknown as StateStore;
    let failRemoval = true;
    let stdout = "";
    const mockRunner: AsyncSubprocessRunner = {
      runAsync: async (cmd, args, cwd) => {
        if (cmd === "gh" && args[1] === "view")
          return JSON.stringify({ state: "MERGED", mergedAt: "2026-01-01T00:00:00Z" });
        if (cmd === "git" && args[0] === "worktree" && args[1] === "remove" && failRemoval)
          throw new Error("remove failed");
        return realAsyncSubprocessRunner.runAsync(cmd, args, cwd ?? projectRoot);
      },
    };
    const io = { stdout: (s: string) => (stdout += s), stderr: () => {} };

    expect(
      await runCleanupCommand(
        { promptConfirm: async () => true },
        { project: { root: projectRoot } },
        jarvisRoot,
        mockRunner,
        async () => [],
        store,
        io,
      ),
    ).toBe(1);
    expect(existsSync(source)).toBe(true);
    if (readyIntent === undefined) throw new Error("expected ready intent");
    expect(readFileSync(readyIntent, "utf8")).toBe("intent\n");

    failRemoval = false;
    stdout = "";
    expect(
      await runCleanupCommand(
        { promptConfirm: async () => true },
        { project: { root: projectRoot } },
        jarvisRoot,
        mockRunner,
        async () => [],
        store,
        io,
      ),
    ).toBe(0);
    expect(existsSync(source)).toBe(true);
    expect(stdout).toContain("unchecked acceptance criterion");
  });

  test("dry-run previews archive and proven intent pruning without changes", async () => {
    const branch = "plan/preview-archive";
    const specName = "20260717T000002Z-preview-archive";
    const { source, readyIntent } = createSpec(specName, "[x] Done", "intent\n");
    if (readyIntent === undefined) throw new Error("expected ready intent");
    const worktreePath = await materializeWorktree(branch, "preview spec");
    const store: StateStore = {
      findRunByProjectBranch: () => ({
        status: "completed",
        specPath: join(worktreePath, "v2", "spec", specName, "index.md"),
      }),
    } as unknown as StateStore;
    let stdout = "";
    const mockRunner: AsyncSubprocessRunner = {
      runAsync: async (cmd, args, cwd) =>
        cmd === "gh" && args[1] === "view"
          ? JSON.stringify({ state: "MERGED", mergedAt: "2026-01-01T00:00:00Z" })
          : realAsyncSubprocessRunner.runAsync(cmd, args, cwd ?? projectRoot),
    };

    expect(
      await runCleanupCommand(
        { dryRun: true },
        { project: { root: projectRoot } },
        jarvisRoot,
        mockRunner,
        async () => [],
        store,
        { stdout: (s) => (stdout += s), stderr: () => {} },
      ),
    ).toBe(0);
    expect(stdout).toContain(`archive: ${source} -> ${join(projectRoot, "v2", "spec", "completed", specName)}`);
    expect(stdout).toContain("prune consumed ready-intent");
    expect(existsSync(worktreePath)).toBe(true);
    expect(existsSync(source)).toBe(true);
    expect(existsSync(readyIntent)).toBe(true);
  });

  test("archives eligible stranded specs without retiring a worktree and retains refused siblings", async () => {
    const home = join(projectRoot, "v2", "spec");
    const complete = "20260717T000003Z-stranded-complete";
    const incomplete = "20260717T000004Z-stranded-incomplete";
    const open = "20260717T000005Z-stranded-open";
    const owned = "20260717T000006Z-stranded-owned";
    mkdirSync(join(home, owned), { recursive: true });
    writeFileSync(join(home, owned, "index.md"), "# Plan\n\n## Acceptance criteria\n\n- [x] Done\n");
    await realAsyncSubprocessRunner.runAsync("git", ["add", "."], projectRoot);
    await realAsyncSubprocessRunner.runAsync("git", ["commit", "-m", "owned stranded spec"], projectRoot);
    await realAsyncSubprocessRunner.runAsync("git", ["branch", "owned-worktree"], projectRoot);
    const ownedWorktree = join(jarvisRoot, "worktrees", "project", "owned-worktree");
    mkdirSync(join(jarvisRoot, "worktrees", "project"), { recursive: true });
    await realAsyncSubprocessRunner.runAsync("git", ["worktree", "add", ownedWorktree, "owned-worktree"], projectRoot);
    for (const [name, criterion] of [
      [complete, "[x] Done"],
      [incomplete, "[ ] Incomplete"],
      [open, "[x] Done"],
    ] as const) {
      mkdirSync(join(home, name), { recursive: true });
      writeFileSync(join(home, name, "index.md"), `# Plan\n\n## Acceptance criteria\n\n- ${criterion}\n`);
    }
    mkdirSync(join(home, "completed", "ignored"), { recursive: true });
    mkdirSync(join(home, "seeds", "ignored"), { recursive: true });
    mkdirSync(join(home, "ready-intents", "ignored"), { recursive: true });
    const mockRunner: AsyncSubprocessRunner = {
      runAsync: async (cmd, args, cwd) => {
        if (cmd === "gh" && args[1] === "view") return JSON.stringify({ state: "CLOSED", mergedAt: null });
        if (cmd === "gh" && args[1] === "list") return args[3] === open ? '[{"number":1}]' : "[]";
        return realAsyncSubprocessRunner.runAsync(cmd, args, cwd ?? projectRoot);
      },
    };
    const store: StateStore = { findRunByProjectBranch: () => null } as unknown as StateStore;
    let stdout = "";
    const io = { stdout: (s: string) => (stdout += s), stderr: () => {} };

    expect(
      await runCleanupCommand(
        { dryRun: true },
        { project: { root: projectRoot } },
        jarvisRoot,
        mockRunner,
        async () => [],
        store,
        io,
      ),
    ).toBe(0);
    expect(stdout).toContain(`archive: ${join(home, complete)}`);
    expect(stdout).toContain("unchecked acceptance criterion");
    expect(stdout).toContain(`matching open PR exists for ${open}`);
    expect(stdout).toContain("another materialized worktree owns this spec");
    expect(existsSync(join(home, complete))).toBe(true);

    stdout = "";
    expect(
      await runCleanupCommand(
        { promptConfirm: async () => true },
        { project: { root: projectRoot } },
        jarvisRoot,
        mockRunner,
        async () => [],
        store,
        io,
      ),
    ).toBe(0);
    expect(existsSync(join(home, complete))).toBe(false);
    expect(existsSync(join(home, "completed", complete))).toBe(true);
    expect(existsSync(join(home, incomplete))).toBe(true);
    expect(existsSync(join(home, open))).toBe(true);
    expect(existsSync(join(home, owned))).toBe(true);
    expect(existsSync(join(home, "completed", "ignored"))).toBe(true);
    expect(existsSync(join(home, "seeds", "ignored"))).toBe(true);
    expect(existsSync(join(home, "ready-intents", "ignored"))).toBe(true);
  });

  test("runCleanupCommand rechecks eligibility after confirmation and spares a worktree that went live in the race window", async () => {
    const branch = "race-branch";
    await realAsyncSubprocessRunner.runAsync("git", ["branch", branch], projectRoot);

    const worktreesRoot = join(jarvisRoot, "worktrees", "project");
    const worktreePath = join(worktreesRoot, branch);
    mkdirSync(worktreesRoot, { recursive: true });
    await realAsyncSubprocessRunner.runAsync("git", ["worktree", "add", worktreePath, branch], projectRoot);

    const registry: Record<string, ProjectRegistryEntry> = { project: { root: projectRoot } };
    // Eligible on the preview call (no live runs), then a live run appears before removal.
    // A working post-confirmation recheck must catch this and spare the worktree.
    let daemonCalls = 0;
    const daemonClient: DaemonClient = async () => {
      daemonCalls += 1;
      return daemonCalls === 1 ? [] : [{ isLive: true }];
    };
    const store: StateStore = { findRunByProjectBranch: () => null } as unknown as StateStore;

    let stdout = "";
    const io = {
      stdout: (s: string) => {
        stdout += s;
      },
      stderr: () => {},
    };

    const mockRunner: AsyncSubprocessRunner = {
      runAsync: async (cmd, args) => {
        if (cmd === "gh" && args[0] === "pr" && args[1] === "view") {
          return JSON.stringify({ state: "MERGED", mergedAt: "2026-01-01T00:00:00Z" });
        }
        return realAsyncSubprocessRunner.runAsync(cmd, args, projectRoot);
      },
    };

    const code = await runCleanupCommand(
      { promptConfirm: async () => true },
      registry,
      jarvisRoot,
      mockRunner,
      daemonClient,
      store,
      io,
    );

    expect(code).toBe(0);
    // Preview call + at least one post-confirmation recheck call.
    expect(daemonCalls).toBeGreaterThanOrEqual(2);
    expect(stdout).toContain("became ineligible");
    expect(stdout).not.toContain("Retired");

    // The worktree survives because the recheck caught the live run.
    const listOutput = await realAsyncSubprocessRunner.runAsync("git", ["worktree", "list"], projectRoot);
    expect(listOutput).toContain(worktreePath);
  });

  test("runCleanupCommand makes worktree ineligible when daemon client throws", async () => {
    const branch = "daemon-fail-branch";
    await realAsyncSubprocessRunner.runAsync("git", ["branch", branch], projectRoot);

    const worktreesRoot = join(jarvisRoot, "worktrees", "project");
    const worktreePath = join(worktreesRoot, branch);
    mkdirSync(worktreesRoot, { recursive: true });
    await realAsyncSubprocessRunner.runAsync("git", ["worktree", "add", worktreePath, branch], projectRoot);

    const registry: Record<string, ProjectRegistryEntry> = { project: { root: projectRoot } };
    const daemonClient: DaemonClient = async () => {
      throw new Error("Daemon unreachable");
    };
    const store: StateStore = { findRunByProjectBranch: () => null } as unknown as StateStore;

    let stdout = "";
    const io = {
      stdout: (s: string) => {
        stdout += s;
      },
      stderr: () => {},
    };

    const mockRunner: AsyncSubprocessRunner = {
      runAsync: async (cmd, args) => {
        if (cmd === "gh" && args[0] === "pr" && args[1] === "view") {
          return JSON.stringify({ state: "MERGED", mergedAt: "2026-01-01T00:00:00Z" });
        }
        return realAsyncSubprocessRunner.runAsync(cmd, args, projectRoot);
      },
    };

    const code = await runCleanupCommand({ dryRun: true }, registry, jarvisRoot, mockRunner, daemonClient, store, io);

    expect(code).toBe(0);
    expect(stdout).toContain("No eligible worktrees");

    // Verify worktree still exists
    const listOutput = await realAsyncSubprocessRunner.runAsync("git", ["worktree", "list"], projectRoot);
    expect(listOutput).toContain(worktreePath);
  });

  test("runCleanupCommand with declined confirmation changes nothing", async () => {
    const branch = "decline-branch";
    await realAsyncSubprocessRunner.runAsync("git", ["branch", branch], projectRoot);

    const worktreesRoot = join(jarvisRoot, "worktrees", "project");
    const worktreePath = join(worktreesRoot, branch);
    mkdirSync(worktreesRoot, { recursive: true });
    await realAsyncSubprocessRunner.runAsync("git", ["worktree", "add", worktreePath, branch], projectRoot);

    const registry: Record<string, ProjectRegistryEntry> = { project: { root: projectRoot } };
    const daemonClient: DaemonClient = async () => [];
    const store: StateStore = { findRunByProjectBranch: () => null } as unknown as StateStore;

    let stdout = "";
    const io = {
      stdout: (s: string) => {
        stdout += s;
      },
      stderr: () => {},
    };

    const mockRunner: AsyncSubprocessRunner = {
      runAsync: async (cmd, args) => {
        if (cmd === "gh" && args[0] === "pr" && args[1] === "view") {
          return JSON.stringify({ state: "MERGED", mergedAt: "2026-01-01T00:00:00Z" });
        }
        return realAsyncSubprocessRunner.runAsync(cmd, args, projectRoot);
      },
    };

    const code = await runCleanupCommand(
      { promptConfirm: async () => false },
      registry,
      jarvisRoot,
      mockRunner,
      daemonClient,
      store,
      io,
    );

    expect(code).toBe(0);
    expect(stdout).toContain("Cancelled");

    // Verify worktree still exists
    const listOutput = await realAsyncSubprocessRunner.runAsync("git", ["worktree", "list"], projectRoot);
    expect(listOutput).toContain(worktreePath);
  });

  test("removal guards are load-bearing: git worktree remove is essential", async () => {
    const branch = "test-removal";
    await realAsyncSubprocessRunner.runAsync("git", ["branch", branch], projectRoot);

    const worktreesRoot = join(jarvisRoot, "worktrees", "project");
    const worktreePath = join(worktreesRoot, branch);
    mkdirSync(worktreesRoot, { recursive: true });
    await realAsyncSubprocessRunner.runAsync("git", ["worktree", "add", worktreePath, branch], projectRoot);

    // Simulate a removal that fails (broken git call)
    const brokenRunner: AsyncSubprocessRunner = {
      runAsync: async (cmd, args) => {
        if (cmd === "gh" && args[0] === "pr" && args[1] === "view") {
          return JSON.stringify({ state: "MERGED", mergedAt: "2026-01-01T00:00:00Z" });
        }
        if (cmd === "git" && args[0] === "worktree" && args[1] === "remove") {
          throw new Error("git worktree remove failed");
        }
        return realAsyncSubprocessRunner.runAsync(cmd, args, projectRoot);
      },
    };

    const candidate: DiscoveredWorktree = { path: worktreePath, branch };
    let stderr = "";
    const io = {
      stdout: () => {},
      stderr: (s: string) => {
        stderr += s;
      },
    };

    const code = await performWorktreeRemovals([{ worktree: candidate, project: "project" }], brokenRunner, io);

    expect(code).toBe(1);
    expect(stderr).toContain("Failed to retire");

    // Verify worktree still exists because removal failed
    const listOutput = await realAsyncSubprocessRunner.runAsync("git", ["worktree", "list"], projectRoot);
    expect(listOutput).toContain(worktreePath);
  });
});

// Discovery tests from original sandbox-unrunnable file
describe("cleanup: discover materialized worktrees", () => {
  let tempRoot: string;
  let projectRoot: string;
  let jarvisRoot: string;

  beforeEach(async () => {
    tempRoot = join(process.env.TMPDIR || "/tmp", `jarvis-cleanup-test-${Date.now()}-${Math.random()}`);
    mkdirSync(tempRoot, { recursive: true });

    projectRoot = join(tempRoot, "project");
    jarvisRoot = join(tempRoot, "jarvis-home");

    mkdirSync(projectRoot, { recursive: true });
    await realAsyncSubprocessRunner.runAsync("git", ["init"], projectRoot);
    await realAsyncSubprocessRunner.runAsync("git", ["config", "user.email", "test@test.com"], projectRoot);
    await realAsyncSubprocessRunner.runAsync("git", ["config", "user.name", "Test User"], projectRoot);

    writeFileSync(join(projectRoot, "README.md"), "# Test Project\n");
    await realAsyncSubprocessRunner.runAsync("git", ["add", "."], projectRoot);
    await realAsyncSubprocessRunner.runAsync("git", ["commit", "-m", "Initial commit"], projectRoot);
  });

  afterEach(() => {
    rmSync(tempRoot, { recursive: true, force: true });
  });

  test("discovers a real worktree created with git worktree add", async () => {
    const worktreesBranch = "test-worktree";
    const worktreesRoot = join(jarvisRoot, "worktrees", "project");
    const worktreePath = join(worktreesRoot, worktreesBranch);

    await realAsyncSubprocessRunner.runAsync("git", ["branch", worktreesBranch], projectRoot);
    mkdirSync(worktreesRoot, { recursive: true });
    await realAsyncSubprocessRunner.runAsync("git", ["worktree", "add", worktreePath, worktreesBranch], projectRoot);

    const registry: Record<string, ProjectRegistryEntry> = { project: { root: projectRoot } };
    const discovered = await discoverMaterializedWorktrees(registry, jarvisRoot);

    expect(discovered).toHaveLength(1);
    expect(discovered[0]?.path).toBe(worktreePath);
    expect(discovered[0]?.branch).toBe(worktreesBranch);
  });

  test("resolves branch for slash-nested worktree paths like plan/<name>", async () => {
    const branchName = "plan/my-feature";
    const worktreesRoot = join(jarvisRoot, "worktrees", "project");
    const worktreePath = join(worktreesRoot, branchName);

    await realAsyncSubprocessRunner.runAsync("git", ["branch", branchName], projectRoot);
    mkdirSync(worktreesRoot, { recursive: true });
    await realAsyncSubprocessRunner.runAsync("git", ["worktree", "add", worktreePath, branchName], projectRoot);

    const registry: Record<string, ProjectRegistryEntry> = { project: { root: projectRoot } };
    const discovered = await discoverMaterializedWorktrees(registry, jarvisRoot);

    expect(discovered).toHaveLength(1);
    expect(discovered[0]?.path).toBe(worktreePath);
    expect(discovered[0]?.branch).toBe(branchName);
  });

  test("excludes empty directories and non-worktree directories", async () => {
    const branchName = "valid-worktree";
    const worktreesRoot = join(jarvisRoot, "worktrees", "project");
    const validWorktreePath = join(worktreesRoot, branchName);

    await realAsyncSubprocessRunner.runAsync("git", ["branch", branchName], projectRoot);
    mkdirSync(worktreesRoot, { recursive: true });
    await realAsyncSubprocessRunner.runAsync("git", ["worktree", "add", validWorktreePath, branchName], projectRoot);

    mkdirSync(join(worktreesRoot, "plan"), { recursive: true });
    mkdirSync(join(worktreesRoot, "not-a-worktree"), { recursive: true });
    writeFileSync(join(worktreesRoot, "not-a-worktree", "some-file.txt"), "not a git repo");

    const registry: Record<string, ProjectRegistryEntry> = { project: { root: projectRoot } };
    const discovered = await discoverMaterializedWorktrees(registry, jarvisRoot);

    expect(discovered).toHaveLength(1);
    expect(discovered[0]?.path).toBe(validWorktreePath);
    expect(discovered[0]?.branch).toBe(branchName);
  });

  test("handles multiple worktrees under the same project", async () => {
    const branch1 = "feature-1";
    const branch2 = "feature-2";
    const worktreesRoot = join(jarvisRoot, "worktrees", "project");

    await realAsyncSubprocessRunner.runAsync("git", ["branch", branch1], projectRoot);
    await realAsyncSubprocessRunner.runAsync("git", ["branch", branch2], projectRoot);

    mkdirSync(worktreesRoot, { recursive: true });
    await realAsyncSubprocessRunner.runAsync(
      "git",
      ["worktree", "add", join(worktreesRoot, branch1), branch1],
      projectRoot,
    );
    await realAsyncSubprocessRunner.runAsync(
      "git",
      ["worktree", "add", join(worktreesRoot, branch2), branch2],
      projectRoot,
    );

    const registry: Record<string, ProjectRegistryEntry> = { project: { root: projectRoot } };
    const discovered = await discoverMaterializedWorktrees(registry, jarvisRoot);

    expect(discovered).toHaveLength(2);
    const branches = discovered.map((w) => w.branch).sort();
    expect(branches).toContain(branch1);
    expect(branches).toContain(branch2);
  });

  test("returns empty list when jarvisRoot worktrees directory does not exist", async () => {
    const registry: Record<string, ProjectRegistryEntry> = { project: { root: projectRoot } };
    const discovered = await discoverMaterializedWorktrees(registry, jarvisRoot);

    expect(discovered).toHaveLength(0);
  });

  test("returns empty list when project has no worktrees", async () => {
    const worktreesRoot = join(jarvisRoot, "worktrees", "project");
    mkdirSync(worktreesRoot, { recursive: true });

    const registry: Record<string, ProjectRegistryEntry> = { project: { root: projectRoot } };
    const discovered = await discoverMaterializedWorktrees(registry, jarvisRoot);

    expect(discovered).toHaveLength(0);
  });
});
