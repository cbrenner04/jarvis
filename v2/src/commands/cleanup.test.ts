import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
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

    const code = await performWorktreeRemovals(
      [{ worktree: candidate, project: "project", eligibility: { status: "eligible" } }],
      brokenRunner,
      io,
    );

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
