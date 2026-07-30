import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { basename, dirname, join } from "node:path";
import { originTrackingRefResolvesAsync } from "../../../shared/git.ts";
import type { ProjectRegistryEntry } from "../../../shared/project-registry.ts";
import {
  AsyncSubprocessError,
  type AsyncSubprocessRunner,
  realAsyncSubprocessRunner,
} from "../../../shared/subprocess.ts";
import { connectIpcClient, type IpcClient } from "../ipc/client.ts";
import { startIpcServer } from "../ipc/server.ts";
import type { IpcFrame } from "../ipc/types.ts";
import type { StateStore } from "../persistence/state-store.ts";
import { canUseUnixSockets } from "../testing/unix-socket.ts";
import {
  createAbsentDaemonClient,
  createStaleResetDaemonClient,
  type DaemonClient,
  type DiscoveredWorktree,
  discoverMaterializedWorktrees,
  discoverMergedBranchRefCandidates,
  exactOriginTrackingRefOid,
  inspectStrandedArtifacts,
  listDirtyWorktreePathsForStaleReset,
  mergedPrHeadAuthorityMatches,
  parseCheckedOutBranchesFromWorktreePorcelain,
  performWorktreeRemovals,
  pruneVerifiedMergedBranchRef,
  type ResetStaleWorkspaceOptions,
  resetStaleWorkspace,
  resolveExactRefOid,
  revalidateMergedBranchRefCandidate,
  runCleanupCommand,
  STALE_RESET_OVERRIDE_CLI_FLAG,
  staleResetDirtyWorktreeGateReason,
} from "./cleanup.ts";

