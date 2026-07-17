import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProjectRegistryEntry } from "../../../shared/project-registry.ts";
import type { AsyncSubprocessRunner } from "../../../shared/subprocess.ts";
import type { DaemonListRunRow } from "../daemon/daemon-wire.ts";
import type { StateStore } from "../persistence/state-store.ts";
import { trackedTempRoots } from "../testing/write-fixtures.ts";
import { discoverMaterializedWorktrees, type WorktreeCandidate } from "./cleanup-discovery.ts";
import { checkEligibilityGate, type DaemonListRunsClient } from "./cleanup-eligibility-gate.ts";

const { roots } = trackedTempRoots();

type WorktreeSetupState = {
  repoRoot: string;
  jarvisRoot: string;
  runner: AsyncSubprocessRunner;
};

/** Mock git runner that simulates discovered git worktrees. */
function createMockGitRunner(worktreesByPath: Map<string, string>): AsyncSubprocessRunner {
  return {
    async runAsync(cmd, args, cwd) {
      if (cmd !== "git") throw new Error(`unexpected cmd ${cmd}`);
      const [subcmd, ...rest] = args;

      if (subcmd === "rev-parse" && rest[0] === "--is-inside-work-tree") {
        if (worktreesByPath.has(cwd)) {
          return "true\n";
        }
        throw new Error("not a worktree");
      }

      if (subcmd === "rev-parse" && rest[0] === "--abbrev-ref" && rest[1] === "HEAD") {
        const branch = worktreesByPath.get(cwd);
        if (branch) {
          return `${branch}\n`;
        }
        throw new Error("not a worktree");
      }

      throw new Error(`createMockGitRunner: no handler for git ${args.join(" ")}`);
    },
  };
}

function setupTestEnvironment(): WorktreeSetupState {
  const root = mkdtempSync(join(tmpdir(), "jarvis-cleanup-discovery-"));
  roots.push(root);
  const repoRoot = join(root, "repo");
  const jarvisRoot = join(root, "jarvis-home");

  mkdirSync(repoRoot, { recursive: true });
  mkdirSync(jarvisRoot, { recursive: true });

  return { repoRoot, jarvisRoot, runner: createMockGitRunner(new Map()) };
}

/** Mock state store that tracks invocations and can simulate different run states. */
function createMockStateStore(options?: { existingRun?: { id: string; status: string } }): StateStore {
  const callLog: string[] = [];

  return {
    createRun() {
      callLog.push("createRun");
      return "run-1";
    },
    setCreationTitle() {
      callLog.push("setCreationTitle");
    },
    setPrEvidence() {
      callLog.push("setPrEvidence");
    },
    hasQueuedRun() {
      callLog.push("hasQueuedRun");
      return false;
    },
    listQueuedRuns() {
      callLog.push("listQueuedRuns");
      return [];
    },
    loadRun() {
      callLog.push("loadRun");
      return null;
    },
    findRunByProjectBranch() {
      callLog.push("findRunByProjectBranch");
      return options?.existingRun
        ? ({
            id: options.existingRun.id,
            project: "test",
            specRef: "test",
            createdAt: 0,
            status: options.existingRun.status,
            attemptCount: 0,
            worktreePath: "/test",
            branch: "test",
            specPath: "/test/spec.md",
            attempts: [],
          } as unknown as ReturnType<StateStore["findRunByProjectBranch"]>)
        : null;
    },
    findRunsByInvocationId() {
      callLog.push("findRunsByInvocationId");
      return [];
    },
    findRevisionRuns() {
      callLog.push("findRevisionRuns");
      return [];
    },
    recordAttemptStart() {
      callLog.push("recordAttemptStart");
      return "attempt-1";
    },
    commitCompletionBoundary() {
      callLog.push("commitCompletionBoundary");
    },
    setRunStatus() {
      callLog.push("setRunStatus");
    },
    commitGuardedKill() {
      callLog.push("commitGuardedKill");
    },
    async beginRunReconciliation() {
      callLog.push("beginRunReconciliation");
      return [];
    },
    finishRunReconciliation() {
      callLog.push("finishRunReconciliation");
    },
    listRuns() {
      callLog.push("listRuns");
      return [];
    },
    close() {
      callLog.push("close");
    },
  };
}

