import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import type { ProjectRegistryEntry } from "../../../shared/project-registry.ts";
import type { AsyncSubprocessRunner } from "../../../shared/subprocess.ts";
import { realAsyncSubprocessRunner } from "../../../shared/subprocess.ts";
import { startIpcServer } from "../ipc/server.ts";
import type { StateStore } from "../persistence/state-store.ts";
import { canUseUnixSockets } from "../testing/unix-socket.ts";
import {
  type DaemonClient,
  type DiscoveredWorktree,
  discoverMaterializedWorktrees,
  performWorktreeRemovals,
  resetStaleWorkspace,
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
    const store: StateStore = { listRuns: () => [] } as unknown as StateStore;

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
    const store: StateStore = { listRuns: () => [] } as unknown as StateStore;

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
      project: "project",
      branch,
      stepId: "implement",
      worktreePath,
    };
    const store: StateStore = { findRunByProjectBranch: () => null, listRuns: () => [run] } as unknown as StateStore;
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
    expect(stdout).toContain("No eligible worktrees or stranded artifacts");
  });

  test.each([
    {
      name: "reviewed implement",
      branch: "implement/reviewed-archive",
      stepId: "implement",
      reviewStepId: "implement-review",
      authoredSpecPath: (worktreePath: string, specName: string) =>
        join(worktreePath, "v2", "spec", specName, "index.md"),
      reviewSpecPath: (worktreePath: string, specName: string) =>
        join(worktreePath, "v2", "spec", specName, "verdict-patch.md"),
    },
    {
      name: "reviewed plan",
      branch: "plan/reviewed-archive",
      stepId: "plan",
      reviewStepId: "review-debate",
      authoredSpecPath: (_worktreePath: string, specName: string) => join("v2", "spec", specName),
      reviewSpecPath: (worktreePath: string) => join(worktreePath, ".jarvis-plan-stage", "verdict-plan.md"),
    },
  ])("retires and archives the authored spec for a default $name workflow", async ({
    branch,
    stepId,
    reviewStepId,
    authoredSpecPath,
    reviewSpecPath,
  }) => {
    const specName = "20260721T000000Z-reviewed-archive";
    const { source } = createSpec(specName, "[x] Done");
    const worktreePath = await materializeWorktree(branch, "reviewed spec");
    const store: StateStore = {
      listRuns: () =>
        [
          {
            status: "completed",
            project: "project",
            branch,
            stepId: reviewStepId,
            worktreePath,
            specPath: reviewSpecPath(worktreePath, specName),
          },
          {
            status: "completed",
            project: "project",
            branch,
            stepId,
            worktreePath,
            specPath: authoredSpecPath(worktreePath, specName),
          },
        ] as never[],
    } as unknown as StateStore;
    const mockRunner: AsyncSubprocessRunner = {
      runAsync: async (cmd, args, cwd) => {
        if (cmd === "gh" && args[1] === "view")
          return JSON.stringify({ state: "MERGED", mergedAt: "2026-01-01T00:00:00Z" });
        if (cmd === "gh" && args[1] === "list") return "[]";
        return realAsyncSubprocessRunner.runAsync(cmd, args, cwd ?? projectRoot);
      },
    };
    let stdout = "";

    expect(
      await runCleanupCommand(
        { promptConfirm: async () => true },
        { project: { root: projectRoot } },
        jarvisRoot,
        mockRunner,
        async () => [],
        store,
        { stdout: (s) => (stdout += s), stderr: () => {} },
      ),
    ).toBe(0);
    expect(existsSync(worktreePath)).toBe(false);
    expect(existsSync(source)).toBe(false);
    expect(existsSync(join(projectRoot, "v2", "spec", "completed", specName))).toBe(true);
    expect(stdout).not.toContain("no durable spec identity");
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
      listRuns: () => [
        {
          status: "completed",
          specPath: join(worktreePath, "v2", "spec", specName, "index.md"),
          project: "project",
          branch,
          stepId: "implement",
          worktreePath,
        },
      ],
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
      listRuns: () => [
        {
          status: "completed",
          specPath: join(worktreePath, "v2", "spec", specName, "index.md"),
          project: "project",
          branch,
          stepId: "implement",
          worktreePath,
        },
      ],
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
    const store: StateStore = {
      listRuns: () =>
        [complete, incomplete, open, owned].map((name) => ({
          project: "project",
          branch: name === owned ? "owned-worktree" : name,
          worktreePath: projectRoot,
          specPath: join(home, name, "index.md"),
        })) as never[],
    } as unknown as StateStore;
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

  test("keys stranded ownership to the recorded project branch and rechecks it before archival", async () => {
    const home = join(projectRoot, "v2", "spec");
    const eligible = "20260717T000007Z-eligible";
    const owned = "20260717T000008Z-owned";
    const late = "20260717T000009Z-late";
    const guarded = "20260717T000010Z-guarded";
    const relative = "20260717T000011Z-relative";
    const otherOnly = "20260717T000012Z-other-only";
    for (const name of [eligible, owned, late, relative, otherOnly]) createSpec(name, "[x] Done");
    await realAsyncSubprocessRunner.runAsync("git", ["add", "."], projectRoot);
    await realAsyncSubprocessRunner.runAsync("git", ["commit", "-m", "stranded ownership fixtures"], projectRoot);

    const addWorktree = async (branch: string): Promise<string> => {
      await realAsyncSubprocessRunner.runAsync("git", ["branch", branch], projectRoot);
      const path = join(jarvisRoot, "worktrees", "project", branch);
      mkdirSync(dirname(path), { recursive: true });
      await realAsyncSubprocessRunner.runAsync("git", ["worktree", "add", path, branch], projectRoot);
      return path;
    };
    await addWorktree("unrelated");
    await addWorktree("custom-owner");

    const otherRoot = join(tempRoot, "other-project");
    mkdirSync(otherRoot, { recursive: true });
    await realAsyncSubprocessRunner.runAsync("git", ["init"], otherRoot);
    await realAsyncSubprocessRunner.runAsync("git", ["config", "user.email", "test@test.com"], otherRoot);
    await realAsyncSubprocessRunner.runAsync("git", ["config", "user.name", "Test User"], otherRoot);
    writeFileSync(join(otherRoot, "README.md"), "# Other\n");
    await realAsyncSubprocessRunner.runAsync("git", ["add", "."], otherRoot);
    await realAsyncSubprocessRunner.runAsync("git", ["commit", "-m", "Initial"], otherRoot);
    await realAsyncSubprocessRunner.runAsync("git", ["branch", "custom-owner"], otherRoot);
    await realAsyncSubprocessRunner.runAsync("git", ["branch", "other-only-owner"], otherRoot);
    const otherWorktree = join(jarvisRoot, "worktrees", "other", "custom-owner");
    mkdirSync(dirname(otherWorktree), { recursive: true });
    await realAsyncSubprocessRunner.runAsync("git", ["worktree", "add", otherWorktree, "custom-owner"], otherRoot);
    const otherOnlyWorktree = join(jarvisRoot, "worktrees", "other", "other-only-owner");
    await realAsyncSubprocessRunner.runAsync(
      "git",
      ["worktree", "add", otherOnlyWorktree, "other-only-owner"],
      otherRoot,
    );

    const runs = [
      { name: eligible, branch: "custom-eligible" },
      { name: owned, branch: "custom-owner" },
      { name: late, branch: "custom-late" },
      { name: guarded, branch: "custom-guarded" },
      { name: relative, branch: "custom-relative" },
      { name: otherOnly, branch: "other-only-owner" },
    ].map(({ name, branch }) => ({
      project: "project",
      branch,
      worktreePath: projectRoot,
      specPath: name === relative ? join("v2", "spec", name, "index.md") : join(home, name, "index.md"),
    }));
    const store: StateStore = {
      listRuns: () => runs as never[],
    } as unknown as StateStore;
    const mockRunner: AsyncSubprocessRunner = {
      runAsync: async (cmd, args, cwd) =>
        cmd === "gh" && args[1] === "list" ? "[]" : realAsyncSubprocessRunner.runAsync(cmd, args, cwd ?? projectRoot),
    };
    const registry = { project: { root: projectRoot }, other: { root: otherRoot } };
    let stdout = "";
    const io = { stdout: (s: string) => (stdout += s), stderr: () => {} };

    await runCleanupCommand({ dryRun: true }, registry, jarvisRoot, mockRunner, async () => [], store, io);
    expect(stdout).toContain(`archive: ${join(home, eligible)}`);
    expect(stdout).toContain(`archive: ${join(home, relative)}`);
    expect(stdout).toContain(`archive: ${join(home, otherOnly)}`);
    expect(stdout).toContain(
      `Skipped stranded artifact: ${join(home, owned)} — another materialized worktree owns this spec`,
    );
    expect(stdout).not.toContain(
      `Skipped stranded artifact: ${join(home, eligible)} — another materialized worktree owns this spec`,
    );

    stdout = "";
    await runCleanupCommand(
      {
        promptConfirm: async () => {
          await addWorktree("custom-late");
          return true;
        },
      },
      registry,
      jarvisRoot,
      mockRunner,
      async () => [],
      store,
      io,
    );
    expect(existsSync(join(home, "completed", eligible))).toBe(true);
    expect(existsSync(join(home, late))).toBe(true);
    expect(stdout).toContain(
      `Skipped stranded artifact: ${join(home, late)} — another materialized worktree owns this spec`,
    );

    createSpec(guarded, "[x] Done");
    const detached = await addWorktree("detached-owner");
    await realAsyncSubprocessRunner.runAsync("git", ["checkout", "--detach"], detached);
    stdout = "";
    await runCleanupCommand({ dryRun: true }, registry, jarvisRoot, mockRunner, async () => [], store, io);
    expect(stdout).toContain(
      `Skipped stranded artifact: ${join(home, guarded)} — another materialized worktree owns this spec`,
    );
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
    const store: StateStore = { listRuns: () => [] } as unknown as StateStore;

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
    const store: StateStore = { listRuns: () => [] } as unknown as StateStore;

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
    const store: StateStore = { listRuns: () => [] } as unknown as StateStore;

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

    const candidate: DiscoveredWorktree & { branch: string } = { path: worktreePath, branch };
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

  test("propagates branch-resolution failures instead of skipping a retirement candidate", async () => {
    const branch = "unresolved-branch";
    const worktreesRoot = join(jarvisRoot, "worktrees", "project");
    const worktreePath = join(worktreesRoot, branch);
    await realAsyncSubprocessRunner.runAsync("git", ["branch", branch], projectRoot);
    mkdirSync(worktreesRoot, { recursive: true });
    await realAsyncSubprocessRunner.runAsync("git", ["worktree", "add", worktreePath, branch], projectRoot);

    const runner: AsyncSubprocessRunner = {
      runAsync: async (cmd, args, cwd) => {
        if (cmd === "git" && args[0] === "rev-parse" && args[1] === "--abbrev-ref") {
          throw new Error("branch unavailable");
        }
        return realAsyncSubprocessRunner.runAsync(cmd, args, cwd ?? projectRoot);
      },
    };
    const registry: Record<string, ProjectRegistryEntry> = { project: { root: projectRoot } };

    await expect(discoverMaterializedWorktrees(registry, jarvisRoot, runner)).rejects.toThrow("branch unavailable");
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

describe("cleanup: runAbandonCommand", () => {
  let tempRoot: string;
  let projectRoot: string;
  let jarvisRoot: string;

  async function createUnmergedWorktree(branch: string): Promise<string> {
    // Create a new file with unique content for this branch (sanitize branch name for filename)
    const fileName = `${branch.replace(/\//g, "-")}.txt`;
    writeFileSync(join(projectRoot, fileName), `Content for ${branch}\n`);
    await realAsyncSubprocessRunner.runAsync("git", ["add", "."], projectRoot);
    await realAsyncSubprocessRunner.runAsync("git", ["commit", "-m", `Working on ${branch}`], projectRoot);
    await realAsyncSubprocessRunner.runAsync("git", ["branch", branch], projectRoot);
    const worktreePath = join(jarvisRoot, "worktrees", "project", branch);
    mkdirSync(dirname(worktreePath), { recursive: true });
    await realAsyncSubprocessRunner.runAsync("git", ["worktree", "add", worktreePath, branch], projectRoot);
    return worktreePath;
  }

  beforeEach(async () => {
    tempRoot = join(process.env.TMPDIR || "/tmp", `jarvis-abandon-e2e-${Date.now()}-${Math.random()}`);
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

    // Real local bare remote so remote-branch deletion has an `origin` to act on.
    const originRoot = join(tempRoot, "origin.git");
    await realAsyncSubprocessRunner.runAsync("git", ["init", "--bare", originRoot], tempRoot);
    await realAsyncSubprocessRunner.runAsync("git", ["remote", "add", "origin", originRoot], projectRoot);
  });

  afterEach(() => {
    rmSync(tempRoot, { recursive: true, force: true });
  });

  test("abandon retires an unmerged workspace via git worktree remove --force, branch -D, and push origin --delete", async () => {
    const branch = "feat/test";
    const worktreePath = await createUnmergedWorktree(branch);

    const registry: Record<string, ProjectRegistryEntry> = { project: { root: projectRoot } };
    const daemonClient: DaemonClient = async () => [];

    let stdout = "";
    const invocations: Array<{ cmd: string; args: string[] }> = [];
    const mockRunner: AsyncSubprocessRunner = {
      runAsync: async (cmd, args, cwd) => {
        invocations.push({ cmd, args: [...args] });
        if (cmd === "gh" && args[0] === "pr" && args[1] === "list") {
          return JSON.stringify([{ number: 123, isDraft: true }]);
        }
        if (cmd === "git" && args[0] === "push" && args[1] === "origin") {
          return "";
        }
        if (cmd === "gh" && args[0] === "pr" && args[1] === "close") {
          return "";
        }
        return realAsyncSubprocessRunner.runAsync(cmd, args, cwd ?? projectRoot);
      },
    };

    const code = await (await import("./cleanup.ts")).runAbandonCommand(
      branch,
      { promptConfirm: async () => true },
      registry,
      jarvisRoot,
      mockRunner,
      daemonClient,
      { stdout: (s) => (stdout += s), stderr: () => {} },
    );

    expect(code).toBe(0);
    expect(stdout).toContain("Abandoned workspace");

    // Verify exact git commands were called
    const removeInvocation = invocations.find(
      (i) => i.cmd === "git" && i.args[0] === "worktree" && i.args[1] === "remove",
    );
    expect(removeInvocation?.args).toEqual(["worktree", "remove", "--force", worktreePath]);

    const branchDeleteInvocation = invocations.find(
      (i) => i.cmd === "git" && i.args[0] === "branch" && i.args[1] === "-D",
    );
    expect(branchDeleteInvocation?.args).toEqual(["branch", "-D", branch]);

    const pushDeleteInvocation = invocations.find(
      (i) => i.cmd === "git" && i.args[0] === "push" && i.args[1] === "origin",
    );
    expect(pushDeleteInvocation?.args).toEqual(["push", "origin", "--delete", branch]);

    // Verify worktree and branches are gone
    const listOutput = await realAsyncSubprocessRunner.runAsync("git", ["worktree", "list"], projectRoot);
    expect(listOutput).not.toContain(worktreePath);

    const branchListOutput = await realAsyncSubprocessRunner.runAsync("git", ["branch"], projectRoot);
    expect(branchListOutput).not.toContain(branch);
  });

  test("abandon closes matching draft PR via gh pr close with exact argv", async () => {
    const branch = "feat/with-pr";
    const _worktreePath = await createUnmergedWorktree(branch);

    const registry: Record<string, ProjectRegistryEntry> = { project: { root: projectRoot } };
    const daemonClient: DaemonClient = async () => [];

    const ghInvocations: Array<{ cmd: string; args: string[] }> = [];
    const mockRunner: AsyncSubprocessRunner = {
      runAsync: async (cmd, args, cwd) => {
        if (cmd === "gh") {
          ghInvocations.push({ cmd, args: [...args] });
          if (args[0] === "pr" && args[1] === "list") {
            return JSON.stringify([{ number: 456, isDraft: true }]);
          } else if (args[0] === "pr" && args[1] === "close") {
            return "";
          }
        }
        if (cmd === "git" && args[0] === "push" && args[1] === "origin") {
          return "";
        }
        return realAsyncSubprocessRunner.runAsync(cmd, args, cwd ?? projectRoot);
      },
    };

    const code = await (await import("./cleanup.ts")).runAbandonCommand(
      branch,
      { promptConfirm: async () => true },
      registry,
      jarvisRoot,
      mockRunner,
      daemonClient,
      { stdout: () => {}, stderr: () => {} },
    );

    expect(code).toBe(0);

    // Verify gh pr close was called with exact number
    const closeInvocation = ghInvocations.find((i) => i.args[0] === "pr" && i.args[1] === "close");
    expect(closeInvocation?.args).toEqual(["pr", "close", "456"]);
  });

  test("abandon fails (nonzero) if gh pr close fails", async () => {
    const branch = "feat/pr-close-fails";
    const worktreePath = await createUnmergedWorktree(branch);

    const registry: Record<string, ProjectRegistryEntry> = { project: { root: projectRoot } };
    const daemonClient: DaemonClient = async () => [];

    let stderr = "";
    const mockRunner: AsyncSubprocessRunner = {
      runAsync: async (cmd, args, cwd) => {
        if (cmd === "gh" && args[0] === "pr" && args[1] === "list") {
          return JSON.stringify([{ number: 789, isDraft: true }]);
        }
        if (cmd === "git" && args[0] === "push" && args[1] === "origin") {
          return "";
        }
        if (cmd === "gh" && args[0] === "pr" && args[1] === "close") {
          throw new Error("gh pr close failed");
        }
        return realAsyncSubprocessRunner.runAsync(cmd, args, cwd ?? projectRoot);
      },
    };

    const code = await (await import("./cleanup.ts")).runAbandonCommand(
      branch,
      { promptConfirm: async () => true },
      registry,
      jarvisRoot,
      mockRunner,
      daemonClient,
      { stdout: () => {}, stderr: (s) => (stderr += s) },
    );

    expect(code).toBe(1);
    expect(stderr).toContain("Failed to close PR");

    // Verify worktree was removed (earlier steps succeeded)
    const listOutput = await realAsyncSubprocessRunner.runAsync("git", ["worktree", "list"], projectRoot);
    expect(listOutput).not.toContain(worktreePath);
  });

  test("abandon refuses a workspace held by a live run (daemon isLive)", async () => {
    const branch = "feat/live-daemon";
    const worktreePath = await createUnmergedWorktree(branch);

    const registry: Record<string, ProjectRegistryEntry> = { project: { root: projectRoot } };
    const daemonClient: DaemonClient = async (project, b) => {
      if (project === "project" && b === branch) {
        return [{ isLive: true }];
      }
      return [];
    };

    let stderr = "";
    const code = await (await import("./cleanup.ts")).runAbandonCommand(
      branch,
      { promptConfirm: async () => true },
      registry,
      jarvisRoot,
      realAsyncSubprocessRunner,
      daemonClient,
      { stdout: () => {}, stderr: (s) => (stderr += s) },
    );

    expect(code).toBe(1);
    expect(stderr).toContain("Cannot abandon");
    expect(stderr).toContain("daemon reports live run");

    // Verify worktree still exists
    const listOutput = await realAsyncSubprocessRunner.runAsync("git", ["worktree", "list"], projectRoot);
    expect(listOutput).toContain(worktreePath);
  });

  test("abandon refuses a missing worktree", async () => {
    const registry: Record<string, ProjectRegistryEntry> = { project: { root: projectRoot } };
    const daemonClient: DaemonClient = async () => [];

    let stderr = "";
    const code = await (await import("./cleanup.ts")).runAbandonCommand(
      "nonexistent",
      { promptConfirm: async () => true },
      registry,
      jarvisRoot,
      realAsyncSubprocessRunner,
      daemonClient,
      { stdout: () => {}, stderr: (s) => (stderr += s) },
    );

    expect(code).toBe(1);
    expect(stderr).toContain("No worktree found matching name");
  });

  test("abandon leaves spec files and run rows intact", async () => {
    const branch = "feat/spec-intact";
    const worktreePath = await createUnmergedWorktree(branch);

    // Create a spec file in the worktree
    const specDir = join(worktreePath, "v2", "spec", "test-spec");
    mkdirSync(specDir, { recursive: true });
    writeFileSync(join(specDir, "index.md"), "# Test Spec\n");

    // Create a spec file in the project root (the source)
    const projectSpecDir = join(projectRoot, "v2", "spec", "test-spec");
    mkdirSync(projectSpecDir, { recursive: true });
    writeFileSync(join(projectSpecDir, "index.md"), "# Test Spec\n");

    const registry: Record<string, ProjectRegistryEntry> = { project: { root: projectRoot } };
    const daemonClient: DaemonClient = async () => [];

    const mockRunner: AsyncSubprocessRunner = {
      runAsync: async (cmd, args, cwd) => {
        if (cmd === "gh" && args[0] === "pr" && args[1] === "list") {
          return JSON.stringify([{ number: 789, isDraft: true }]);
        }
        if (cmd === "git" && args[0] === "push" && args[1] === "origin") {
          return "";
        }
        if (cmd === "gh" && args[0] === "pr" && args[1] === "close") {
          return "";
        }
        return realAsyncSubprocessRunner.runAsync(cmd, args, cwd ?? projectRoot);
      },
    };

    const code = await (await import("./cleanup.ts")).runAbandonCommand(
      branch,
      { promptConfirm: async () => true },
      registry,
      jarvisRoot,
      mockRunner,
      daemonClient,
      { stdout: () => {}, stderr: () => {} },
    );

    expect(code).toBe(0);

    // Verify source spec files remain
    expect(existsSync(projectSpecDir)).toBe(true);
    expect(existsSync(join(projectSpecDir, "index.md"))).toBe(true);
  });

  test("abandon previews and declines confirmation changes nothing", async () => {
    const branch = "feat/decline";
    const worktreePath = await createUnmergedWorktree(branch);

    const registry: Record<string, ProjectRegistryEntry> = { project: { root: projectRoot } };
    const daemonClient: DaemonClient = async () => [];

    let stdout = "";
    let gitRemoveInvoked = false;
    const mockRunner: AsyncSubprocessRunner = {
      runAsync: async (cmd, args, cwd) => {
        if (cmd === "git" && args[0] === "worktree" && args[1] === "remove") {
          gitRemoveInvoked = true;
        }
        if (cmd === "gh" && args[0] === "pr" && args[1] === "view") {
          return JSON.stringify({ number: 999, state: "DRAFT" });
        }
        return realAsyncSubprocessRunner.runAsync(cmd, args, cwd ?? projectRoot);
      },
    };

    const code = await (await import("./cleanup.ts")).runAbandonCommand(
      branch,
      { promptConfirm: async () => false },
      registry,
      jarvisRoot,
      mockRunner,
      daemonClient,
      { stdout: (s) => (stdout += s), stderr: () => {} },
    );

    expect(code).toBe(0);
    expect(stdout).toContain("Preview abandon");
    expect(stdout).toContain("Cancelled");
    expect(gitRemoveInvoked).toBe(false);

    // Verify worktree still exists
    const listOutput = await realAsyncSubprocessRunner.runAsync("git", ["worktree", "list"], projectRoot);
    expect(listOutput).toContain(worktreePath);
  });

  test("abandon with --dry-run previews without changes", async () => {
    const branch = "feat/dry-run";
    const worktreePath = await createUnmergedWorktree(branch);

    const registry: Record<string, ProjectRegistryEntry> = { project: { root: projectRoot } };
    const daemonClient: DaemonClient = async () => [];

    let stdout = "";
    let gitRemoveInvoked = false;
    const mockRunner: AsyncSubprocessRunner = {
      runAsync: async (cmd, args, cwd) => {
        if (cmd === "git" && args[0] === "worktree" && args[1] === "remove") {
          gitRemoveInvoked = true;
        }
        if (cmd === "gh" && args[0] === "pr" && args[1] === "view") {
          return JSON.stringify({ number: 111, state: "DRAFT" });
        }
        return realAsyncSubprocessRunner.runAsync(cmd, args, cwd ?? projectRoot);
      },
    };

    const code = await (await import("./cleanup.ts")).runAbandonCommand(
      branch,
      { dryRun: true },
      registry,
      jarvisRoot,
      mockRunner,
      daemonClient,
      { stdout: (s) => (stdout += s), stderr: () => {} },
    );

    expect(code).toBe(0);
    expect(stdout).toContain("Preview abandon");
    expect(stdout).toContain("dry-run");
    expect(gitRemoveInvoked).toBe(false);

    // Verify worktree still exists
    const listOutput = await realAsyncSubprocessRunner.runAsync("git", ["worktree", "list"], projectRoot);
    expect(listOutput).toContain(worktreePath);
  });

  test("abandon refuses when the matching PR is ready (non-draft)", async () => {
    const branch = "feat/ready-pr";
    const worktreePath = await createUnmergedWorktree(branch);

    const registry: Record<string, ProjectRegistryEntry> = { project: { root: projectRoot } };
    const daemonClient: DaemonClient = async () => [];

    let stderr = "";
    let gitRemoveInvoked = false;
    const mockRunner: AsyncSubprocessRunner = {
      runAsync: async (cmd, args, cwd) => {
        if (cmd === "git" && args[0] === "worktree" && args[1] === "remove") {
          gitRemoveInvoked = true;
        }
        if (cmd === "gh" && args[0] === "pr" && args[1] === "list") {
          return JSON.stringify([{ number: 222, isDraft: false }]);
        }
        if (cmd === "gh" && args[0] === "pr" && args[1] === "view") {
          return JSON.stringify({ number: 222, state: "OPEN" });
        }
        return realAsyncSubprocessRunner.runAsync(cmd, args, cwd ?? projectRoot);
      },
    };

    const code = await (await import("./cleanup.ts")).runAbandonCommand(
      branch,
      { promptConfirm: async () => true },
      registry,
      jarvisRoot,
      mockRunner,
      daemonClient,
      { stdout: () => {}, stderr: (s) => (stderr += s) },
    );

    expect(code).toBe(1);
    expect(stderr).toContain("Cannot abandon");
    expect(stderr).toContain("ready");
    expect(gitRemoveInvoked).toBe(false);

    // Verify worktree still exists
    const listOutput = await realAsyncSubprocessRunner.runAsync("git", ["worktree", "list"], projectRoot);
    expect(listOutput).toContain(worktreePath);
  });

  test("abandon refuses when multiple open PRs match the branch", async () => {
    const branch = "feat/multi-pr";
    const worktreePath = await createUnmergedWorktree(branch);

    const registry: Record<string, ProjectRegistryEntry> = { project: { root: projectRoot } };
    const daemonClient: DaemonClient = async () => [];

    let stderr = "";
    let gitRemoveInvoked = false;
    const mockRunner: AsyncSubprocessRunner = {
      runAsync: async (cmd, args, cwd) => {
        if (cmd === "git" && args[0] === "worktree" && args[1] === "remove") {
          gitRemoveInvoked = true;
        }
        if (cmd === "gh" && args[0] === "pr" && args[1] === "list") {
          return JSON.stringify([
            { number: 333, state: "DRAFT" },
            { number: 334, state: "OPEN" },
          ]);
        }
        return realAsyncSubprocessRunner.runAsync(cmd, args, cwd ?? projectRoot);
      },
    };

    const code = await (await import("./cleanup.ts")).runAbandonCommand(
      branch,
      { promptConfirm: async () => true },
      registry,
      jarvisRoot,
      mockRunner,
      daemonClient,
      { stdout: () => {}, stderr: (s) => (stderr += s) },
    );

    expect(code).toBe(1);
    expect(stderr).toContain("Cannot abandon");
    expect(stderr).toContain("multiple open PRs");
    expect(gitRemoveInvoked).toBe(false);

    // Verify worktree still exists
    const listOutput = await realAsyncSubprocessRunner.runAsync("git", ["worktree", "list"], projectRoot);
    expect(listOutput).toContain(worktreePath);
  });

  test("abandon proceeds with single open draft PR, passes through to retirement", async () => {
    const branch = "feat/draft-pr";
    const worktreePath = await createUnmergedWorktree(branch);

    const registry: Record<string, ProjectRegistryEntry> = { project: { root: projectRoot } };
    const daemonClient: DaemonClient = async () => [];

    let stdout = "";
    let gitRemoveInvoked = false;
    const mockRunner: AsyncSubprocessRunner = {
      runAsync: async (cmd, args, cwd) => {
        if (cmd === "git" && args[0] === "worktree" && args[1] === "remove") {
          gitRemoveInvoked = true;
        }
        if (cmd === "git" && args[0] === "push" && args[1] === "origin") {
          // Mock successful remote branch deletion
          return "";
        }
        if (cmd === "gh" && args[0] === "pr" && args[1] === "list") {
          return JSON.stringify([{ number: 445, isDraft: true }]);
        }
        if (cmd === "gh" && args[0] === "pr" && args[1] === "view") {
          return JSON.stringify({ number: 445, state: "DRAFT" });
        }
        if (cmd === "gh" && args[0] === "pr" && args[1] === "close") {
          // Mock successful PR close
          return "";
        }
        return realAsyncSubprocessRunner.runAsync(cmd, args, cwd ?? projectRoot);
      },
    };

    const code = await (await import("./cleanup.ts")).runAbandonCommand(
      branch,
      { promptConfirm: async () => true },
      registry,
      jarvisRoot,
      mockRunner,
      daemonClient,
      { stdout: (s) => (stdout += s), stderr: () => {} },
    );

    expect(code).toBe(0);
    expect(stdout).toContain("Abandoned workspace");
    expect(gitRemoveInvoked).toBe(true);

    // Verify worktree is gone
    const listOutput = await realAsyncSubprocessRunner.runAsync("git", ["worktree", "list"], projectRoot);
    expect(listOutput).not.toContain(worktreePath);
  });

  test("abandon aborts and exits nonzero on worktree removal failure, leaving branches and PR intact", async () => {
    const branch = "feat/abort-worktree";
    const worktreePath = await createUnmergedWorktree(branch);

    const registry: Record<string, ProjectRegistryEntry> = { project: { root: projectRoot } };
    const daemonClient: DaemonClient = async () => [];

    let stderr = "";
    const invocations: Array<{ cmd: string; args: string[]; step: string }> = [];
    const mockRunner: AsyncSubprocessRunner = {
      runAsync: async (cmd, args, cwd) => {
        if (cmd === "git" && args[0] === "worktree" && args[1] === "remove") {
          invocations.push({ cmd, args: [...args], step: "remove-worktree" });
          throw new Error("simulated worktree remove failure");
        }
        if (cmd === "git" && args[0] === "branch" && args[1] === "-D") {
          invocations.push({ cmd, args: [...args], step: "delete-branch" });
        }
        if (cmd === "git" && args[0] === "push" && args[1] === "origin") {
          invocations.push({ cmd, args: [...args], step: "delete-remote" });
        }
        if (cmd === "gh" && args[0] === "pr" && args[1] === "close") {
          invocations.push({ cmd, args: [...args], step: "close-pr" });
        }
        if (cmd === "gh" && args[0] === "pr" && args[1] === "list") {
          return JSON.stringify([{ number: 555, isDraft: true }]);
        }
        return realAsyncSubprocessRunner.runAsync(cmd, args, cwd ?? projectRoot);
      },
    };

    const code = await (await import("./cleanup.ts")).runAbandonCommand(
      branch,
      { promptConfirm: async () => true },
      registry,
      jarvisRoot,
      mockRunner,
      daemonClient,
      { stdout: () => {}, stderr: (s) => (stderr += s) },
    );

    expect(code).toBe(1);
    expect(stderr).toContain("Failed to remove worktree");
    // Later steps should not be executed
    expect(invocations.map((i) => i.step)).toEqual(["remove-worktree"]);
    // Worktree still exists
    const listOutput = await realAsyncSubprocessRunner.runAsync("git", ["worktree", "list"], projectRoot);
    expect(listOutput).toContain(worktreePath);
  });

  test("abandon aborts and exits nonzero on local branch deletion failure, leaving remote branch and PR intact", async () => {
    const branch = "feat/abort-local-branch";
    await createUnmergedWorktree(branch);

    const registry: Record<string, ProjectRegistryEntry> = { project: { root: projectRoot } };
    const daemonClient: DaemonClient = async () => [];

    let stderr = "";
    const invocations: Array<string> = [];
    const mockRunner: AsyncSubprocessRunner = {
      runAsync: async (cmd, args, cwd) => {
        if (cmd === "git" && args[0] === "branch" && args[1] === "-D") {
          invocations.push("delete-branch");
          throw new Error("simulated branch delete failure");
        }
        if (cmd === "git" && args[0] === "push" && args[1] === "origin") {
          invocations.push("delete-remote");
        }
        if (cmd === "gh" && args[0] === "pr" && args[1] === "close") {
          invocations.push("close-pr");
        }
        if (cmd === "gh" && args[0] === "pr" && args[1] === "list") {
          return JSON.stringify([{ number: 556, isDraft: true }]);
        }
        return realAsyncSubprocessRunner.runAsync(cmd, args, cwd ?? projectRoot);
      },
    };

    const code = await (await import("./cleanup.ts")).runAbandonCommand(
      branch,
      { promptConfirm: async () => true },
      registry,
      jarvisRoot,
      mockRunner,
      daemonClient,
      { stdout: () => {}, stderr: (s) => (stderr += s) },
    );

    expect(code).toBe(1);
    expect(stderr).toContain("Failed to delete local branch");
    // Only up to and including the failed step
    expect(invocations).toEqual(["delete-branch"]);
    // Remote branch should not be deleted and PR should not be closed
  });

  test("abandon aborts and exits nonzero on remote branch deletion failure, leaving PR intact", async () => {
    const branch = "feat/abort-remote-branch";
    await createUnmergedWorktree(branch);

    const registry: Record<string, ProjectRegistryEntry> = { project: { root: projectRoot } };
    const daemonClient: DaemonClient = async () => [];

    let stderr = "";
    const invocations: Array<string> = [];
    const mockRunner: AsyncSubprocessRunner = {
      runAsync: async (cmd, args, cwd) => {
        if (cmd === "git" && args[0] === "push" && args[1] === "origin") {
          invocations.push("delete-remote");
          throw new Error("simulated remote delete failure");
        }
        if (cmd === "gh" && args[0] === "pr" && args[1] === "close") {
          invocations.push("close-pr");
        }
        if (cmd === "gh" && args[0] === "pr" && args[1] === "list") {
          return JSON.stringify([{ number: 557, isDraft: true }]);
        }
        return realAsyncSubprocessRunner.runAsync(cmd, args, cwd ?? projectRoot);
      },
    };

    const code = await (await import("./cleanup.ts")).runAbandonCommand(
      branch,
      { promptConfirm: async () => true },
      registry,
      jarvisRoot,
      mockRunner,
      daemonClient,
      { stdout: () => {}, stderr: (s) => (stderr += s) },
    );

    expect(code).toBe(1);
    expect(stderr).toContain("Failed to delete remote branch");
    // Only up to and including the failed step
    expect(invocations).toEqual(["delete-remote"]);
    // PR should not be closed
  });

  test("abandon aborts and exits nonzero on PR closure failure", async () => {
    const branch = "feat/abort-pr-close";
    const worktreePath = await createUnmergedWorktree(branch);

    const registry: Record<string, ProjectRegistryEntry> = { project: { root: projectRoot } };
    const daemonClient: DaemonClient = async () => [];

    let stderr = "";
    const invocations: Array<string> = [];
    const mockRunner: AsyncSubprocessRunner = {
      runAsync: async (cmd, args, cwd) => {
        if (cmd === "git" && args[0] === "push" && args[1] === "origin") {
          invocations.push("delete-remote");
          return "";
        }
        if (cmd === "gh" && args[0] === "pr" && args[1] === "close") {
          invocations.push("close-pr");
          throw new Error("simulated PR close failure");
        }
        if (cmd === "gh" && args[0] === "pr" && args[1] === "list") {
          return JSON.stringify([{ number: 558, isDraft: true }]);
        }
        return realAsyncSubprocessRunner.runAsync(cmd, args, cwd ?? projectRoot);
      },
    };

    const code = await (await import("./cleanup.ts")).runAbandonCommand(
      branch,
      { promptConfirm: async () => true },
      registry,
      jarvisRoot,
      mockRunner,
      daemonClient,
      { stdout: () => {}, stderr: (s) => (stderr += s) },
    );

    expect(code).toBe(1);
    expect(stderr).toContain("Failed to close PR");
    // The remote delete ran and nothing followed the failed closure
    expect(invocations).toEqual(["delete-remote", "close-pr"]);
    // Worktree should be removed despite PR close failure
    const listOutput = await realAsyncSubprocessRunner.runAsync("git", ["worktree", "list"], projectRoot);
    expect(listOutput).not.toContain(worktreePath);
  });

  test("abandon executes steps in order: remove worktree, delete local branch, delete remote branch, close PR", async () => {
    const branch = "feat/step-order";
    await createUnmergedWorktree(branch);

    const registry: Record<string, ProjectRegistryEntry> = { project: { root: projectRoot } };
    const daemonClient: DaemonClient = async () => [];

    const stepOrder: Array<string> = [];
    const mockRunner: AsyncSubprocessRunner = {
      runAsync: async (cmd, args, cwd) => {
        if (cmd === "git" && args[0] === "worktree" && args[1] === "remove") {
          stepOrder.push("remove-worktree");
        }
        if (cmd === "git" && args[0] === "branch" && args[1] === "-D") {
          stepOrder.push("delete-local-branch");
        }
        if (cmd === "git" && args[0] === "push" && args[1] === "origin") {
          stepOrder.push("delete-remote-branch");
          return "";
        }
        if (cmd === "gh" && args[0] === "pr" && args[1] === "close") {
          stepOrder.push("close-pr");
          return "";
        }
        if (cmd === "gh" && args[0] === "pr" && args[1] === "list") {
          return JSON.stringify([{ number: 559, isDraft: true }]);
        }
        return realAsyncSubprocessRunner.runAsync(cmd, args, cwd ?? projectRoot);
      },
    };

    const code = await (await import("./cleanup.ts")).runAbandonCommand(
      branch,
      { promptConfirm: async () => true },
      registry,
      jarvisRoot,
      mockRunner,
      daemonClient,
      { stdout: () => {}, stderr: () => {} },
    );

    expect(code).toBe(0);
    expect(stepOrder).toEqual(["remove-worktree", "delete-local-branch", "delete-remote-branch", "close-pr"]);
  });

  // Goal-state cases: the remote branch is already gone. Both run real git so the
  // absence is observed end-to-end rather than stubbed.
  test("abandon succeeds when the repo has no origin remote", async () => {
    const branch = "feat/no-origin";
    const worktreePath = await createUnmergedWorktree(branch);
    await realAsyncSubprocessRunner.runAsync("git", ["remote", "remove", "origin"], projectRoot);

    const registry: Record<string, ProjectRegistryEntry> = { project: { root: projectRoot } };
    const daemonClient: DaemonClient = async () => [];

    let stdout = "";
    const gitCommands: string[][] = [];
    const mockRunner: AsyncSubprocessRunner = {
      runAsync: async (cmd, args, cwd) => {
        if (cmd === "gh" && args[0] === "pr" && args[1] === "list") return "[]";
        if (cmd === "git") gitCommands.push([...args]);
        return realAsyncSubprocessRunner.runAsync(cmd, args, cwd ?? projectRoot);
      },
    };

    const code = await (await import("./cleanup.ts")).runAbandonCommand(
      branch,
      { promptConfirm: async () => true },
      registry,
      jarvisRoot,
      mockRunner,
      daemonClient,
      { stdout: (s) => (stdout += s), stderr: () => {} },
    );

    expect(code).toBe(0);
    expect(stdout).toContain("already absent");
    expect(stdout).toContain("Abandoned workspace");
    expect(gitCommands.some((args) => args[0] === "push")).toBe(false);
    const listOutput = await realAsyncSubprocessRunner.runAsync("git", ["worktree", "list"], projectRoot);
    expect(listOutput).not.toContain(worktreePath);
  });

  test("abandon succeeds when the branch was never pushed to origin, then closes the PR", async () => {
    const branch = "feat/never-pushed";
    const worktreePath = await createUnmergedWorktree(branch);

    const registry: Record<string, ProjectRegistryEntry> = { project: { root: projectRoot } };
    const daemonClient: DaemonClient = async () => [];

    let stdout = "";
    const stepOrder: string[] = [];
    const mockRunner: AsyncSubprocessRunner = {
      runAsync: async (cmd, args, cwd) => {
        if (cmd === "gh" && args[0] === "pr" && args[1] === "list") {
          return JSON.stringify([{ number: 561, isDraft: true }]);
        }
        if (cmd === "gh" && args[0] === "pr" && args[1] === "close") {
          stepOrder.push("close-pr");
          return "";
        }
        // Real `git push origin --delete` against the bare origin that never
        // received this branch: git reports "remote ref does not exist".
        if (cmd === "git" && args[0] === "push") stepOrder.push("delete-remote");
        return realAsyncSubprocessRunner.runAsync(cmd, args, cwd ?? projectRoot);
      },
    };

    const code = await (await import("./cleanup.ts")).runAbandonCommand(
      branch,
      { promptConfirm: async () => true },
      registry,
      jarvisRoot,
      mockRunner,
      daemonClient,
      { stdout: (s) => (stdout += s), stderr: () => {} },
    );

    expect(code).toBe(0);
    expect(stdout).toContain(`Remote branch ${branch} already absent`);
    expect(stepOrder).toEqual(["delete-remote", "close-pr"]);
    const listOutput = await realAsyncSubprocessRunner.runAsync("git", ["worktree", "list"], projectRoot);
    expect(listOutput).not.toContain(worktreePath);
  });

  test("abandon preview lists actions in execution order", async () => {
    const branch = "feat/preview-order";
    await createUnmergedWorktree(branch);

    const registry: Record<string, ProjectRegistryEntry> = { project: { root: projectRoot } };
    const daemonClient: DaemonClient = async () => [];

    let stdout = "";
    const mockRunner: AsyncSubprocessRunner = {
      runAsync: async (cmd, args, cwd) => {
        if (cmd === "gh" && args[0] === "pr" && args[1] === "list") {
          return JSON.stringify([{ number: 560, isDraft: true }]);
        }
        return realAsyncSubprocessRunner.runAsync(cmd, args, cwd ?? projectRoot);
      },
    };

    const code = await (await import("./cleanup.ts")).runAbandonCommand(
      branch,
      { dryRun: true },
      registry,
      jarvisRoot,
      mockRunner,
      daemonClient,
      { stdout: (s) => (stdout += s), stderr: () => {} },
    );

    expect(code).toBe(0);
    // Verify preview order: remove worktree, delete local, delete remote, then close PR
    const removeIdx = stdout.indexOf("remove: worktree");
    const deleteLocalIdx = stdout.indexOf("delete: local branch");
    const deleteRemoteIdx = stdout.indexOf("delete: remote branch");
    const closeIdx = stdout.indexOf("close: PR");
    expect(removeIdx).toBeGreaterThan(0);
    expect(deleteLocalIdx).toBeGreaterThan(removeIdx);
    expect(deleteRemoteIdx).toBeGreaterThan(deleteLocalIdx);
    expect(closeIdx).toBeGreaterThan(deleteRemoteIdx);
  });
});

describe("cleanup: dead daemon socket reaping", () => {
  const socketTest = test.skipIf(!canUseUnixSockets());
  let tempRoot: string;
  let jarvisRoot: string;

  beforeEach(() => {
    tempRoot = join(process.env.TMPDIR || "/tmp", `jarvis-socket-reap-${Date.now()}-${Math.random()}`);
    jarvisRoot = join(tempRoot, "jarvis-home");
    mkdirSync(jarvisRoot, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempRoot, { recursive: true, force: true });
  });

  test("runCleanupCommand removes a dead daemon socket whose connect proves no listener is bound", async () => {
    const deadSocket = join(jarvisRoot, "daemon-0000000000000001.sock");
    writeFileSync(deadSocket, "");

    const registry: Record<string, ProjectRegistryEntry> = {};
    const daemonClient: DaemonClient = async () => [];
    const store: StateStore = { listRuns: () => [] } as unknown as StateStore;

    let stdout = "";
    const code = await runCleanupCommand(
      { promptConfirm: async () => true },
      registry,
      jarvisRoot,
      realAsyncSubprocessRunner,
      daemonClient,
      store,
      {
        stdout: (s) => (stdout += s),
        stderr: () => {},
      },
    );

    expect(code).toBe(0);
    expect(stdout).toContain("dead daemon socket(s)");
    expect(existsSync(deadSocket)).toBe(false);
  });

  socketTest("runCleanupCommand preserves every socket a daemon answers on", async () => {
    const liveSocket = join(jarvisRoot, "daemon-0000000000000010.sock");
    rmSync(liveSocket, { force: true });
    const server = await startIpcServer(liveSocket, {
      health: () => ({ kind: "response", result: { ok: true } }),
    });

    const registry: Record<string, ProjectRegistryEntry> = {};
    const daemonClient: DaemonClient = async () => [];
    const store: StateStore = { listRuns: () => [] } as unknown as StateStore;

    let stdout = "";
    try {
      const code = await runCleanupCommand(
        { promptConfirm: async () => true },
        registry,
        jarvisRoot,
        realAsyncSubprocessRunner,
        daemonClient,
        store,
        {
          stdout: (s) => (stdout += s),
          stderr: () => {},
        },
      );

      expect(code).toBe(0);
      expect(existsSync(liveSocket)).toBe(true);
      expect(stdout).not.toContain(`remove: ${liveSocket}`);
    } finally {
      await server.close();
    }
  });

  test("runCleanupCommand with --dry-run lists dead sockets and removes none", async () => {
    const deadSocket = join(jarvisRoot, "daemon-0000000000000002.sock");
    writeFileSync(deadSocket, "");

    const registry: Record<string, ProjectRegistryEntry> = {};
    const daemonClient: DaemonClient = async () => [];
    const store: StateStore = { listRuns: () => [] } as unknown as StateStore;

    let stdout = "";
    const code = await runCleanupCommand(
      { dryRun: true },
      registry,
      jarvisRoot,
      realAsyncSubprocessRunner,
      daemonClient,
      store,
      {
        stdout: (s) => (stdout += s),
        stderr: () => {},
      },
    );

    expect(code).toBe(0);
    expect(stdout).toContain("dry-run");
    expect(stdout).toContain(`remove: ${deadSocket}`);
    expect(existsSync(deadSocket)).toBe(true);
  });

  test("cleanup run with only dead sockets previews and reaps them instead of reporting nothing to clean up", async () => {
    const deadSocket = join(jarvisRoot, "daemon-0000000000000003.sock");
    writeFileSync(deadSocket, "");

    const registry: Record<string, ProjectRegistryEntry> = {};
    const daemonClient: DaemonClient = async () => [];
    const store: StateStore = { listRuns: () => [] } as unknown as StateStore;

    let stdout = "";
    const code = await runCleanupCommand(
      { promptConfirm: async () => true },
      registry,
      jarvisRoot,
      realAsyncSubprocessRunner,
      daemonClient,
      store,
      {
        stdout: (s) => (stdout += s),
        stderr: () => {},
      },
    );

    expect(code).toBe(0);
    expect(stdout).not.toContain("No eligible worktrees");
    expect(stdout).toContain("dead daemon socket(s)");
    expect(existsSync(deadSocket)).toBe(false);
  });

  test("enumeration failure removes no socket in that cleanup run", async () => {
    const socket = join(jarvisRoot, "daemon-0000000000000011.sock");
    writeFileSync(socket, "");

    const registry: Record<string, ProjectRegistryEntry> = {};
    const daemonClient: DaemonClient = async () => [];
    const store: StateStore = { listRuns: () => [] } as unknown as StateStore;

    chmodSync(jarvisRoot, 0o000);
    try {
      let stdout = "";
      const code = await runCleanupCommand(
        { promptConfirm: async () => true },
        registry,
        jarvisRoot,
        realAsyncSubprocessRunner,
        daemonClient,
        store,
        {
          stdout: (s) => (stdout += s),
          stderr: () => {},
        },
      );

      expect(code).toBe(0);
      expect(stdout).not.toContain(`remove: ${socket}`);
    } finally {
      chmodSync(jarvisRoot, 0o700);
    }

    expect(existsSync(socket)).toBe(true);
  });

  socketTest("reports preserved sockets when they are the only socket work", async () => {
    const preservedSocket = join(jarvisRoot, "daemon-0000000000000012.sock");
    rmSync(preservedSocket, { force: true });
    const server = createServer(() => {});
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(preservedSocket, () => resolve());
    });

    const registry: Record<string, ProjectRegistryEntry> = {};
    const daemonClient: DaemonClient = async () => [];
    const store: StateStore = { listRuns: () => [] } as unknown as StateStore;

    let stdout = "";
    try {
      const code = await runCleanupCommand(
        { dryRun: true },
        registry,
        jarvisRoot,
        realAsyncSubprocessRunner,
        daemonClient,
        store,
        {
          stdout: (s) => (stdout += s),
          stderr: () => {},
        },
      );

      expect(code).toBe(0);
      expect(stdout).not.toContain("No eligible worktrees");
      expect(stdout).toContain("Preserved 1 daemon socket(s):");
      expect(stdout).toContain(preservedSocket);
      expect(stdout).toContain("timed out");
      expect(existsSync(preservedSocket)).toBe(true);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

describe("resetStaleWorkspace: incomplete implement re-run reset", () => {
  let tempRoot: string;
  let projectRoot: string;
  let jarvisRoot: string;

  const silentIo = { stdout: () => {}, stderr: () => {} };
  const noLiveDaemon: DaemonClient = async () => [];

  type OpenPr = { number: number; isDraft: boolean };

  async function setupWorktreeAndBranch(branch: string): Promise<string> {
    const sanitizedBranchName = branch.replace(/\//g, "-");
    writeFileSync(join(projectRoot, `file-${sanitizedBranchName}.txt`), `Content for ${branch}\n`);
    await realAsyncSubprocessRunner.runAsync("git", ["add", "."], projectRoot);
    await realAsyncSubprocessRunner.runAsync("git", ["commit", "-m", `Setup for ${branch}`], projectRoot);
    await realAsyncSubprocessRunner.runAsync("git", ["branch", branch], projectRoot);
    const worktreePath = join(jarvisRoot, "worktrees", "project", branch);
    mkdirSync(dirname(worktreePath), { recursive: true });
    await realAsyncSubprocessRunner.runAsync("git", ["worktree", "add", worktreePath, branch], projectRoot);
    return worktreePath;
  }

  function callReset(
    branch: string,
    runner: AsyncSubprocessRunner = realAsyncSubprocessRunner,
    daemonClient: DaemonClient = noLiveDaemon,
    io: { stdout: (s: string) => void; stderr: (s: string) => void } = silentIo,
  ) {
    return resetStaleWorkspace("project", branch, projectRoot, jarvisRoot, runner, daemonClient, io);
  }

  function ghPrListRunner(prs: OpenPr[]): AsyncSubprocessRunner {
    return {
      runAsync: async (cmd, args, cwd) => {
        if (cmd === "gh" && args[0] === "pr" && args[1] === "list") return JSON.stringify(prs);
        if (cmd === "git" && args[0] === "push" && args[1] === "origin") return "";
        if (cmd === "gh" && args[0] === "pr" && args[1] === "close") return "";
        return realAsyncSubprocessRunner.runAsync(cmd, args, cwd ?? projectRoot);
      },
    };
  }

  beforeEach(async () => {
    tempRoot = join(process.env.TMPDIR || "/tmp", `jarvis-reset-e2e-${Date.now()}-${Math.random()}`);
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

    // Real local bare remote so remote-branch deletion has an `origin` to act on.
    const originRoot = join(tempRoot, "origin.git");
    await realAsyncSubprocessRunner.runAsync("git", ["init", "--bare", originRoot], tempRoot);
    await realAsyncSubprocessRunner.runAsync("git", ["remote", "add", "origin", originRoot], projectRoot);
  });

  afterEach(() => {
    rmSync(tempRoot, { recursive: true, force: true });
  });

  test("reset removes stale worktree and draft PR before re-run", async () => {
    const branch = "impl/stale-reset";
    const worktreePath = await setupWorktreeAndBranch(branch);

    const closedPrs: number[] = [];
    const mockRunner: AsyncSubprocessRunner = {
      runAsync: async (cmd, args, cwd) => {
        if (cmd === "gh" && args[0] === "pr" && args[1] === "list") {
          return JSON.stringify([{ number: 123, isDraft: true }]);
        }
        if (cmd === "git" && args[0] === "push" && args[1] === "origin") {
          return "";
        }
        if (cmd === "gh" && args[0] === "pr" && args[1] === "close") {
          closedPrs.push(Number(args[2]));
          return "";
        }
        return realAsyncSubprocessRunner.runAsync(cmd, args, cwd ?? projectRoot);
      },
    };

    let stdout = "";
    const result = await callReset(branch, mockRunner, noLiveDaemon, {
      stdout: (s) => (stdout += s),
      stderr: () => {},
    });

    expect(result.status).toBe("reset");
    expect(stdout).toContain("Closed PR #123");
    expect(stdout).toContain("Removed worktree");
    expect(stdout).toContain("Deleted");
    expect(closedPrs).toContain(123);

    const listOutput = await realAsyncSubprocessRunner.runAsync("git", ["worktree", "list"], projectRoot);
    expect(listOutput).not.toContain(worktreePath);
  });

  test("reset refuses when worktree is live-held by daemon", async () => {
    const branch = "impl/live-held";
    const worktreePath = await setupWorktreeAndBranch(branch);

    const result = await callReset(branch, realAsyncSubprocessRunner, async () => [{ isLive: true }]);

    expect(result).toEqual({ status: "refused", reason: expect.stringContaining("live run") });
    const listOutput = await realAsyncSubprocessRunner.runAsync("git", ["worktree", "list"], projectRoot);
    expect(listOutput).toContain(worktreePath);
  });

  test("reset refuses when matching PR is ready (non-draft)", async () => {
    const branch = "impl/ready-pr";
    const worktreePath = await setupWorktreeAndBranch(branch);

    const result = await callReset(branch, ghPrListRunner([{ number: 456, isDraft: false }]));

    expect(result).toEqual({ status: "refused", reason: "matching PR is ready (non-draft)" });
    const listOutput = await realAsyncSubprocessRunner.runAsync("git", ["worktree", "list"], projectRoot);
    expect(listOutput).toContain(worktreePath);
  });

  test("reset refuses when multiple open PRs match the branch", async () => {
    const branch = "impl/multi-pr";
    const worktreePath = await setupWorktreeAndBranch(branch);

    const result = await callReset(
      branch,
      ghPrListRunner([
        { number: 111, isDraft: true },
        { number: 112, isDraft: true },
      ]),
    );

    expect(result).toEqual({ status: "refused", reason: "multiple open PRs match branch" });
    const listOutput = await realAsyncSubprocessRunner.runAsync("git", ["worktree", "list"], projectRoot);
    expect(listOutput).toContain(worktreePath);
  });

  test("reset is no-op when no stale worktree exists", async () => {
    const branch = "impl/no-worktree";

    const teardownCalls: string[] = [];
    const mockRunner: AsyncSubprocessRunner = {
      runAsync: async (cmd, args, cwd) => {
        if (cmd === "gh" && args[0] === "pr" && args[1] === "close") teardownCalls.push("pr-close");
        if (cmd === "git" && args[0] === "branch" && args[1] === "-D") teardownCalls.push("branch-delete");
        if (cmd === "git" && args[0] === "push" && args[1] === "origin") teardownCalls.push("push-delete");
        return realAsyncSubprocessRunner.runAsync(cmd, args, cwd ?? projectRoot);
      },
    };

    const result = await callReset(branch, mockRunner);

    expect(result.status).toBe("no-op");
    expect(teardownCalls).toEqual([]);
  });

  test("reset leaves the source spec tree intact", async () => {
    const branch = "impl/spec-survives";
    const specDir = join(projectRoot, "v2", "spec", "my-spec");
    mkdirSync(specDir, { recursive: true });
    const indexPath = join(specDir, "index.md");
    const subspecPath = join(specDir, "00-task.md");
    const indexContent = "# Index\n\n- [ ] [00](./00-task.md)\n";
    const subspecContent = "# Task\n\n## Acceptance criteria\n\n- [ ] done\n";
    writeFileSync(indexPath, indexContent);
    writeFileSync(subspecPath, subspecContent);

    await setupWorktreeAndBranch(branch);

    const result = await callReset(branch, ghPrListRunner([{ number: 321, isDraft: true }]));

    expect(result.status).toBe("reset");
    expect(readFileSync(indexPath, "utf8")).toBe(indexContent);
    expect(readFileSync(subspecPath, "utf8")).toBe(subspecContent);
  });

  test("reset deletes branch before closing PR in new retirement order", async () => {
    const branch = "impl/pr-close-order";
    await setupWorktreeAndBranch(branch);

    const invocationOrder: string[] = [];
    const mockRunner: AsyncSubprocessRunner = {
      runAsync: async (cmd, args, cwd) => {
        if (cmd === "gh" && args[0] === "pr" && args[1] === "list") {
          return JSON.stringify([{ number: 789, isDraft: true }]);
        }
        if (cmd === "git" && args[0] === "worktree" && args[1] === "remove") {
          invocationOrder.push("remove-worktree");
        }
        if (cmd === "git" && args[0] === "branch" && args[1] === "-D") {
          invocationOrder.push("branch-delete");
        }
        if (cmd === "git" && args[0] === "push" && args[1] === "origin") {
          invocationOrder.push("push-delete");
          return "";
        }
        if (cmd === "gh" && args[0] === "pr" && args[1] === "close") {
          invocationOrder.push("pr-close");
          return "";
        }
        return realAsyncSubprocessRunner.runAsync(cmd, args, cwd ?? projectRoot);
      },
    };

    const result = await callReset(branch, mockRunner);

    expect(result.status).toBe("reset");
    // New retirement order: worktree, local branch, remote branch, PR
    expect(invocationOrder).toEqual(["remove-worktree", "branch-delete", "push-delete", "pr-close"]);
  });

  test("refusal from a partial teardown names the failed step and the surviving artifacts", async () => {
    const branch = "impl/partial-teardown";
    await setupWorktreeAndBranch(branch);

    const mockRunner: AsyncSubprocessRunner = {
      runAsync: async (cmd, args, cwd) => {
        if (cmd === "gh" && args[0] === "pr" && args[1] === "list") {
          return JSON.stringify([{ number: 790, isDraft: true }]);
        }
        if (cmd === "git" && args[0] === "push" && args[1] === "origin") {
          throw new Error("remote rejected: protected branch");
        }
        return realAsyncSubprocessRunner.runAsync(cmd, args, cwd ?? projectRoot);
      },
    };

    const result = await callReset(branch, mockRunner);

    expect(result.status).toBe("refused");
    expect(result.status === "refused" ? result.reason : "").toContain("remote branch deletion");
    expect(result.status === "refused" ? result.reason : "").toContain("worktree and local branch removed");
  });

  test("reset succeeds when the branch was never pushed to origin", async () => {
    const branch = "impl/never-pushed";
    await setupWorktreeAndBranch(branch);

    const closedPrs: number[] = [];
    const mockRunner: AsyncSubprocessRunner = {
      runAsync: async (cmd, args, cwd) => {
        if (cmd === "gh" && args[0] === "pr" && args[1] === "list") {
          return JSON.stringify([{ number: 791, isDraft: true }]);
        }
        if (cmd === "gh" && args[0] === "pr" && args[1] === "close") {
          closedPrs.push(Number(args[2]));
          return "";
        }
        // Real `git push origin --delete` runs against the bare origin, which
        // never received this branch.
        return realAsyncSubprocessRunner.runAsync(cmd, args, cwd ?? projectRoot);
      },
    };

    const result = await callReset(branch, mockRunner);

    expect(result.status).toBe("reset");
    expect(closedPrs).toEqual([791]);
  });
});