function daemonClientWithFreeClaimProbe(
  listRuns: (project: string, branch: string) => Promise<{ isLive: boolean }[]> = async () => [],
  claimProbe?: DaemonClient["checkWorkflowStartClaim"],
): DaemonClient {
  const daemonClient = listRuns as DaemonClient;
  daemonClient.checkWorkflowStartClaim = claimProbe ?? (async () => ({ status: "free" }));
  return daemonClient;
}

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

  async function createWorktree(branch: string): Promise<string> {
    await realAsyncSubprocessRunner.runAsync("git", ["branch", branch], projectRoot);
    const worktreePath = join(jarvisRoot, "worktrees", "project", branch);
    mkdirSync(dirname(worktreePath), { recursive: true });
    await realAsyncSubprocessRunner.runAsync("git", ["worktree", "add", worktreePath, branch], projectRoot);
    return worktreePath;
  }

  async function materializeWorktree(branch: string, message: string): Promise<string> {
    await realAsyncSubprocessRunner.runAsync("git", ["add", "."], projectRoot);
    await realAsyncSubprocessRunner.runAsync("git", ["commit", "-m", message], projectRoot);
    return createWorktree(branch);
  }

  function ghRunnerForPr(state: "MERGED" | "OPEN"): AsyncSubprocessRunner {
    return {
      runAsync: async (cmd, args, cwd) => {
        if (cmd === "gh" && args[1] === "view")
          return JSON.stringify(
            state === "MERGED"
              ? { state: "MERGED", mergedAt: "2026-01-01T00:00:00Z" }
              : { state: "OPEN", mergedAt: null },
          );
        if (cmd === "gh" && args[1] === "list") {
          if (state !== "MERGED" || (args.includes("--state") && args[args.indexOf("--state") + 1] === "open")) {
            return "[]";
          }
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
        return realAsyncSubprocessRunner.runAsync(cmd, args, cwd ?? projectRoot);
      },
    };
  }

  function storeForStrandedSpec(specName: string, branch: string): StateStore {
    const home = join(projectRoot, "v2", "spec");
    return {
      listRuns: () => [
        {
          project: "project",
          branch,
          worktreePath: projectRoot,
          specPath: join(home, specName, "index.md"),
          status: "completed",
        },
      ],
    } as unknown as StateStore;
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

    const mockRunner = ghRunnerForPr("MERGED");

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
    let retired = false;
    const mockRunner: AsyncSubprocessRunner = {
      runAsync: async (cmd, args, cwd) => {
        if (cmd === "gh" && args[1] === "view")
          return JSON.stringify({ state: "MERGED", mergedAt: "2026-01-01T00:00:00Z" });
        if (cmd === "gh" && args[1] === "list") {
          if (args.includes("--state") && args[args.indexOf("--state") + 1] === "all") {
            const headIndex = args.indexOf("--head");
            const branchName = headIndex >= 0 ? args[headIndex + 1] : undefined;
            if (branchName === branch) {
              const oid = (
                await realAsyncSubprocessRunner.runAsync("git", ["rev-parse", branch], cwd ?? projectRoot)
              ).trim();
              return JSON.stringify([
                { number: 1, state: "MERGED", mergedAt: "2026-01-01T00:00:00Z", headRefOid: oid },
              ]);
            }
            return "[]";
          }
          order.push(retired ? "post-retire pr list" : "pre-retire pr list");
          return "[]";
        }
        if (cmd === "git" && args[0] === "worktree" && args[1] === "remove") {
          order.push("retire");
          retired = true;
        }
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
    expect(order.indexOf("retire")).toBeLessThan(order.indexOf("post-retire pr list"));
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
        if (cmd === "gh" && args[1] === "list") {
          if (args.includes("--state") && args[args.indexOf("--state") + 1] === "all") {
            const headIndex = args.indexOf("--head");
            const branchName = headIndex >= 0 ? args[headIndex + 1] : undefined;
            if (branchName === branch) {
              const oid = (
                await realAsyncSubprocessRunner.runAsync("git", ["rev-parse", branch], cwd ?? projectRoot)
              ).trim();
              return JSON.stringify([
                { number: 1, state: "MERGED", mergedAt: "2026-01-01T00:00:00Z", headRefOid: oid },
              ]);
            }
            return "[]";
          }
          return "[]";
        }
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
        if (
          cmd === "gh" &&
          args[1] === "list" &&
          args.includes("--state") &&
          args[args.indexOf("--state") + 1] === "all"
        ) {
          const headIndex = args.indexOf("--head");
          const branchName = headIndex >= 0 ? args[headIndex + 1] : undefined;
          if (branchName === branch) {
            const oid = (
              await realAsyncSubprocessRunner.runAsync("git", ["rev-parse", branch], cwd ?? projectRoot)
            ).trim();
            return JSON.stringify([{ number: 1, state: "MERGED", mergedAt: "2026-01-01T00:00:00Z", headRefOid: oid }]);
          }
          return "[]";
        }
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

  test("archives open-home spec when retiring its owning worktree in one invocation", async () => {
    const home = join(projectRoot, "v2", "spec");
    const specName = "20260726T000001Z-open-home-retire";
    const branch = "feat/open-home-owner";
    createSpec(specName, "[x] Done");
    const worktreePath = await materializeWorktree(branch, "open-home owner");
    const store = storeForStrandedSpec(specName, branch);
    const mockRunner = ghRunnerForPr("MERGED");
    const registry = { project: { root: projectRoot } };
    const discovered = await discoverMaterializedWorktrees(registry, jarvisRoot, mockRunner);
    let stdout = "";
    const io = { stdout: (s: string) => (stdout += s), stderr: () => {} };
    await inspectStrandedArtifacts(
      [{ home, source: join(home, specName), name: specName, project: "project" }],
      registry,
      discovered,
      jarvisRoot,
      store,
      mockRunner,
      io,
    );
    expect(stdout).toContain("another materialized worktree owns this spec");
    expect(existsSync(join(home, specName))).toBe(true);

    stdout = "";
    const openHomeSource = join(home, specName);
    const trackingRunner: AsyncSubprocessRunner = {
      runAsync: async (cmd, args, cwd) => {
        if (cmd === "git" && args[0] === "worktree" && args[1] === "remove") {
          expect(existsSync(openHomeSource)).toBe(true);
          expect(existsSync(join(home, "completed", specName))).toBe(false);
        }
        return mockRunner.runAsync(cmd, args, cwd);
      },
    };
    expect(
      await runCleanupCommand(
        { promptConfirm: async () => true },
        registry,
        jarvisRoot,
        trackingRunner,
        async () => [],
        store,
        io,
      ),
    ).toBe(0);
    expect(stdout).toContain(`Skipped artifact: ${worktreePath} — no durable spec identity`);
    const retiredAt = stdout.indexOf(`Retired: ${worktreePath}`);
    const archivedAt = stdout.indexOf(`Archived: ${openHomeSource} ->`);
    expect(retiredAt).toBeGreaterThanOrEqual(0);
    expect(archivedAt).toBeGreaterThan(retiredAt);
    expect(existsSync(openHomeSource)).toBe(false);
    expect(existsSync(join(home, "completed", specName))).toBe(true);
    expect(existsSync(worktreePath)).toBe(false);

    stdout = "";
    expect(
      await runCleanupCommand(
        { promptConfirm: async () => true },
        registry,
        jarvisRoot,
        mockRunner,
        async () => [],
        store,
        io,
      ),
    ).toBe(0);
    expect(stdout).toContain("No eligible worktrees or stranded artifacts");
  });

  test("refuses open-home stranded archival while a materialized owner is not retired", async () => {
    const home = join(projectRoot, "v2", "spec");
    const specName = "20260726T000002Z-open-home-blocked";
    const branch = "feat/still-owned";
    createSpec(specName, "[x] Done");
    await materializeWorktree(branch, "blocking owner");
    const registry = { project: { root: projectRoot } };
    let stdout = "";
    const io = { stdout: (s: string) => (stdout += s), stderr: () => {} };
    expect(
      await runCleanupCommand(
        { promptConfirm: async () => true },
        registry,
        jarvisRoot,
        ghRunnerForPr("OPEN"),
        async () => [],
        storeForStrandedSpec(specName, branch),
        io,
      ),
    ).toBe(0);
    expect(stdout).toContain("another materialized worktree owns this spec");
    expect(existsSync(join(home, specName))).toBe(true);
    expect(existsSync(join(home, "completed", specName))).toBe(false);
  });

  test("dry-run stranded archive preview matches apply when owning worktree is in retire preview set", async () => {
    const home = join(projectRoot, "v2", "spec");
    const specName = "20260726T000003Z-dry-run-parity";
    const branch = "feat/dry-run-parity";
    createSpec(specName, "[x] Done");
    await materializeWorktree(branch, "dry-run parity owner");
    const mockRunner = ghRunnerForPr("MERGED");
    const registry = { project: { root: projectRoot } };
    const store = storeForStrandedSpec(specName, branch);
    const archiveLine = `archive: ${join(home, specName)} -> ${join(home, "completed", specName)}`;
    let dryStdout = "";
    expect(
      await runCleanupCommand({ dryRun: true }, registry, jarvisRoot, mockRunner, async () => [], store, {
        stdout: (s) => (dryStdout += s),
        stderr: () => {},
      }),
    ).toBe(0);
    expect(dryStdout).toContain(archiveLine);
    expect(existsSync(join(home, specName))).toBe(true);

    let applyStdout = "";
    expect(
      await runCleanupCommand(
        { promptConfirm: async () => true },
        registry,
        jarvisRoot,
        mockRunner,
        async () => [],
        store,
        { stdout: (s) => (applyStdout += s), stderr: () => {} },
      ),
    ).toBe(0);
    expect(existsSync(join(home, "completed", specName))).toBe(true);
    expect(applyStdout).toContain(`Archived: ${join(home, specName)} -> ${join(home, "completed", specName)}`);
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

  test("runCleanupCommand exits nonzero when the daemon becomes unreachable during recheck", async () => {
    const branch = "recheck-daemon-unreachable";
    const worktreePath = await createWorktree(branch);
    let daemonCalls = 0;
    const daemonClient: DaemonClient = async () => {
      daemonCalls += 1;
      if (daemonCalls === 1) return [];
      throw new Error("probe transport lost");
    };
    let stdout = "";

    const code = await runCleanupCommand(
      { promptConfirm: async () => true },
      { project: { root: projectRoot } },
      jarvisRoot,
      ghRunnerForPr("MERGED"),
      daemonClient,
      { listRuns: () => [] } as unknown as StateStore,
      { stdout: (text) => (stdout += text), stderr: () => {} },
    );

    expect(code).toBe(1);
    expect(stdout).toContain(`Skipped (became ineligible): ${worktreePath}`);
    expect(stdout).toContain("Daemon unreachable; run `jarvis daemon start`");
    expect(existsSync(worktreePath)).toBe(true);
  });

  test("runCleanupCommand treats a malformed daemon list response as unreachable", async () => {
    const branch = "malformed-daemon-list";
    const worktreePath = await createWorktree(branch);
    let resolveFrame: ((frame: IpcFrame) => void) | undefined;
    const client: IpcClient = {
      send(frame): void {
        resolveFrame?.({ kind: "response", id: (frame as { id: string }).id, result: { runs: "not-an-array" } });
      },
      nextFrame: () => new Promise((resolve) => (resolveFrame = resolve)),
      close: () => {},
    };
    let stdout = "";

    const code = await runCleanupCommand(
      { dryRun: true },
      { project: { root: projectRoot } },
      jarvisRoot,
      ghRunnerForPr("MERGED"),
      createStaleResetDaemonClient(client),
      { listRuns: () => [] } as unknown as StateStore,
      { stdout: (text) => (stdout += text), stderr: () => {} },
    );

    expect(code).toBe(1);
    expect(stdout).toContain(`Skipped merged worktree: ${worktreePath}`);
    expect(stdout).toContain("Daemon unreachable; run `jarvis daemon start`");
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
      throw new Error("connect ENOENT /private/leaked-daemon.sock");
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

    expect(code).toBe(1);
    expect(stdout).toContain(`Skipped merged worktree: ${worktreePath}`);
    expect(stdout).toContain("Daemon unreachable; run `jarvis daemon start`");
    expect(stdout).not.toContain("connect ENOENT");
    expect(stdout).not.toContain("/private/leaked-daemon.sock");
    expect(stdout).toContain("No eligible worktrees");

    // Verify worktree still exists
    const listOutput = await realAsyncSubprocessRunner.runAsync("git", ["worktree", "list"], projectRoot);
    expect(listOutput).toContain(worktreePath);
  });

  test("daemon-unreachable skip exits nonzero when nothing else to clean", async () => {
    const branch = "daemon-only-skip";
    const worktreePath = await createWorktree(branch);
    const runner = ghRunnerForPr("MERGED");
    const store = { listRuns: () => [] } as unknown as StateStore;
    let stdout = "";

    const code = await runCleanupCommand(
      { promptConfirm: async () => true },
      { project: { root: projectRoot } },
      jarvisRoot,
      runner,
      async () => {
        throw new Error("probe detail must not leak");
      },
      store,
      { stdout: (text) => (stdout += text), stderr: () => {} },
    );

    expect(code).toBe(1);
    expect(stdout).toContain(`Skipped merged worktree: ${worktreePath}`);
    expect(stdout).not.toContain("probe detail must not leak");
    expect(stdout).toContain("No eligible worktrees or stranded artifacts");
    expect(existsSync(worktreePath)).toBe(true);
  });

  test("daemon-unreachable skips drive dry-run, decline, and apply exit", async () => {
    const skippedBranch = "daemon-skip";
    const eligibleBranch = "daemon-skip-peer";
    for (const branch of [skippedBranch, eligibleBranch]) {
      await createWorktree(branch);
    }
    const daemonClient: DaemonClient = async (_project, branch) => {
      if (branch === skippedBranch) throw new Error("unreachable");
      return [];
    };
    const store = { listRuns: () => [] } as unknown as StateStore;
    const registry = { project: { root: projectRoot } };
    const io = { stdout: () => {}, stderr: () => {} };

    expect(
      await runCleanupCommand({ dryRun: true }, registry, jarvisRoot, ghRunnerForPr("MERGED"), daemonClient, store, io),
    ).toBe(1);
    expect(
      await runCleanupCommand(
        { promptConfirm: async () => false },
        registry,
        jarvisRoot,
        ghRunnerForPr("MERGED"),
        daemonClient,
        store,
        io,
      ),
    ).toBe(1);
    expect(
      await runCleanupCommand(
        { promptConfirm: async () => true },
        registry,
        jarvisRoot,
        ghRunnerForPr("MERGED"),
        daemonClient,
        store,
        io,
      ),
    ).toBe(1);
    expect(existsSync(join(jarvisRoot, "worktrees", "project", skippedBranch))).toBe(true);
    expect(existsSync(join(jarvisRoot, "worktrees", "project", eligibleBranch))).toBe(false);
  });

  test("non-daemon ineligibility keeps cleanup exit zero", async () => {
    const openBranch = "open-pr-skip";
    const durableBranch = "durable-run-skip";
    for (const branch of [openBranch, durableBranch]) {
      await createWorktree(branch);
    }
    const runner: AsyncSubprocessRunner = {
      runAsync: async (cmd, args, cwd) => {
        if (cmd === "gh" && args[1] === "view") {
          return JSON.stringify(
            args[2] === openBranch
              ? { state: "OPEN", mergedAt: null }
              : { state: "MERGED", mergedAt: "2026-01-01T00:00:00Z" },
          );
        }
        return realAsyncSubprocessRunner.runAsync(cmd, args, cwd ?? projectRoot);
      },
    };
    const store = {
      listRuns: () => [
        {
          project: "project",
          branch: durableBranch,
          status: "in-progress",
        },
      ],
    } as unknown as StateStore;
    let daemonCalls = 0;

    const code = await runCleanupCommand(
      { dryRun: true },
      { project: { root: projectRoot } },
      jarvisRoot,
      runner,
      async () => {
        daemonCalls += 1;
        return [];
      },
      store,
      { stdout: () => {}, stderr: () => {} },
    );

    expect(code).toBe(0);
    expect(daemonCalls).toBe(0);
  });

  test("listRuns failure aborts cleanup", async () => {
    const branch = "store-failure";
    await createWorktree(branch);
    const store = {
      listRuns: () => {
        throw new Error("state store unavailable");
      },
    } as unknown as StateStore;

    await expect(
      runCleanupCommand(
        { dryRun: true },
        { project: { root: projectRoot } },
        jarvisRoot,
        ghRunnerForPr("MERGED"),
        async () => [],
        store,
        { stdout: () => {}, stderr: () => {} },
      ),
    ).rejects.toThrow("state store unavailable");
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

  async function leaveStaleOriginTrackingRef(branch: string): Promise<void> {
    const originRoot = join(tempRoot, "origin.git");
    await realAsyncSubprocessRunner.runAsync("git", ["push", "origin", branch], projectRoot);
    await realAsyncSubprocessRunner.runAsync("git", ["update-ref", "-d", `refs/heads/${branch}`], originRoot);
  }

  async function expectAbandonRefused(
    branch: string,
    worktreePath: string,
    daemonClient: DaemonClient,
    stderrNeedle: string,
  ): Promise<void> {
    const registry: Record<string, ProjectRegistryEntry> = { project: { root: projectRoot } };
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
    expect(stderr).toContain(stderrNeedle);

    const listOutput = await realAsyncSubprocessRunner.runAsync("git", ["worktree", "list"], projectRoot);
    expect(listOutput).toContain(worktreePath);
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

    await expectAbandonRefused(
      branch,
      worktreePath,
      async (project, b) => (project === "project" && b === branch ? [{ isLive: true }] : []),
      "daemon reports live run",
    );
  });

  test("abandon refuses a workspace held by a live worktree lock", async () => {
    const branch = "feat/live-lock";
    const worktreePath = await createUnmergedWorktree(branch);

    const lockPath = join(jarvisRoot, "worktree-locks", "project", branch, ".jarvis.lock");
    mkdirSync(dirname(lockPath), { recursive: true });
    writeFileSync(lockPath, JSON.stringify({ pid: process.pid }));

    await expectAbandonRefused(branch, worktreePath, async () => [], `process ${process.pid} holds worktree lock`);
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

  test("abandon aborts and exits nonzero on remote-tracking ref prune failure, leaving PR intact", async () => {
    const branch = "feat/abort-prune-tracking";
    await createUnmergedWorktree(branch);
    await leaveStaleOriginTrackingRef(branch);

    const registry: Record<string, ProjectRegistryEntry> = { project: { root: projectRoot } };
    const daemonClient: DaemonClient = async () => [];

    let stderr = "";
    const invocations: Array<string> = [];
    const mockRunner: AsyncSubprocessRunner = {
      runAsync: async (cmd, args, cwd) => {
        if (
          cmd === "git" &&
          args[0] === "update-ref" &&
          args[1] === "-d" &&
          args[2]?.startsWith("refs/remotes/origin/")
        ) {
          invocations.push("prune-tracking");
          throw new Error("simulated prune failure");
        }
        if (cmd === "gh" && args[0] === "pr" && args[1] === "close") {
          invocations.push("close-pr");
        }
        if (cmd === "gh" && args[0] === "pr" && args[1] === "list") {
          return JSON.stringify([{ number: 558, isDraft: true }]);
        }
        if (cmd === "git" && args[0] === "push" && args[1] === "origin") return "";
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
    expect(stderr).toContain("Failed to prune remote-tracking ref");
    expect(invocations).toEqual(["prune-tracking"]);
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
    await realAsyncSubprocessRunner.runAsync("git", ["push", "origin", branch], projectRoot);
    const originRoot = join(tempRoot, "origin.git");
    await realAsyncSubprocessRunner.runAsync("git", ["update-ref", "-d", `refs/heads/${branch}`], originRoot);

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
        if (
          cmd === "git" &&
          args[0] === "update-ref" &&
          args[1] === "-d" &&
          args[2]?.startsWith("refs/remotes/origin/")
        ) {
          stepOrder.push("prune-remote-tracking-ref");
          return realAsyncSubprocessRunner.runAsync(cmd, args, cwd ?? projectRoot);
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
    expect(stepOrder).toEqual([
      "remove-worktree",
      "delete-local-branch",
      "delete-remote-branch",
      "prune-remote-tracking-ref",
      "close-pr",
    ]);
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
    await leaveStaleOriginTrackingRef(branch);

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
    const pruneIdx = stdout.indexOf("prune: stale remote-tracking ref");
    const closeIdx = stdout.indexOf("close: PR");
    expect(removeIdx).toBeGreaterThan(0);
    expect(deleteLocalIdx).toBeGreaterThan(removeIdx);
    expect(deleteRemoteIdx).toBeGreaterThan(deleteLocalIdx);
    expect(pruneIdx).toBeGreaterThan(deleteRemoteIdx);
    expect(closeIdx).toBeGreaterThan(pruneIdx);
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

  test("createAbsentDaemonClient rejects list and claim probes with stable recovery text", async () => {
    const client = createAbsentDaemonClient();

    await expect(client("project", "branch")).rejects.toThrow("Daemon unreachable; run `jarvis daemon start`");
    await expect(client.checkWorkflowStartClaim?.("project", "branch")).rejects.toThrow(
      "Daemon unreachable; run `jarvis daemon start`",
    );
  });

  socketTest("createStaleResetDaemonClient returns only runs matching both project and branch", async () => {
    const socket = join(jarvisRoot, "daemon-0000000000000013.sock");
    rmSync(socket, { force: true });
    const server = await startIpcServer(socket, {
      list: () => ({
        kind: "response",
        result: {
          runs: [
            { project: "wanted", branch: "wanted-branch", isLive: true },
            { project: "wanted", branch: "other-branch", isLive: false },
            { project: "other", branch: "wanted-branch", isLive: false },
            { project: "other", branch: "other-branch", isLive: false },
          ],
        },
      }),
    });

    try {
      const client = await connectIpcClient(socket);
      try {
        const rows = await createStaleResetDaemonClient(client)("wanted", "wanted-branch");
        // Exactly the both-fields match. An inverted comparison on either field selects
        // the other three rows instead, so this fails if the filter flips.
        expect(rows).toEqual([{ isLive: true }]);
      } finally {
        client.close();
      }
    } finally {
      await server.close();
    }
  });
});

describe("resetStaleWorkspace: incomplete implement re-run reset", () => {
  let tempRoot: string;
  let projectRoot: string;
  let jarvisRoot: string;

  const silentIo = { stdout: () => {}, stderr: () => {} };
  const noLiveDaemon = daemonClientWithFreeClaimProbe();

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

  async function leaveStaleOriginTrackingRef(branch: string): Promise<void> {
    const originRoot = join(tempRoot, "origin.git");
    await realAsyncSubprocessRunner.runAsync("git", ["push", "origin", branch], projectRoot);
    await realAsyncSubprocessRunner.runAsync("git", ["update-ref", "-d", `refs/heads/${branch}`], originRoot);
  }

  function callReset(
    branch: string,
    runner: AsyncSubprocessRunner = realAsyncSubprocessRunner,
    daemonClient: DaemonClient = noLiveDaemon,
    io: { stdout: (s: string) => void; stderr: (s: string) => void } = silentIo,
    options?: ResetStaleWorkspaceOptions,
  ) {
    return resetStaleWorkspace("project", branch, projectRoot, jarvisRoot, runner, daemonClient, io, options);
  }

  function genericRefusalReason(result: Awaited<ReturnType<typeof resetStaleWorkspace>>): string {
    if (result.status !== "refused" || "code" in result) return "";
    return result.reason;
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

    const result = await callReset(
      branch,
      realAsyncSubprocessRunner,
      daemonClientWithFreeClaimProbe(async () => [{ isLive: true }]),
    );

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
    await leaveStaleOriginTrackingRef(branch);

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
        if (
          cmd === "git" &&
          args[0] === "update-ref" &&
          args[1] === "-d" &&
          args[2]?.startsWith("refs/remotes/origin/")
        ) {
          invocationOrder.push("prune-remote-tracking");
          return realAsyncSubprocessRunner.runAsync(cmd, args, cwd ?? projectRoot);
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
    expect(invocationOrder).toEqual([
      "remove-worktree",
      "branch-delete",
      "push-delete",
      "prune-remote-tracking",
      "pr-close",
    ]);
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
    expect(genericRefusalReason(result)).toContain("remote branch deletion");
    expect(genericRefusalReason(result)).toContain("worktree and local branch removed");
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

  test("reset refuses when worktree has uncommitted tracked changes", async () => {
    const branch = "impl/dirty-tracked";
    const worktreePath = await setupWorktreeAndBranch(branch);
    const trackedRel = `file-${branch.replace(/\//g, "-")}.txt`;
    writeFileSync(join(worktreePath, trackedRel), "edited\n");

    const teardownCalls: string[] = [];
    const mockRunner: AsyncSubprocessRunner = {
      runAsync: async (cmd, args, cwd) => {
        if (cmd === "gh" && args[0] === "pr" && args[1] === "close") teardownCalls.push("pr-close");
        if (cmd === "git" && args[0] === "worktree" && args[1] === "remove") teardownCalls.push("worktree-remove");
        if (cmd === "git" && args[0] === "branch" && args[1] === "-D") teardownCalls.push("branch-delete");
        return realAsyncSubprocessRunner.runAsync(cmd, args, cwd ?? projectRoot);
      },
    };

    const result = await callReset(branch, mockRunner);

    expect(result.status).toBe("refused");
    if (result.status !== "refused" || "code" in result) throw new Error("expected generic refused");
    expect(result.reason).toContain("worktree has uncommitted changes");
    expect(result.reason).toContain(trackedRel);
    expect(result.reason).toContain(STALE_RESET_OVERRIDE_CLI_FLAG);
    expect(result.reason).toContain("jarvis cleanup --abandon");
    expect(teardownCalls).toEqual([]);
    const listOutput = await realAsyncSubprocessRunner.runAsync("git", ["worktree", "list"], projectRoot);
    expect(listOutput).toContain(worktreePath);
  });

  test("reset refuses when worktree has untracked paths", async () => {
    const branch = "impl/dirty-untracked";
    const worktreePath = await setupWorktreeAndBranch(branch);
    writeFileSync(join(worktreePath, "leftover.txt"), "agent output\n");

    const result = await callReset(branch, ghPrListRunner([{ number: 802, isDraft: true }]));

    expect(result.status).toBe("refused");
    if (result.status !== "refused" || "code" in result) throw new Error("expected generic refused");
    expect(result.reason).toContain("leftover.txt");
    expect(result.reason).toContain("discard local changes");
    expect(result.reason).toContain(STALE_RESET_OVERRIDE_CLI_FLAG);
    const listOutput = await realAsyncSubprocessRunner.runAsync("git", ["worktree", "list"], projectRoot);
    expect(listOutput).toContain(worktreePath);
  });

  test("reset refuses when porcelain is non-empty but paths are unparseable", async () => {
    const branch = "impl/unparseable-porcelain";
    const worktreePath = await setupWorktreeAndBranch(branch);

    const teardownCalls: string[] = [];
    const mockRunner: AsyncSubprocessRunner = {
      runAsync: async (cmd, args, cwd) => {
        if (cmd === "git" && args[0] === "status") return "??\n";
        if (cmd === "gh" && args[0] === "pr" && args[1] === "close") teardownCalls.push("pr-close");
        if (cmd === "git" && args[0] === "worktree" && args[1] === "remove") teardownCalls.push("worktree-remove");
        return realAsyncSubprocessRunner.runAsync(cmd, args, cwd ?? projectRoot);
      },
    };

    const result = await callReset(branch, mockRunner);

    expect(result.status).toBe("refused");
    if (result.status !== "refused" || "code" in result) throw new Error("expected generic refused");
    expect(result.reason).toContain("worktree has uncommitted changes");
    expect(result.reason).toContain("unparseable git status output");
    expect(result.reason).toContain("jarvis cleanup --abandon");
    expect(teardownCalls).toEqual([]);
    const listOutput = await realAsyncSubprocessRunner.runAsync("git", ["worktree", "list"], projectRoot);
    expect(listOutput).toContain(worktreePath);
  });

  test("reset refuses fail-closed when dirty listing fails", async () => {
    const branch = "impl/dirty-list-fail";
    const worktreePath = await setupWorktreeAndBranch(branch);
    const teardownCalls: string[] = [];

    const mockRunner: AsyncSubprocessRunner = {
      runAsync: async (cmd, args, cwd) => {
        if (cmd === "git" && args[0] === "status") throw new Error("git status unavailable");
        if (cmd === "git" && args[0] === "worktree" && args[1] === "remove") teardownCalls.push("worktree-remove");
        if (cmd === "git" && args[0] === "worktree" && args[1] === "prune") teardownCalls.push("worktree-prune");
        if (cmd === "git" && args[0] === "branch" && args[1] === "-D") teardownCalls.push("branch-delete");
        if (cmd === "git" && args[0] === "push" && args[1] === "origin" && args[2] === "--delete") {
          teardownCalls.push("remote-branch-delete");
        }
        if (cmd === "git" && args[0] === "update-ref" && args[1] === "-d") {
          teardownCalls.push("remote-tracking-ref-prune");
        }
        if (cmd === "gh" && args[0] === "pr" && args[1] === "close") teardownCalls.push("pr-close");
        return realAsyncSubprocessRunner.runAsync(cmd, args, cwd ?? projectRoot);
      },
    };

    const result = await callReset(branch, mockRunner);
    expect(result.status).toBe("refused");
    if (result.status !== "refused" || "code" in result) throw new Error("expected generic refused");
    expect(result.reason).toContain("could not list worktree changes");
    expect(result.reason).toContain("git status unavailable");
    expect(result.reason).not.toContain(STALE_RESET_OVERRIDE_CLI_FLAG);

    const overrideResult = await callReset(branch, mockRunner, noLiveDaemon, silentIo, { skipDirtyWorktreeGate: true });
    expect(overrideResult.status).toBe("refused");
    if (overrideResult.status !== "refused" || "code" in overrideResult) throw new Error("expected generic refused");
    expect(overrideResult.reason).toContain("could not list worktree changes");
    expect(overrideResult.reason).not.toContain(STALE_RESET_OVERRIDE_CLI_FLAG);
    expect(teardownCalls).toEqual([]);

    const listOutput = await realAsyncSubprocessRunner.runAsync("git", ["worktree", "list"], projectRoot);
    expect(listOutput).toContain(worktreePath);
  });

  test("reset classifies Git's missing-repository diagnostic from subprocess stderr", async () => {
    const branch = "impl/non-git-stderr";
    const worktreePath = await setupWorktreeAndBranch(branch);
    await realAsyncSubprocessRunner.runAsync("git", ["worktree", "remove", "--force", worktreePath], projectRoot);
    mkdirSync(worktreePath, { recursive: true });

    const result = await callReset(branch, {
      runAsync: async (cmd, args, cwd) => {
        if (cmd === "git" && args[0] === "status") {
          throw new AsyncSubprocessError("git exited 128", 128, "", "fatal: not a git repository", undefined);
        }
        return realAsyncSubprocessRunner.runAsync(cmd, args, cwd ?? projectRoot);
      },
    });

    expect(result).toEqual({ status: "no-op" });
    expect(existsSync(worktreePath)).toBe(true);
  });

  test("reset retires a dirty worktree when dirty gate override is set", async () => {
    const branch = "impl/dirty-gate-inversion";
    const worktreePath = await setupWorktreeAndBranch(branch);
    writeFileSync(join(worktreePath, "keep-me.txt"), "dirty\n");

    const result = await callReset(branch, ghPrListRunner([{ number: 803, isDraft: true }]), noLiveDaemon, silentIo, {
      skipDirtyWorktreeGate: true,
    });

    expect(result.status).toBe("reset");
    const listOutput = await realAsyncSubprocessRunner.runAsync("git", ["worktree", "list"], projectRoot);
    expect(listOutput).not.toContain(worktreePath);
  });

  test("resetStaleWorkspace prunes stale origin tracking ref when remote head is absent", async () => {
    const branch = "impl/stale-origin-tracking";
    const worktreePath = await setupWorktreeAndBranch(branch);
    await leaveStaleOriginTrackingRef(branch);
    expect(await originTrackingRefResolvesAsync(projectRoot, branch, realAsyncSubprocessRunner)).toBe(true);

    const result = await callReset(branch, ghPrListRunner([{ number: 804, isDraft: true }]));

    expect(result.status).toBe("reset");
    expect(await originTrackingRefResolvesAsync(projectRoot, branch, realAsyncSubprocessRunner)).toBe(false);
    const branchList = await realAsyncSubprocessRunner.runAsync("git", ["branch", "--list", branch], projectRoot);
    expect(branchList.trim()).toBe("");
    const listOutput = await realAsyncSubprocessRunner.runAsync("git", ["worktree", "list"], projectRoot);
    expect(listOutput).not.toContain(worktreePath);
  });

  test("reset reports pruned remote-tracking ref in destroyed artifacts and stdout", async () => {
    const branch = "impl/stale-origin-report";
    await setupWorktreeAndBranch(branch);
    await leaveStaleOriginTrackingRef(branch);

    let stdout = "";
    const result = await callReset(branch, ghPrListRunner([{ number: 805, isDraft: true }]), noLiveDaemon, {
      stdout: (s) => (stdout += s),
      stderr: () => {},
    });

    expect(result).toMatchObject({ status: "reset", destroyed: { remoteTrackingRef: `origin/${branch}` } });
    expect(stdout).toContain(`Pruned stale remote-tracking ref: origin/${branch}`);
  });

  test("stale origin tracking ref prune guard inversion leaves ref when update-ref is skipped", async () => {
    const branch = "impl/stale-origin-guard-inversion";
    await setupWorktreeAndBranch(branch);
    await leaveStaleOriginTrackingRef(branch);

    const skipPruneRunner: AsyncSubprocessRunner = {
      runAsync: async (cmd, args, cwd) => {
        if (
          cmd === "git" &&
          args[0] === "update-ref" &&
          args[1] === "-d" &&
          args[2]?.startsWith("refs/remotes/origin/")
        ) {
          return "";
        }
        if (cmd === "gh" && args[0] === "pr" && args[1] === "list") {
          return JSON.stringify([{ number: 806, isDraft: true }]);
        }
        if (cmd === "git" && args[0] === "push" && args[1] === "origin") return "";
        if (cmd === "gh" && args[0] === "pr" && args[1] === "close") return "";
        return realAsyncSubprocessRunner.runAsync(cmd, args, cwd ?? projectRoot);
      },
    };

    const result = await callReset(branch, skipPruneRunner);
    expect(result).toMatchObject({
      status: "refused",
      reason: expect.stringContaining("remote tracking ref deletion"),
    });
    expect(result).not.toHaveProperty("destroyed.remoteTrackingRef");
    expect(await originTrackingRefResolvesAsync(projectRoot, branch, realAsyncSubprocessRunner)).toBe(true);
  });

  test("staleResetDirtyWorktreeGateReason refuses dirty paths and skips dirty refusal only when overridden", () => {
    expect(staleResetDirtyWorktreeGateReason({ status: "dirty", paths: ["a.txt"] })).toContain("a.txt");
    expect(staleResetDirtyWorktreeGateReason({ status: "dirty", paths: [] })).toContain(
      "unparseable git status output",
    );
    expect(staleResetDirtyWorktreeGateReason({ status: "dirty", paths: ["a.txt"] }, true)).toBeUndefined();
    const listingRefusal = staleResetDirtyWorktreeGateReason({ status: "error", message: "boom" }, true);
    expect(listingRefusal).toContain("could not list worktree changes");
    expect(listingRefusal).not.toContain(STALE_RESET_OVERRIDE_CLI_FLAG);
  });

  test("listDirtyWorktreePathsForStaleReset treats non-empty unparseable porcelain as dirty", async () => {
    const runner: AsyncSubprocessRunner = {
      runAsync: async () => "??\n",
    };
    const listed = await listDirtyWorktreePathsForStaleReset("/unused", runner);
    expect(listed).toEqual({ status: "dirty", paths: [] });
  });

  // Guard inversion pair: positive case is `resetStaleWorkspace still retires when claim probe reports unclaimed`.
  test("resetStaleWorkspace refuses when worktree key is claimed", async () => {
    const branch = "impl/daemon-claimed";
    const worktreePath = await setupWorktreeAndBranch(branch);
    await realAsyncSubprocessRunner.runAsync("git", ["push", "-u", "origin", branch], projectRoot);

    const teardownCalls: string[] = [];
    const openDraftPr = { number: 901, isDraft: true };
    const mockRunner: AsyncSubprocessRunner = {
      runAsync: async (cmd, args, cwd) => {
        if (cmd === "gh" && args[0] === "pr" && args[1] === "list") {
          return JSON.stringify([openDraftPr]);
        }
        if (cmd === "gh" && args[0] === "pr" && args[1] === "close") teardownCalls.push("pr-close");
        if (cmd === "git" && args[0] === "worktree" && args[1] === "remove") teardownCalls.push("worktree-remove");
        if (cmd === "git" && args[0] === "branch" && args[1] === "-D") teardownCalls.push("branch-delete");
        if (cmd === "git" && args[0] === "push" && args[1] === "origin") teardownCalls.push("remote-delete");
        return realAsyncSubprocessRunner.runAsync(cmd, args, cwd ?? projectRoot);
      },
    };

    const claimedDaemon = daemonClientWithFreeClaimProbe(
      async () => [],
      async () => ({
        status: "claimed",
        message: "Worktree already claimed for project=project, branch=impl/daemon-claimed",
      }),
    );

    const result = await callReset(branch, mockRunner, claimedDaemon);

    expect(result).toEqual({
      status: "refused",
      code: "worktree_claimed",
      message: "Worktree already claimed for project=project, branch=impl/daemon-claimed",
    });
    expect(teardownCalls).toEqual([]);
    const listOutput = await realAsyncSubprocessRunner.runAsync("git", ["worktree", "list"], projectRoot);
    expect(listOutput).toContain(worktreePath);
    const localBranches = await realAsyncSubprocessRunner.runAsync("git", ["branch", "--list", branch], projectRoot);
    expect(localBranches.trim()).toContain(branch);
    const remoteBranches = await realAsyncSubprocessRunner.runAsync(
      "git",
      ["branch", "-r", "--list", `origin/${branch}`],
      projectRoot,
    );
    expect(remoteBranches.trim()).toContain(`origin/${branch}`);
    const prListAfter = await mockRunner.runAsync("gh", ["pr", "list"], projectRoot);
    expect(JSON.parse(prListAfter)).toEqual([openDraftPr]);
  });

  test("resetStaleWorkspace refuses fail-closed when claim probe is missing or throws", async () => {
    const branch = "impl/claim-probe-fail";
    const worktreePath = await setupWorktreeAndBranch(branch);

    const teardownCalls: string[] = [];
    const mockRunner: AsyncSubprocessRunner = {
      runAsync: async (cmd, args, cwd) => {
        if (cmd === "gh" && args[0] === "pr" && args[1] === "close") teardownCalls.push("pr-close");
        if (cmd === "git" && args[0] === "worktree" && args[1] === "remove") teardownCalls.push("worktree-remove");
        if (cmd === "git" && args[0] === "branch" && args[1] === "-D") teardownCalls.push("branch-delete");
        return realAsyncSubprocessRunner.runAsync(cmd, args, cwd ?? projectRoot);
      },
    };

    const listOnlyDaemon = (async () => []) as DaemonClient;
    const missingProbeResult = await callReset(branch, mockRunner, listOnlyDaemon);
    expect(missingProbeResult.status).toBe("refused");
    expect("code" in missingProbeResult).toBe(false);
    expect(genericRefusalReason(missingProbeResult)).toContain("missing workflow start claim probe");
    expect(teardownCalls).toEqual([]);

    const throwingDaemon = daemonClientWithFreeClaimProbe(
      async () => [],
      async () => {
        throw new Error("rpc down");
      },
    );
    const throwResult = await callReset(branch, mockRunner, throwingDaemon);
    expect(throwResult.status).toBe("refused");
    expect("code" in throwResult).toBe(false);
    expect(genericRefusalReason(throwResult)).toContain("daemon claim check failed");
    expect(genericRefusalReason(throwResult)).toContain("rpc down");
    expect(teardownCalls).toEqual([]);

    const listOutput = await realAsyncSubprocessRunner.runAsync("git", ["worktree", "list"], projectRoot);
    expect(listOutput).toContain(worktreePath);
  });

  test("resetStaleWorkspace still retires when claim probe reports unclaimed", async () => {
    const branch = "impl/claim-gate-inversion";
    const worktreePath = await setupWorktreeAndBranch(branch);

    const result = await callReset(branch, ghPrListRunner([{ number: 804, isDraft: true }]), noLiveDaemon);

    expect(result.status).toBe("reset");
    const listOutput = await realAsyncSubprocessRunner.runAsync("git", ["worktree", "list"], projectRoot);
    expect(listOutput).not.toContain(worktreePath);
  });

  test("listDirtyWorktreePathsForStaleReset reports porcelain paths", async () => {
    const branch = "impl/dirty-list-unit";
    const worktreePath = await setupWorktreeAndBranch(branch);
    const tracked = `file-${branch.replace(/\//g, "-")}.txt`;
    writeFileSync(join(worktreePath, tracked), "edited\n");
    writeFileSync(join(worktreePath, "new.txt"), "x\n");

    const listed = await listDirtyWorktreePathsForStaleReset(worktreePath, realAsyncSubprocessRunner);
    expect(listed.status).toBe("dirty");
    if (listed.status !== "dirty") throw new Error("expected dirty");
    expect(listed.paths).toEqual(expect.arrayContaining([tracked, "new.txt"]));
  });
});

type MergedBranchGhPr = {
  number: number;
  state: "MERGED" | "OPEN" | "CLOSED";
  mergedAt?: string | null;
  headRefOid?: string;
};

function mergedBranchPr(oid: string, number = 1): MergedBranchGhPr {
  return { number, state: "MERGED", mergedAt: "2026-01-01T00:00:00Z", headRefOid: oid };
}

async function initMergedBranchTestRepo(root: string): Promise<void> {
  mkdirSync(root, { recursive: true });
  await realAsyncSubprocessRunner.runAsync("git", ["init"], root);
  await realAsyncSubprocessRunner.runAsync("git", ["config", "user.email", "test@test.com"], root);
  await realAsyncSubprocessRunner.runAsync("git", ["config", "user.name", "Test User"], root);
  writeFileSync(join(root, "README.md"), `# ${basename(root)}\n`);
  await realAsyncSubprocessRunner.runAsync("git", ["add", "."], root);
  await realAsyncSubprocessRunner.runAsync("git", ["commit", "-m", "Initial"], root);
}

async function createMergedBranchLocalHead(root: string, branch: string): Promise<{ branch: string; oid: string }> {
  writeFileSync(join(root, `${branch.replace(/\//g, "-")}.txt`), `${branch}\n`);
  await realAsyncSubprocessRunner.runAsync("git", ["checkout", "-b", branch], root);
  await realAsyncSubprocessRunner.runAsync("git", ["add", "."], root);
  await realAsyncSubprocessRunner.runAsync("git", ["commit", "-m", branch], root);
  const oid = (await realAsyncSubprocessRunner.runAsync("git", ["rev-parse", "HEAD"], root)).trim();
  await realAsyncSubprocessRunner.runAsync("git", ["checkout", "main"], root).catch(async () => {
    await realAsyncSubprocessRunner.runAsync("git", ["checkout", "master"], root);
  });
  return { branch, oid };
}

function ghPrRunnerByRepo(
  prsByRepoRoot: Record<string, MergedBranchGhPr[]>,
  fallbackRoot: string,
  options: { mergedView?: boolean } = {},
): AsyncSubprocessRunner {
  return {
    runAsync: async (cmd, args, cwd) => {
      if (cmd === "gh" && args[0] === "pr") {
        if (args[1] === "list") {
          const key = cwd ?? fallbackRoot;
          return JSON.stringify(prsByRepoRoot[key] ?? []);
        }
        if (options.mergedView && args[1] === "view") {
          return JSON.stringify({ state: "MERGED", mergedAt: "2026-01-01T00:00:00Z" });
        }
      }
      return realAsyncSubprocessRunner.runAsync(cmd, args, cwd ?? fallbackRoot);
    },
  };
}

describe("cleanup: discover merged branch-ref candidates", () => {
  let tempRoot: string;
  let projectRoot: string;

  function ghPrListRunner(prsByRepoRoot: Record<string, MergedBranchGhPr[]>): AsyncSubprocessRunner {
    return ghPrRunnerByRepo(prsByRepoRoot, projectRoot);
  }

  async function branchRefExists(root: string, branch: string): Promise<boolean> {
    try {
      await realAsyncSubprocessRunner.runAsync("git", ["rev-parse", "--verify", branch], root);
      return true;
    } catch {
      return false;
    }
  }

  beforeEach(async () => {
    tempRoot = join(process.env.TMPDIR || "/tmp", `jarvis-cleanup-ref-discovery-${Date.now()}-${Math.random()}`);
    mkdirSync(tempRoot, { recursive: true });
    projectRoot = join(tempRoot, "project");
    await initMergedBranchTestRepo(projectRoot);
  });

  afterEach(() => {
    rmSync(tempRoot, { recursive: true, force: true });
  });

  test("merged local head candidate requires matching merged PR head", async () => {
    const { branch, oid } = await createMergedBranchLocalHead(projectRoot, "merged-no-worktree");
    const registry: Record<string, ProjectRegistryEntry> = { project: { root: projectRoot } };
    const runner = ghPrListRunner({ [projectRoot]: [mergedBranchPr(oid)] });

    const result = await discoverMergedBranchRefCandidates(registry, { runner });

    expect(result.candidates).toEqual([{ project: "project", branch, headOid: oid, repositoryRoot: projectRoot }]);
    expect(result.unusableProjects).toEqual([]);
  });

  test("guard inversion: open PR blocks merged local head admission", async () => {
    const { branch, oid } = await createMergedBranchLocalHead(projectRoot, "open-pr-branch");
    const registry: Record<string, ProjectRegistryEntry> = { project: { root: projectRoot } };
    const runner = ghPrListRunner({
      [projectRoot]: [{ number: 1, state: "OPEN", mergedAt: null, headRefOid: oid }, mergedBranchPr(oid, 2)],
    });

    const result = await discoverMergedBranchRefCandidates(registry, { runner });
    expect(result.candidates).toEqual([]);
    expect(await branchRefExists(projectRoot, branch)).toBe(true);
  });

  test("guard inversion: closed-unmerged PR blocks admission", async () => {
    const { branch, oid } = await createMergedBranchLocalHead(projectRoot, "closed-unmerged");
    const registry: Record<string, ProjectRegistryEntry> = { project: { root: projectRoot } };
    const runner = ghPrListRunner({
      [projectRoot]: [{ number: 1, state: "CLOSED", mergedAt: null, headRefOid: oid }],
    });

    const result = await discoverMergedBranchRefCandidates(registry, { runner });
    expect(result.candidates).toEqual([]);
    expect(await branchRefExists(projectRoot, branch)).toBe(true);
  });

  test("guard inversion: no PR blocks admission", async () => {
    const { branch } = await createMergedBranchLocalHead(projectRoot, "no-pr");
    const registry: Record<string, ProjectRegistryEntry> = { project: { root: projectRoot } };
    const runner = ghPrListRunner({ [projectRoot]: [] });

    const result = await discoverMergedBranchRefCandidates(registry, { runner });
    expect(result.candidates).toEqual([]);
    expect(await branchRefExists(projectRoot, branch)).toBe(true);
  });

  test("guard inversion: OID mismatch blocks admission", async () => {
    const { branch, oid } = await createMergedBranchLocalHead(projectRoot, "oid-mismatch");
    const registry: Record<string, ProjectRegistryEntry> = { project: { root: projectRoot } };
    const runner = ghPrListRunner({ [projectRoot]: [mergedBranchPr(`${oid}deadbeef`)] });

    const result = await discoverMergedBranchRefCandidates(registry, { runner });
    expect(result.candidates).toEqual([]);
    expect(await branchRefExists(projectRoot, branch)).toBe(true);
  });

  test("guard inversion: post-merge commit blocks admission", async () => {
    const { branch, oid } = await createMergedBranchLocalHead(projectRoot, "post-merge");
    writeFileSync(join(projectRoot, "post-merge-extra.txt"), "more\n");
    await realAsyncSubprocessRunner.runAsync("git", ["checkout", branch], projectRoot);
    await realAsyncSubprocessRunner.runAsync("git", ["add", "."], projectRoot);
    await realAsyncSubprocessRunner.runAsync("git", ["commit", "-m", "post-merge"], projectRoot);
    await realAsyncSubprocessRunner.runAsync("git", ["checkout", "main"], projectRoot).catch(async () => {
      await realAsyncSubprocessRunner.runAsync("git", ["checkout", "master"], projectRoot);
    });

    const registry: Record<string, ProjectRegistryEntry> = { project: { root: projectRoot } };
    const runner = ghPrListRunner({ [projectRoot]: [mergedBranchPr(oid)] });

    const result = await discoverMergedBranchRefCandidates(registry, { runner });
    expect(result.candidates).toEqual([]);
    expect(await branchRefExists(projectRoot, branch)).toBe(true);
  });

  test("guard inversion: conflicting merged PR matches block admission", async () => {
    const { branch, oid } = await createMergedBranchLocalHead(projectRoot, "conflicting-prs");
    const registry: Record<string, ProjectRegistryEntry> = { project: { root: projectRoot } };
    const runner = ghPrListRunner({ [projectRoot]: [mergedBranchPr(oid, 1), mergedBranchPr(oid, 2)] });

    const result = await discoverMergedBranchRefCandidates(registry, { runner });
    expect(result.candidates).toEqual([]);
    expect(await branchRefExists(projectRoot, branch)).toBe(true);
  });

  test("guard inversion: failed gh lookup blocks admission", async () => {
    const { branch } = await createMergedBranchLocalHead(projectRoot, "gh-failure");
    const registry: Record<string, ProjectRegistryEntry> = { project: { root: projectRoot } };
    const runner: AsyncSubprocessRunner = {
      runAsync: async (cmd, args, cwd) => {
        if (cmd === "gh" && args[0] === "pr" && args[1] === "list") {
          throw new Error("gh down");
        }
        return realAsyncSubprocessRunner.runAsync(cmd, args, cwd ?? projectRoot);
      },
    };

    const result = await discoverMergedBranchRefCandidates(registry, { runner });
    expect(result.candidates).toEqual([]);
    expect(await branchRefExists(projectRoot, branch)).toBe(true);
  });

  test("guard inversion: PR lookup must run in the candidate repository", async () => {
    const otherRoot = join(tempRoot, "other");
    await initMergedBranchTestRepo(otherRoot);
    await createMergedBranchLocalHead(projectRoot, "shared-name");
    const remote = await createMergedBranchLocalHead(otherRoot, "shared-name");

    const registry: Record<string, ProjectRegistryEntry> = {
      project: { root: projectRoot },
      other: { root: otherRoot },
    };
    const runner = ghPrListRunner({
      [projectRoot]: [],
      [otherRoot]: [mergedBranchPr(remote.oid)],
    });

    const result = await discoverMergedBranchRefCandidates(registry, { runner });
    expect(result.candidates.map((c) => c.project).sort()).toEqual(["other"]);
    expect(result.candidates[0]?.branch).toBe("shared-name");
  });

  test("guard inversion: reused historical branch blocks admission when OID differs", async () => {
    const first = await createMergedBranchLocalHead(projectRoot, "reused-name");
    await realAsyncSubprocessRunner.runAsync("git", ["branch", "-D", "reused-name"], projectRoot);
    await createMergedBranchLocalHead(projectRoot, "reused-name");
    writeFileSync(join(projectRoot, "reused-name-followup.txt"), "follow-up\n");
    await realAsyncSubprocessRunner.runAsync("git", ["checkout", "reused-name"], projectRoot);
    await realAsyncSubprocessRunner.runAsync("git", ["add", "."], projectRoot);
    await realAsyncSubprocessRunner.runAsync("git", ["commit", "-m", "follow-up"], projectRoot);
    const currentOid = (await realAsyncSubprocessRunner.runAsync("git", ["rev-parse", "HEAD"], projectRoot)).trim();
    await realAsyncSubprocessRunner.runAsync("git", ["checkout", "main"], projectRoot).catch(async () => {
      await realAsyncSubprocessRunner.runAsync("git", ["checkout", "master"], projectRoot);
    });
    expect(currentOid).not.toBe(first.oid);

    const registry: Record<string, ProjectRegistryEntry> = { project: { root: projectRoot } };
    const runner = ghPrListRunner({ [projectRoot]: [mergedBranchPr(first.oid)] });

    const result = await discoverMergedBranchRefCandidates(registry, { runner });
    expect(result.candidates).toEqual([]);
    expect(await branchRefExists(projectRoot, "reused-name")).toBe(true);
  });

  test("guard inversion: main is never admitted", async () => {
    const oid = (await realAsyncSubprocessRunner.runAsync("git", ["rev-parse", "HEAD"], projectRoot)).trim();
    const registry: Record<string, ProjectRegistryEntry> = { project: { root: projectRoot } };
    const runner = ghPrListRunner({ [projectRoot]: [mergedBranchPr(oid)] });

    const result = await discoverMergedBranchRefCandidates(registry, { runner });
    expect(result.candidates).toEqual([]);
    expect(await branchRefExists(projectRoot, "main")).toBe(true);
  });

  test("guard inversion: project checkout current branch is never admitted", async () => {
    const { branch, oid } = await createMergedBranchLocalHead(projectRoot, "current-branch");
    await realAsyncSubprocessRunner.runAsync("git", ["checkout", branch], projectRoot);

    const registry: Record<string, ProjectRegistryEntry> = { project: { root: projectRoot } };
    const runner = ghPrListRunner({ [projectRoot]: [mergedBranchPr(oid)] });

    const result = await discoverMergedBranchRefCandidates(registry, { runner });
    expect(result.candidates).toEqual([]);
    expect(await branchRefExists(projectRoot, branch)).toBe(true);
  });

  test("guard inversion: managed worktree checkout blocks admission until retired", async () => {
    const { branch, oid } = await createMergedBranchLocalHead(projectRoot, "managed-held");
    const worktreePath = join(tempRoot, "managed-worktree");
    mkdirSync(dirname(worktreePath), { recursive: true });
    await realAsyncSubprocessRunner.runAsync("git", ["worktree", "add", worktreePath, branch], projectRoot);

    const registry: Record<string, ProjectRegistryEntry> = { project: { root: projectRoot } };
    const runner = ghPrListRunner({ [projectRoot]: [mergedBranchPr(oid)] });

    const blocked = await discoverMergedBranchRefCandidates(registry, { runner });
    expect(blocked.candidates).toEqual([]);

    const admitted = await discoverMergedBranchRefCandidates(registry, {
      runner,
      retiredBranches: new Set([branch]),
    });
    expect(admitted.candidates).toEqual([{ project: "project", branch, headOid: oid, repositoryRoot: projectRoot }]);
  });

  test("guard inversion: external linked checkout blocks admission", async () => {
    const { branch, oid } = await createMergedBranchLocalHead(projectRoot, "external-held");
    const externalPath = join(tempRoot, "external-checkout");
    mkdirSync(dirname(externalPath), { recursive: true });
    await realAsyncSubprocessRunner.runAsync("git", ["worktree", "add", externalPath, branch], projectRoot);

    const registry: Record<string, ProjectRegistryEntry> = { project: { root: projectRoot } };
    const runner = ghPrListRunner({ [projectRoot]: [mergedBranchPr(oid)] });

    const result = await discoverMergedBranchRefCandidates(registry, { runner });
    expect(result.candidates).toEqual([]);
    expect(await branchRefExists(projectRoot, branch)).toBe(true);
    expect(
      parseCheckedOutBranchesFromWorktreePorcelain(
        await realAsyncSubprocessRunner.runAsync("git", ["worktree", "list", "--porcelain"], projectRoot),
      ).has(branch),
    ).toBe(true);
  });

  test("candidate discovery isolates registered projects", async () => {
    const otherRoot = join(tempRoot, "other-project");
    await initMergedBranchTestRepo(otherRoot);
    const local = await createMergedBranchLocalHead(projectRoot, "same-name");
    const remote = await createMergedBranchLocalHead(otherRoot, "same-name");
    const missingRoot = join(tempRoot, "missing");
    const registry: Record<string, ProjectRegistryEntry> = {
      project: { root: projectRoot },
      duplicate: { root: projectRoot },
      other: { root: otherRoot },
      missing: { root: missingRoot },
    };
    const runner = ghPrListRunner({
      [projectRoot]: [mergedBranchPr(local.oid)],
      [otherRoot]: [],
    });

    const result = await discoverMergedBranchRefCandidates(registry, { runner });

    expect(result.candidates).toEqual([
      { project: "project", branch: local.branch, headOid: local.oid, repositoryRoot: projectRoot },
    ]);
    expect(result.unusableProjects).toEqual([
      { project: "missing", root: missingRoot, reason: "project root does not exist" },
    ]);

    let stderr = "";
    const jarvisRoot = join(tempRoot, "jarvis-home");
    const code = await runCleanupCommand(
      { dryRun: true },
      registry,
      jarvisRoot,
      runner,
      async () => [],
      { listRuns: () => [] } as unknown as StateStore,
      { stdout: () => {}, stderr: (s) => (stderr += s) },
    );
    expect(code).toBe(1);
    expect(stderr).toContain("missing");
    expect(stderr).toContain("project root does not exist");
    expect(await branchRefExists(otherRoot, remote.branch)).toBe(true);
  });

  test("mergedPrHeadAuthorityMatches guard inversion skips OID comparison when disabled", async () => {
    const oid = "abc123";
    const runner: AsyncSubprocessRunner = {
      runAsync: async (cmd, args) => {
        if (cmd === "gh" && args[0] === "pr" && args[1] === "list") {
          return JSON.stringify([mergedBranchPr("wrong-oid")]);
        }
        return "";
      },
    };
    expect(await mergedPrHeadAuthorityMatches("branch", oid, projectRoot, runner)).toBe(false);
  });
});

describe("cleanup: prune verified merged branch refs", () => {
  let tempRoot: string;
  let projectRoot: string;
  let jarvisRoot: string;

  function ghPrRunner(prsByRepoRoot: Record<string, MergedBranchGhPr[]>): AsyncSubprocessRunner {
    return ghPrRunnerByRepo(prsByRepoRoot, projectRoot, { mergedView: true });
  }

  async function addOriginTrackingRef(root: string, branch: string): Promise<void> {
    const originRoot = join(tempRoot, "origin.git");
    if (!existsSync(originRoot)) {
      await initMergedBranchTestRepo(originRoot);
      await realAsyncSubprocessRunner.runAsync("git", ["remote", "add", "origin", originRoot], root);
    }
    await realAsyncSubprocessRunner.runAsync("git", ["push", "origin", branch], root);
  }

  async function exactRefExists(root: string, ref: string): Promise<boolean> {
    return (await resolveExactRefOid(root, ref, realAsyncSubprocessRunner)) !== undefined;
  }

  beforeEach(async () => {
    tempRoot = join(process.env.TMPDIR || "/tmp", `jarvis-cleanup-ref-prune-${Date.now()}-${Math.random()}`);
    mkdirSync(tempRoot, { recursive: true });
    projectRoot = join(tempRoot, "project");
    jarvisRoot = join(tempRoot, "jarvis-home");
    await initMergedBranchTestRepo(projectRoot);
  });

  afterEach(() => {
    rmSync(tempRoot, { recursive: true, force: true });
  });

  test("default cleanup prunes merged branch refs without a materialized worktree", async () => {
    const { branch, oid } = await createMergedBranchLocalHead(projectRoot, "merged-no-worktree");
    await addOriginTrackingRef(projectRoot, branch);
    const registry: Record<string, ProjectRegistryEntry> = { project: { root: projectRoot } };
    const runner = ghPrRunner({ [projectRoot]: [mergedBranchPr(oid)] });
    const pushDeletes: string[] = [];
    const wrappedRunner: AsyncSubprocessRunner = {
      runAsync: async (cmd, args, cwd) => {
        if (cmd === "git" && args[0] === "push" && args[1] === "origin" && args[2] === "--delete") {
          pushDeletes.push(args[3] ?? "");
          throw new Error("remote delete must not run");
        }
        return runner.runAsync(cmd, args, cwd);
      },
    };

    let stdout = "";
    const code = await runCleanupCommand(
      { promptConfirm: async () => true },
      registry,
      jarvisRoot,
      wrappedRunner,
      async () => [],
      { listRuns: () => [] } as unknown as StateStore,
      { stdout: (s) => (stdout += s), stderr: () => {} },
    );

    expect(code).toBe(0);
    expect(stdout).toContain("Pruned ref: project refs/heads/merged-no-worktree");
    expect(stdout).toContain("Pruned ref: project refs/remotes/origin/merged-no-worktree");
    expect(pushDeletes).toEqual([]);
    expect(await exactRefExists(projectRoot, `refs/heads/${branch}`)).toBe(false);
    expect(await exactRefExists(projectRoot, `refs/remotes/origin/${branch}`)).toBe(false);
  });

  test("default merged-worktree retirement prunes origin tracking ref", async () => {
    const branch = "merged-worktree-tracking";
    await realAsyncSubprocessRunner.runAsync("git", ["branch", branch], projectRoot);
    await addOriginTrackingRef(projectRoot, branch);
    const worktreePath = join(jarvisRoot, "worktrees", "project", branch);
    mkdirSync(dirname(worktreePath), { recursive: true });
    await realAsyncSubprocessRunner.runAsync("git", ["worktree", "add", worktreePath, branch], projectRoot);
    const oid = (await realAsyncSubprocessRunner.runAsync("git", ["rev-parse", branch], projectRoot)).trim();

    const registry: Record<string, ProjectRegistryEntry> = { project: { root: projectRoot } };
    let stdout = "";
    const code = await runCleanupCommand(
      { promptConfirm: async () => true },
      registry,
      jarvisRoot,
      ghPrRunner({ [projectRoot]: [mergedBranchPr(oid)] }),
      async () => [],
      { listRuns: () => [] } as unknown as StateStore,
      { stdout: (s) => (stdout += s), stderr: () => {} },
    );

    expect(code).toBe(0);
    expect(stdout).toContain("Retired:");
    expect(stdout).toContain("Pruned ref: project refs/heads/merged-worktree-tracking");
    expect(stdout).toContain("Pruned ref: project refs/remotes/origin/merged-worktree-tracking");
    expect(await exactRefExists(projectRoot, `refs/heads/${branch}`)).toBe(false);
    expect(await exactRefExists(projectRoot, `refs/remotes/origin/${branch}`)).toBe(false);
  });

  test("dry-run previews merged dead refs without mutation", async () => {
    const { branch, oid } = await createMergedBranchLocalHead(projectRoot, "dry-run-refs");
    await addOriginTrackingRef(projectRoot, branch);
    const registry: Record<string, ProjectRegistryEntry> = { project: { root: projectRoot } };

    let stdout = "";
    const code = await runCleanupCommand(
      { dryRun: true },
      registry,
      jarvisRoot,
      ghPrRunner({ [projectRoot]: [mergedBranchPr(oid)] }),
      async () => [],
      { listRuns: () => [] } as unknown as StateStore,
      { stdout: (s) => (stdout += s), stderr: () => {} },
    );

    expect(code).toBe(0);
    expect(stdout).toContain("prune ref: project refs/heads/dry-run-refs");
    expect(stdout).toContain("prune ref: project refs/remotes/origin/dry-run-refs");
    expect(stdout).toContain("(dry-run: no changes made)");
    expect(await exactRefExists(projectRoot, `refs/heads/${branch}`)).toBe(true);
    expect(await exactRefExists(projectRoot, `refs/remotes/origin/${branch}`)).toBe(true);
  });

  test("head-only daemon-unreachable skip exits nonzero for dry-run and apply", async () => {
    const { branch, oid } = await createMergedBranchLocalHead(projectRoot, "head-only-daemon-skip");
    const registry: Record<string, ProjectRegistryEntry> = { project: { root: projectRoot } };
    const runner = ghPrRunner({ [projectRoot]: [mergedBranchPr(oid)] });
    const store = { listRuns: () => [] } as unknown as StateStore;
    const unreachableDaemon: DaemonClient = async () => {
      throw new Error("probe detail must not leak");
    };

    let dryStdout = "";
    const dryCode = await runCleanupCommand({ dryRun: true }, registry, jarvisRoot, runner, unreachableDaemon, store, {
      stdout: (s) => (dryStdout += s),
      stderr: () => {},
    });
    expect(dryCode).toBe(1);
    expect(dryStdout).toContain("prune ref: project refs/heads/head-only-daemon-skip");
    expect(dryStdout).not.toContain("probe detail must not leak");

    let applyStdout = "";
    const applyCode = await runCleanupCommand(
      { promptConfirm: async () => true },
      registry,
      jarvisRoot,
      runner,
      unreachableDaemon,
      store,
      { stdout: (s) => (applyStdout += s), stderr: () => {} },
    );
    expect(applyCode).toBe(1);
    expect(applyStdout).toContain(
      "Skipped ref prune: project refs/heads/head-only-daemon-skip — Daemon unreachable; run `jarvis daemon start`",
    );
    expect(applyStdout).not.toContain("probe detail must not leak");
    expect(await exactRefExists(projectRoot, `refs/heads/${branch}`)).toBe(true);
  });

  test("guard inversion: ref changed after preview is not deleted", async () => {
    const { branch, oid } = await createMergedBranchLocalHead(projectRoot, "race-branch");
    const candidate = {
      project: "project",
      branch,
      headOid: oid,
      repositoryRoot: projectRoot,
    };
    let applyPass = false;
    const runner: AsyncSubprocessRunner = {
      runAsync: async (cmd, args, cwd) => {
        if (cmd === "gh" && args[0] === "pr" && args[1] === "list") {
          return JSON.stringify([mergedBranchPr(oid)]);
        }
        if (!applyPass && cmd === "git" && args[0] === "rev-parse" && args[1] === "--verify") {
          applyPass = true;
          return `${oid}deadbeef\n`;
        }
        return realAsyncSubprocessRunner.runAsync(cmd, args, cwd ?? projectRoot);
      },
    };

    const eligibility = await revalidateMergedBranchRefCandidate(
      candidate,
      runner,
      async () => [],
      { listRuns: () => [] } as unknown as StateStore,
      new Set(),
    );
    expect(eligibility.status).toBe("ineligible");
    if (eligibility.status !== "ineligible") throw new Error("expected ineligible");
    expect(eligibility.reason).toContain("OID changed");
    expect(await exactRefExists(projectRoot, `refs/heads/${branch}`)).toBe(true);
  });

  test("guard inversion: durable-run ownership blocks apply-time ref prune", async () => {
    const { branch, oid } = await createMergedBranchLocalHead(projectRoot, "durable-held");
    const eligibility = await revalidateMergedBranchRefCandidate(
      { project: "project", branch, headOid: oid, repositoryRoot: projectRoot },
      ghPrRunner({ [projectRoot]: [mergedBranchPr(oid)] }),
      async () => [],
      {
        listRuns: () => [{ project: "project", branch, status: "running" }],
      } as unknown as StateStore,
      new Set(),
    );
    expect(eligibility.status).toBe("ineligible");
    if (eligibility.status !== "ineligible") throw new Error("expected ineligible");
    expect(eligibility.reason).toContain("non-terminal run");
  });

  test("guard inversion: daemon-run ownership blocks apply-time ref prune", async () => {
    const { branch, oid } = await createMergedBranchLocalHead(projectRoot, "daemon-held");
    const eligibility = await revalidateMergedBranchRefCandidate(
      { project: "project", branch, headOid: oid, repositoryRoot: projectRoot },
      ghPrRunner({ [projectRoot]: [mergedBranchPr(oid)] }),
      async () => [{ isLive: true }],
      { listRuns: () => [] } as unknown as StateStore,
      new Set(),
    );
    expect(eligibility.status).toBe("ineligible");
    if (eligibility.status !== "ineligible") throw new Error("expected ineligible");
    expect(eligibility.reason).toContain("live run");
  });

  test("guard inversion: orphan tracking ref is not swept", async () => {
    const branch = "orphan-tracking";
    await realAsyncSubprocessRunner.runAsync("git", ["branch", branch], projectRoot);
    await addOriginTrackingRef(projectRoot, branch);
    await realAsyncSubprocessRunner.runAsync("git", ["update-ref", "-d", `refs/heads/${branch}`], projectRoot);
    const registry: Record<string, ProjectRegistryEntry> = { project: { root: projectRoot } };
    let stdout = "";
    const code = await runCleanupCommand(
      { promptConfirm: async () => true },
      registry,
      jarvisRoot,
      ghPrRunner({ [projectRoot]: [] }),
      async () => [],
      { listRuns: () => [] } as unknown as StateStore,
      { stdout: (s) => (stdout += s), stderr: () => {} },
    );

    expect(code).toBe(0);
    expect(stdout).toContain("No eligible worktrees or stranded artifacts");
    expect(await exactRefExists(projectRoot, `refs/remotes/origin/${branch}`)).toBe(true);
    expect(await exactRefExists(projectRoot, `refs/heads/${branch}`)).toBe(false);
  });

  test("guard inversion: similarly named tag does not establish tracking ref presence", async () => {
    const { branch, oid } = await createMergedBranchLocalHead(projectRoot, "tag-collision");
    await realAsyncSubprocessRunner.runAsync("git", ["tag", `origin/${branch}`, oid], projectRoot);
    expect(await exactOriginTrackingRefOid(projectRoot, branch, realAsyncSubprocessRunner)).toBeUndefined();

    let stdout = "";
    await pruneVerifiedMergedBranchRef(
      { project: "project", branch, headOid: oid, repositoryRoot: projectRoot },
      realAsyncSubprocessRunner,
      { stdout: (s) => (stdout += s), stderr: () => {} },
    );
    expect(stdout).toContain("Pruned ref: project refs/heads/tag-collision");
    expect(stdout).not.toContain("refs/remotes/origin/tag-collision");
    expect(await exactRefExists(projectRoot, `refs/tags/origin/${branch}`)).toBe(true);
  });

  test("guard inversion: remote deletion is not attempted during ref prune", async () => {
    const { branch, oid } = await createMergedBranchLocalHead(projectRoot, "no-remote-delete");
    await addOriginTrackingRef(projectRoot, branch);
    const invocations: string[] = [];
    const runner: AsyncSubprocessRunner = {
      runAsync: async (cmd, args, cwd) => {
        if (cmd === "git" && args[0] === "push" && args[1] === "origin") invocations.push("push");
        return ghPrRunner({ [projectRoot]: [mergedBranchPr(oid)] }).runAsync(cmd, args, cwd);
      },
    };

    await pruneVerifiedMergedBranchRef(
      { project: "project", branch, headOid: oid, trackingRefOid: oid, repositoryRoot: projectRoot },
      runner,
      { stdout: () => {}, stderr: () => {} },
    );
    expect(invocations).toEqual([]);
  });

  test("ref-prune failures continue independent cleanup", async () => {
    const first = await createMergedBranchLocalHead(projectRoot, "fail-first");
    const second = await createMergedBranchLocalHead(projectRoot, "succeed-second");
    const specName = "20260730T000000Z-stranded";
    const strandedSource = join(projectRoot, "v2", "spec", specName);
    mkdirSync(strandedSource, { recursive: true });
    writeFileSync(join(strandedSource, "index.md"), "# stranded\n\n## Acceptance criteria\n\n- [x] done\n");
    const store: StateStore = {
      listRuns: () => [
        {
          project: "project",
          branch: specName,
          status: "completed",
          specPath: join(strandedSource, "index.md"),
          worktreePath: projectRoot,
        },
      ],
    } as unknown as StateStore;

    const registry: Record<string, ProjectRegistryEntry> = { project: { root: projectRoot } };
    let stdout = "";
    let stderr = "";
    let headDeleteCount = 0;
    const runner: AsyncSubprocessRunner = {
      runAsync: async (cmd, args, cwd) => {
        if (cmd === "gh" && args[0] === "pr" && args[1] === "list") {
          if (args.includes("--state") && args[args.indexOf("--state") + 1] === "open") return "[]";
          const branchArg = args.indexOf("--head");
          const branchName = branchArg >= 0 ? args[branchArg + 1] : "";
          if (branchName === first.branch) return JSON.stringify([mergedBranchPr(first.oid)]);
          if (branchName === second.branch) return JSON.stringify([mergedBranchPr(second.oid)]);
          return "[]";
        }
        if (cmd === "git" && args[0] === "update-ref" && args[1] === "-d" && args[2] === `refs/heads/${first.branch}`) {
          headDeleteCount += 1;
          throw new Error("simulated head delete failure");
        }
        return realAsyncSubprocessRunner.runAsync(cmd, args, cwd ?? projectRoot);
      },
    };

    const code = await runCleanupCommand(
      { promptConfirm: async () => true },
      registry,
      jarvisRoot,
      runner,
      async () => [],
      store,
      { stdout: (s) => (stdout += s), stderr: (s) => (stderr += s) },
    );

    expect(code).toBe(1);
    expect(headDeleteCount).toBe(1);
    expect(stderr).toContain(`Failed to prune ref refs/heads/${first.branch}`);
    expect(stdout).not.toContain(`Pruned ref: project refs/heads/${first.branch}`);
    expect(stdout).toContain(`Pruned ref: project refs/heads/${second.branch}`);
    expect(existsSync(join(projectRoot, "v2", "spec", "completed", specName))).toBe(true);
    expect(await exactRefExists(projectRoot, `refs/heads/${first.branch}`)).toBe(true);
    expect(await exactRefExists(projectRoot, `refs/heads/${second.branch}`)).toBe(false);
  });

  test("retirement success is not reported when required ref prune fails", async () => {
    const branch = "retire-prune-fail";
    await realAsyncSubprocessRunner.runAsync("git", ["branch", branch], projectRoot);
    const worktreePath = join(jarvisRoot, "worktrees", "project", branch);
    mkdirSync(dirname(worktreePath), { recursive: true });
    await realAsyncSubprocessRunner.runAsync("git", ["worktree", "add", worktreePath, branch], projectRoot);
    const oid = (await realAsyncSubprocessRunner.runAsync("git", ["rev-parse", branch], projectRoot)).trim();

    let stdout = "";
    let stderr = "";
    const runner: AsyncSubprocessRunner = {
      runAsync: async (cmd, args, cwd) => {
        if (cmd === "gh" && args[0] === "pr" && args[1] === "view") {
          return JSON.stringify({ state: "MERGED", mergedAt: "2026-01-01T00:00:00Z" });
        }
        if (cmd === "gh" && args[0] === "pr" && args[1] === "list") {
          return JSON.stringify([mergedBranchPr(oid)]);
        }
        if (cmd === "git" && args[0] === "update-ref" && args[1] === "-d" && args[2] === `refs/heads/${branch}`) {
          throw new Error("simulated head delete failure");
        }
        return realAsyncSubprocessRunner.runAsync(cmd, args, cwd ?? projectRoot);
      },
    };

    const code = await runCleanupCommand(
      { promptConfirm: async () => true },
      { project: { root: projectRoot } },
      jarvisRoot,
      runner,
      async () => [],
      { listRuns: () => [] } as unknown as StateStore,
      { stdout: (s) => (stdout += s), stderr: (s) => (stderr += s) },
    );

    expect(code).toBe(1);
    expect(stderr).toContain("Failed to retire");
    expect(stdout).not.toContain(`Retired: ${worktreePath}`);
    expect(await exactRefExists(projectRoot, `refs/heads/${branch}`)).toBe(true);
  });
});