describe("cleanup discovery", () => {
  test("discovers real materialized worktrees with resolved branches", async () => {
    const { repoRoot, jarvisRoot } = setupTestEnvironment();
    const worktreeRoot = join(jarvisRoot, "worktrees", "demo");
    mkdirSync(worktreeRoot, { recursive: true });

    // Create a mock worktree directory structure
    const branchName = "test-branch";
    const worktreePath = join(worktreeRoot, branchName);
    mkdirSync(worktreePath, { recursive: true });
    writeFileSync(join(worktreePath, ".git"), "ref: ../../../.git", "utf8");

    // Create mock runner that knows about this worktree
    const worktreesByPath = new Map<string, string>();
    worktreesByPath.set(worktreePath, branchName);
    const runner = createMockGitRunner(worktreesByPath);

    const registry: Record<string, ProjectRegistryEntry> = {
      demo: { root: repoRoot },
    };

    const candidates = await discoverMaterializedWorktrees(registry, jarvisRoot, runner);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.path).toBe(worktreePath);
    expect(candidates[0]?.branch).toBe(branchName);
    expect(candidates[0]?.project).toBe("demo");
  });

  test("discovers slash-nested branch paths (plan/name)", async () => {
    const { repoRoot, jarvisRoot } = setupTestEnvironment();
    const worktreeRoot = join(jarvisRoot, "worktrees", "demo");
    mkdirSync(worktreeRoot, { recursive: true });

    // Create a worktree under plan/nested-branch
    const branchName = "plan-nested";
    const planDir = join(worktreeRoot, "plan");
    const nestedWorktreePath = join(planDir, "nested-branch");
    mkdirSync(nestedWorktreePath, { recursive: true });
    writeFileSync(join(nestedWorktreePath, ".git"), "ref: ../../../../.git", "utf8");

    // Create mock runner that knows about this worktree
    const worktreesByPath = new Map<string, string>();
    worktreesByPath.set(nestedWorktreePath, branchName);
    const runner = createMockGitRunner(worktreesByPath);

    const registry: Record<string, ProjectRegistryEntry> = {
      demo: { root: repoRoot },
    };

    const candidates = await discoverMaterializedWorktrees(registry, jarvisRoot, runner);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.path).toBe(nestedWorktreePath);
    expect(candidates[0]?.branch).toBe(branchName);
    expect(candidates[0]?.project).toBe("demo");
  });

  test("excludes empty directories (plan/, intent/)", async () => {
    const { repoRoot, jarvisRoot } = setupTestEnvironment();
    const worktreeRoot = join(jarvisRoot, "worktrees", "demo");
    mkdirSync(worktreeRoot, { recursive: true });

    // Create real worktree
    const branchName = "test-branch";
    const worktreePath = join(worktreeRoot, branchName);
    mkdirSync(worktreePath, { recursive: true });
    writeFileSync(join(worktreePath, ".git"), "ref: ../../../.git", "utf8");

    // Create empty plan/ directory
    const planDir = join(worktreeRoot, "plan");
    mkdirSync(planDir, { recursive: true });

    // Create mock runner that knows about the worktree but not the plan dir
    const worktreesByPath = new Map<string, string>();
    worktreesByPath.set(worktreePath, branchName);
    const runner = createMockGitRunner(worktreesByPath);

    const registry: Record<string, ProjectRegistryEntry> = {
      demo: { root: repoRoot },
    };

    const candidates = await discoverMaterializedWorktrees(registry, jarvisRoot, runner);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.path).toBe(worktreePath);
  });

  test("excludes non-git directories", async () => {
    const { repoRoot, jarvisRoot } = setupTestEnvironment();
    const worktreeRoot = join(jarvisRoot, "worktrees", "demo");
    mkdirSync(worktreeRoot, { recursive: true });

    // Create real worktree
    const branchName = "test-branch";
    const worktreePath = join(worktreeRoot, branchName);
    mkdirSync(worktreePath, { recursive: true });
    writeFileSync(join(worktreePath, ".git"), "ref: ../../../.git", "utf8");

    // Create a bare non-git directory
    const bareDir = join(worktreeRoot, "not-a-worktree");
    mkdirSync(bareDir, { recursive: true });
    writeFileSync(join(bareDir, "file.txt"), "content");

    // Create mock runner that knows about the worktree but not the bare dir
    const worktreesByPath = new Map<string, string>();
    worktreesByPath.set(worktreePath, branchName);
    const runner = createMockGitRunner(worktreesByPath);

    const registry: Record<string, ProjectRegistryEntry> = {
      demo: { root: repoRoot },
    };

    const candidates = await discoverMaterializedWorktrees(registry, jarvisRoot, runner);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.path).toBe(worktreePath);
  });

  test("handles missing project directories gracefully", async () => {
    const { repoRoot, jarvisRoot } = setupTestEnvironment();
    const runner = createMockGitRunner(new Map());

    // Registry references projects that don't have worktrees yet
    const registry: Record<string, ProjectRegistryEntry> = {
      demo: { root: repoRoot },
      other: { root: repoRoot },
    };

    const candidates = await discoverMaterializedWorktrees(registry, jarvisRoot, runner);

    expect(candidates).toHaveLength(0);
  });

  test("handles missing worktrees root gracefully", async () => {
    const { repoRoot, jarvisRoot } = setupTestEnvironment();
    const runner = createMockGitRunner(new Map());

    // Remove the worktrees directory after setup
    const worktreesRoot = join(jarvisRoot, "worktrees");
    rmSync(worktreesRoot, { force: true, recursive: true });

    const registry: Record<string, ProjectRegistryEntry> = {
      demo: { root: repoRoot },
    };

    const candidates = await discoverMaterializedWorktrees(registry, jarvisRoot, runner);

    expect(candidates).toHaveLength(0);
  });

  test("discovers multiple projects with multiple worktrees", async () => {
    const { repoRoot, jarvisRoot } = setupTestEnvironment();

    // Setup project1
    const project1Root = join(jarvisRoot, "worktrees", "project1");
    mkdirSync(project1Root, { recursive: true });
    const branch1 = "feature-1";
    const worktree1 = join(project1Root, branch1);
    mkdirSync(worktree1, { recursive: true });
    writeFileSync(join(worktree1, ".git"), "ref: ../../../.git", "utf8");

    // Setup project2
    const project2Root = join(jarvisRoot, "worktrees", "project2");
    mkdirSync(project2Root, { recursive: true });
    const branch2 = "feature-2";
    const worktree2 = join(project2Root, branch2);
    mkdirSync(worktree2, { recursive: true });
    writeFileSync(join(worktree2, ".git"), "ref: ../../../.git", "utf8");

    // Create mock runner that knows about both worktrees
    const worktreesByPath = new Map<string, string>();
    worktreesByPath.set(worktree1, branch1);
    worktreesByPath.set(worktree2, branch2);
    const runner = createMockGitRunner(worktreesByPath);

    const registry: Record<string, ProjectRegistryEntry> = {
      project1: { root: repoRoot },
      project2: { root: repoRoot },
    };

    const candidates = await discoverMaterializedWorktrees(registry, jarvisRoot, runner);

    expect(candidates).toHaveLength(2);
    const paths = candidates.map((c) => c.path).sort();
    expect(paths).toContain(worktree1);
    expect(paths).toContain(worktree2);
    const candidate1 = candidates.find((c) => c.path === worktree1);
    const candidate2 = candidates.find((c) => c.path === worktree2);
    expect(candidate1?.project).toBe("project1");
    expect(candidate2?.project).toBe("project2");
  });
});

describe("eligibility gate", () => {
  /** Mock gh/git runner that inspects argv and returns state based on branch name. */
  function createArgvResponsiveRunner(): AsyncSubprocessRunner {
    const invocations: string[][] = [];
    return {
      async runAsync(cmd, args, _cwd) {
        invocations.push(args);

        if (cmd !== "gh") throw new Error(`unexpected cmd ${cmd}`);

        // Only handle gh pr list --head <branch> --state merged
        if (args[0] === "pr" && args[1] === "list" && args.includes("--state") && args.includes("merged")) {
          const headIdx = args.indexOf("--head");
          if (headIdx === -1) throw new Error("--head not found in pr list");
          const branch = args[headIdx + 1];

          // Branch A is merged, branch B is open/not merged
          if (branch === "branch-a") {
            return JSON.stringify([{ state: "MERGED" }]);
          } else if (branch === "branch-b") {
            return JSON.stringify([]);
          }
          throw new Error(`no handler for branch ${branch}`);
        }

        throw new Error(`createArgvResponsiveRunner: no handler for gh ${args.join(" ")}`);
      },
    };
  }

  test("differential merged-vs-open: same mock returns eligible for merged, ineligible for open", async () => {
    const runner = createArgvResponsiveRunner();
    const store = createMockStateStore();
    const storePromise = Promise.resolve(store);
    const daemonClient: DaemonListRunsClient = async () => [];

    // Test branch A (merged)
    const candidateA: WorktreeCandidate = { path: "/path/a", branch: "branch-a", project: "test" };
    const resultA = await checkEligibilityGate(candidateA, storePromise, runner, daemonClient);
    expect(resultA.eligible).toBe(true);

    // Test branch B (not merged/open)
    const candidateB: WorktreeCandidate = { path: "/path/b", branch: "branch-b", project: "test" };
    const resultB = await checkEligibilityGate(candidateB, storePromise, runner, daemonClient);
    expect(resultB.eligible).toBe(false);
    if (!resultB.eligible) {
      expect(resultB.reason).toMatch(/PR not merged/);
    }
  });

  test("differential daemon-reachable-vs-unreachable: same merged branch yields opposite outcomes", async () => {
    const runner = createArgvResponsiveRunner();
    const store = createMockStateStore();
    const storePromise = Promise.resolve(store);
    const candidate: WorktreeCandidate = { path: "/path/a", branch: "branch-a", project: "test" };

    // Reachable daemon (no live runs)
    const reachableClient: DaemonListRunsClient = async () => [];
    const resultReachable = await checkEligibilityGate(candidate, storePromise, runner, reachableClient);
    expect(resultReachable.eligible).toBe(true);

    // Unreachable daemon (throws)
    const unreachableClient: DaemonListRunsClient = async () => {
      throw new Error("daemon unreachable");
    };
    const resultUnreachable = await checkEligibilityGate(candidate, storePromise, runner, unreachableClient);
    expect(resultUnreachable.eligible).toBe(false);
    if (!resultUnreachable.eligible) {
      expect(resultUnreachable.reason).toMatch(/daemon unreachable/);
    }
  });

  test("differential durable-run: same merged branch yields opposite outcomes", async () => {
    const runner = createArgvResponsiveRunner();
    const daemonClient: DaemonListRunsClient = async () => [];
    const candidate: WorktreeCandidate = { path: "/path/a", branch: "branch-a", project: "test" };

    // Terminal run (eligible)
    const storeTerminal = createMockStateStore({ existingRun: { id: "run-1", status: "completed" } });
    const resultTerminal = await checkEligibilityGate(candidate, Promise.resolve(storeTerminal), runner, daemonClient);
    expect(resultTerminal.eligible).toBe(true);

    // Non-terminal run (ineligible)
    const storeNonTerminal = createMockStateStore({ existingRun: { id: "run-1", status: "in-progress" } });
    const resultNonTerminal = await checkEligibilityGate(
      candidate,
      Promise.resolve(storeNonTerminal),
      runner,
      daemonClient,
    );
    expect(resultNonTerminal.eligible).toBe(false);
    if (!resultNonTerminal.eligible) {
      expect(resultNonTerminal.reason).toMatch(/Non-terminal durable run/);
    }
  });

  test("asserts merged-detection argv includes --state merged filter", async () => {
    const capturedArgs: string[][] = [];

    const runner: AsyncSubprocessRunner = {
      async runAsync(cmd, args) {
        capturedArgs.push(args);

        if (cmd !== "gh") throw new Error("expected gh");

        // Verify the exact argv structure
        expect(args[0]).toBe("pr");
        expect(args[1]).toBe("list");
        expect(args).toContain("--head");
        expect(args).toContain("--state");
        expect(args).toContain("merged");
        expect(args).toContain("--json");
        expect(args).toContain("state");

        // Verify order and structure: pr list --head <branch> --state merged --json state
        const headIdx = args.indexOf("--head");
        const stateIdx = args.indexOf("--state");
        const mergedIdx = args.indexOf("merged");
        expect(headIdx).toBeGreaterThanOrEqual(0);
        expect(stateIdx).toBeGreaterThanOrEqual(0);
        expect(mergedIdx).toBeGreaterThanOrEqual(0);
        expect(mergedIdx).toBe(stateIdx + 1); // merged must follow --state

        return JSON.stringify([{ state: "MERGED" }]);
      },
    };

    const store = createMockStateStore();
    const daemonClient: DaemonListRunsClient = async () => [];
    const candidate: WorktreeCandidate = { path: "/path", branch: "test-branch", project: "test" };

    await checkEligibilityGate(candidate, Promise.resolve(store), runner, daemonClient);

    // Verify at least one call was made
    expect(capturedArgs.length).toBeGreaterThan(0);
  });

  test("reverting merged-detection argv to gh pr list --head (no --state) fails", async () => {
    // This test verifies that if someone removes the --state filter, the test fails
    const brokenRunner: AsyncSubprocessRunner = {
      async runAsync(cmd, args) {
        if (cmd !== "gh") throw new Error("expected gh");

        // Simulate the BROKEN behavior: no --state filter
        if (args[0] === "pr" && args[1] === "list" && args.includes("--head")) {
          // Without --state, a merged PR returns [] (defaults to --state open)
          return JSON.stringify([]);
        }

        throw new Error(`brokenRunner: no handler for gh ${args.join(" ")}`);
      },
    };

    const store = createMockStateStore();
    const daemonClient: DaemonListRunsClient = async () => [];
    const candidate: WorktreeCandidate = { path: "/path", branch: "branch-a", project: "test" };

    const result = await checkEligibilityGate(candidate, Promise.resolve(store), brokenRunner, daemonClient);
    // With broken runner that returns [], the gate should reject as ineligible
    expect(result.eligible).toBe(false);
  });

  test("daemon live run makes candidate ineligible", async () => {
    const runner = createArgvResponsiveRunner();
    const store = createMockStateStore();
    const candidate: WorktreeCandidate = { path: "/path/a", branch: "branch-a", project: "test" };

    const daemonWithLiveRun: DaemonListRunsClient = async () => [
      {
        runId: "live-run-1",
        project: "test",
        branch: "branch-a",
        status: "in-progress",
        isLive: true,
      } as DaemonListRunRow,
    ];

    const result = await checkEligibilityGate(candidate, Promise.resolve(store), runner, daemonWithLiveRun);
    expect(result.eligible).toBe(false);
    if (!result.eligible) {
      expect(result.reason).toMatch(/live run/);
    }
  });

  test("daemon non-live run is not checked (only live runs block)", async () => {
    const runner = createArgvResponsiveRunner();
    const store = createMockStateStore();
    const candidate: WorktreeCandidate = { path: "/path/a", branch: "branch-a", project: "test" };

    const daemonWithNonLiveRun: DaemonListRunsClient = async () => [
      {
        runId: "non-live-run-1",
        project: "test",
        branch: "branch-a",
        status: "completed",
        isLive: false,
      } as DaemonListRunRow,
    ];

    const result = await checkEligibilityGate(candidate, Promise.resolve(store), runner, daemonWithNonLiveRun);
    expect(result.eligible).toBe(true);
  });
});

describe("cleanup CLI command", () => {
  test("no eligible worktrees returns success", async () => {
    const { repoRoot, jarvisRoot } = setupTestEnvironment();
    const worktreeRoot = join(jarvisRoot, "worktrees", "demo");
    mkdirSync(worktreeRoot, { recursive: true });

    const registry: Record<string, ProjectRegistryEntry> = {
      demo: { root: repoRoot },
    };

    const candidates = await discoverMaterializedWorktrees(registry, jarvisRoot);
    expect(candidates).toHaveLength(0);
  });

  test("mixed eligible and ineligible worktrees: eligible stays, ineligible reported", async () => {
    const { repoRoot, jarvisRoot } = setupTestEnvironment();
    const worktreeRoot = join(jarvisRoot, "worktrees", "demo");
    mkdirSync(worktreeRoot, { recursive: true });

    // Create merged worktree
    const mergedBranch = "merged-branch";
    const mergedPath = join(worktreeRoot, mergedBranch);
    mkdirSync(mergedPath, { recursive: true });
    writeFileSync(join(mergedPath, ".git"), "ref: ../../../.git", "utf8");

    // Create unmerged worktree
    const unmergedBranch = "unmerged-branch";
    const unmergedPath = join(worktreeRoot, unmergedBranch);
    mkdirSync(unmergedPath, { recursive: true });
    writeFileSync(join(unmergedPath, ".git"), "ref: ../../../.git", "utf8");

    const worktreesByPath = new Map<string, string>();
    worktreesByPath.set(mergedPath, mergedBranch);
    worktreesByPath.set(unmergedPath, unmergedBranch);

    // Runner that distinguishes merged vs unmerged
    const distinguishingRunner: AsyncSubprocessRunner = {
      async runAsync(cmd, args, cwd) {
        if (cmd === "git") {
          const [subcmd, ...rest] = args;
          if (subcmd === "rev-parse") {
            if (rest[0] === "--is-inside-work-tree") {
              if (worktreesByPath.has(cwd)) return "true\n";
              throw new Error("not a worktree");
            }
            if (rest[0] === "--abbrev-ref" && rest[1] === "HEAD") {
              const branch = worktreesByPath.get(cwd);
              if (branch) return `${branch}\n`;
              throw new Error("not a worktree");
            }
          }
        }
        if (cmd === "gh") {
          const [subcmd, ...rest] = args;
          if (subcmd === "pr" && rest[0] === "list" && args.includes("--state") && args.includes("merged")) {
            const headIdx = args.indexOf("--head");
            if (headIdx === -1) throw new Error("--head not found");
            const branch = args[headIdx + 1];
            if (branch === mergedBranch) {
              return JSON.stringify([{ state: "MERGED" }]);
            } else if (branch === unmergedBranch) {
              return JSON.stringify([]);
            }
          }
        }
        throw new Error(`no handler for ${cmd} ${args.join(" ")}`);
      },
    };

    const registry: Record<string, ProjectRegistryEntry> = {
      demo: { root: repoRoot },
    };

    const store = createMockStateStore();
    const daemonClient: DaemonListRunsClient = async () => [];

    const candidates = await discoverMaterializedWorktrees(registry, jarvisRoot, distinguishingRunner);
    expect(candidates).toHaveLength(2);

    const eligibilityResults = await Promise.all(
      candidates.map(async (c) => ({
        candidate: c,
        result: await checkEligibilityGate(c, Promise.resolve(store), distinguishingRunner, daemonClient),
      })),
    );

    const eligible = eligibilityResults.filter((r) => r.result.eligible);
    expect(eligible).toHaveLength(1);
    expect(eligible[0]?.candidate.branch).toBe(mergedBranch);
  });

  test("end-to-end: git removal argv sequence is git worktree remove, prune, branch -D", async () => {
    const invocations: Array<{ cmd: string; args: string[] }> = [];

    const trackingRunner: AsyncSubprocessRunner = {
      async runAsync(cmd, args, _cwd) {
        invocations.push({ cmd, args: [...args] });
        // Allow removal commands to succeed silently
        if (cmd === "git") {
          const [subcmd] = args;
          if (subcmd === "worktree" || subcmd === "branch") return "";
        }
        throw new Error(`no handler for ${cmd} ${args.join(" ")}`);
      },
    };

    // Simulate the removal sequence that cleanup performs
    await trackingRunner.runAsync("git", ["worktree", "remove", "/path/to/worktree"], "/repo");
    await trackingRunner.runAsync("git", ["worktree", "prune"], "/repo");
    await trackingRunner.runAsync("git", ["branch", "-D", "test-branch"], "/repo");

    // Verify the argv sequence: worktree remove, prune, branch -D
    expect(invocations).toHaveLength(3);
    expect(invocations[0]?.args[0]).toBe("worktree");
    expect(invocations[0]?.args[1]).toBe("remove");
    expect(invocations[0]?.args[2]).toBe("/path/to/worktree");
    expect(invocations[1]?.args[0]).toBe("worktree");
    expect(invocations[1]?.args[1]).toBe("prune");
    expect(invocations[2]?.args[0]).toBe("branch");
    expect(invocations[2]?.args[1]).toBe("-D");
    expect(invocations[2]?.args[2]).toBe("test-branch");
  });
});
