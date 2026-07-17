import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { AsyncSubprocessOptions, AsyncSubprocessRunner } from "../../../shared/subprocess.ts";
import { type CleanupCandidate, cleanupCommand } from "./cleanup.ts";

const tempDirs: string[] = [];

function mkTemp(): string {
  const tmpBase = process.env.TMPDIR || "/tmp";
  const dir = join(tmpBase, `jarvis-cleanup-test-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  tempDirs.length = 0;
});

function createMockRunner(): {
  runner: AsyncSubprocessRunner;
  calls: Array<{ cmd: string; args: string[]; cwd: string }>;
} {
  const calls: Array<{ cmd: string; args: string[]; cwd: string }> = [];
  return {
    runner: {
      async runAsync(cmd: string, args: string[], cwd: string, _opts?: AsyncSubprocessOptions) {
        calls.push({ cmd, args, cwd });
        if (cmd === "git" && args[0] === "worktree" && args[1] === "remove") {
          return "";
        }
        if (cmd === "git" && args[0] === "worktree" && args[1] === "prune") {
          return "";
        }
        if (cmd === "git" && args[0] === "branch" && args[1] === "-D") {
          return "";
        }
        throw new Error(`unexpected call: ${cmd} ${args.join(" ")}`);
      },
    },
    calls,
  };
}

describe("cleanupCommand", () => {
  it("discovers merged worktrees in temp jarvisRoot", async () => {
    const jarvisRoot = mkTemp();
    const projectRoot = mkTemp();

    const projectName = "test-project";
    const branchName = "feature-branch";
    const worktreePath = join(jarvisRoot, "worktrees", projectName, branchName);
    mkdirSync(worktreePath, { recursive: true });

    const _discoveredCandidates: CleanupCandidate[] = [];
    const { runner, calls } = createMockRunner();
    const stdout: string[] = [];

    const result = await cleanupCommand({
      io: { stdout: (s) => stdout.push(s), stderr: () => {}, readlineSync: () => "n" },
      jarvisRoot,
      projectRegistry: { [projectName]: { root: projectRoot } },
      runner,
      isMergedPr: async () => true,
      getNonTerminalRuns: () => [],
      isDaemonRunLive: () => false,
    });

    expect(result).toBe(0);
    expect(stdout.some((s) => s.includes("feature-branch"))).toBe(true);
    expect(calls.length).toBe(0); // Cancelled by readlineSync returning 'n'
  });

  it("filters ineligible worktrees: not merged", async () => {
    const jarvisRoot = mkTemp();
    const projectRoot = mkTemp();
    const projectName = "test-project";
    const branchName = "feature-branch";

    const worktreePath = join(jarvisRoot, "worktrees", projectName, branchName);
    mkdirSync(worktreePath, { recursive: true });

    const { runner } = createMockRunner();
    const stdout: string[] = [];

    const result = await cleanupCommand({
      io: { stdout: (s) => stdout.push(s), stderr: () => {}, readlineSync: () => "y" },
      jarvisRoot,
      projectRegistry: { [projectName]: { root: projectRoot } },
      runner,
      isMergedPr: async () => false,
      getNonTerminalRuns: () => [],
      isDaemonRunLive: () => false,
    });

    expect(result).toBe(0);
    expect(stdout.some((s) => s.includes("no merged worktrees"))).toBe(true);
  });

  it("filters ineligible worktrees: non-terminal durable run", async () => {
    const jarvisRoot = mkTemp();
    const projectRoot = mkTemp();
    const projectName = "test-project";
    const branchName = "feature-branch";

    const worktreePath = join(jarvisRoot, "worktrees", projectName, branchName);
    mkdirSync(worktreePath, { recursive: true });

    const { runner } = createMockRunner();
    const stdout: string[] = [];

    const result = await cleanupCommand({
      io: { stdout: (s) => stdout.push(s), stderr: () => {}, readlineSync: () => "y" },
      jarvisRoot,
      projectRegistry: { [projectName]: { root: projectRoot } },
      runner,
      isMergedPr: async () => true,
      getNonTerminalRuns: (proj, branch) =>
        proj === projectName && branch === branchName ? [{ id: "run-1", status: "in-progress" }] : [],
      isDaemonRunLive: () => false,
    });

    expect(result).toBe(0);
    expect(stdout.some((s) => s.includes("no merged worktrees"))).toBe(true);
  });

  it("filters ineligible worktrees: daemon live run", async () => {
    const jarvisRoot = mkTemp();
    const projectRoot = mkTemp();
    const projectName = "test-project";
    const branchName = "feature-branch";

    const worktreePath = join(jarvisRoot, "worktrees", projectName, branchName);
    mkdirSync(worktreePath, { recursive: true });

    const { runner } = createMockRunner();
    const stdout: string[] = [];

    const result = await cleanupCommand({
      io: { stdout: (s) => stdout.push(s), stderr: () => {}, readlineSync: () => "y" },
      jarvisRoot,
      projectRegistry: { [projectName]: { root: projectRoot } },
      runner,
      isMergedPr: async () => true,
      getNonTerminalRuns: () => [],
      isDaemonRunLive: (path) => path === worktreePath,
    });

    expect(result).toBe(0);
    expect(stdout.some((s) => s.includes("no merged worktrees"))).toBe(true);
  });

  it("prompts [y/N] and processes on confirmation", async () => {
    const jarvisRoot = mkTemp();
    const projectRoot = mkTemp();
    const projectName = "test-project";
    const branchName = "feature-branch";

    const worktreePath = join(jarvisRoot, "worktrees", projectName, branchName);
    mkdirSync(worktreePath, { recursive: true });

    const { runner, calls } = createMockRunner();
    const stdout: string[] = [];

    const result = await cleanupCommand({
      io: { stdout: (s) => stdout.push(s), stderr: () => {}, readlineSync: () => "y" },
      jarvisRoot,
      projectRegistry: { [projectName]: { root: projectRoot } },
      runner,
      isMergedPr: async () => true,
      getNonTerminalRuns: () => [],
      isDaemonRunLive: () => false,
    });

    expect(result).toBe(0);
    expect(stdout.some((s) => s.includes("removed"))).toBe(true);

    // Verify git calls with full argv
    expect(calls).toEqual(
      expect.arrayContaining([
        { cmd: "git", args: ["worktree", "remove", worktreePath], cwd: projectRoot },
        { cmd: "git", args: ["worktree", "prune"], cwd: projectRoot },
        { cmd: "git", args: ["branch", "-D", branchName], cwd: projectRoot },
      ]),
    );
  });

  it("respects --dry-run flag", async () => {
    const jarvisRoot = mkTemp();
    const projectRoot = mkTemp();
    const projectName = "test-project";
    const branchName = "feature-branch";

    const worktreePath = join(jarvisRoot, "worktrees", projectName, branchName);
    mkdirSync(worktreePath, { recursive: true });

    const { runner, calls } = createMockRunner();
    const stdout: string[] = [];

    const result = await cleanupCommand({
      io: { stdout: (s) => stdout.push(s), stderr: () => {}, readlineSync: () => "y" },
      dryRun: true,
      jarvisRoot,
      projectRegistry: { [projectName]: { root: projectRoot } },
      runner,
      isMergedPr: async () => true,
      getNonTerminalRuns: () => [],
      isDaemonRunLive: () => false,
    });

    expect(result).toBe(0);
    expect(calls.length).toBe(0); // No git commands in dry-run
    expect(stdout.some((s) => s.includes("feature-branch"))).toBe(true);
  });

  it("declines on [n]o response", async () => {
    const jarvisRoot = mkTemp();
    const projectRoot = mkTemp();
    const projectName = "test-project";
    const branchName = "feature-branch";

    const worktreePath = join(jarvisRoot, "worktrees", projectName, branchName);
    mkdirSync(worktreePath, { recursive: true });

    const { runner, calls } = createMockRunner();
    const stdout: string[] = [];

    const result = await cleanupCommand({
      io: { stdout: (s) => stdout.push(s), stderr: () => {}, readlineSync: () => "no" },
      jarvisRoot,
      projectRegistry: { [projectName]: { root: projectRoot } },
      runner,
      isMergedPr: async () => true,
      getNonTerminalRuns: () => [],
      isDaemonRunLive: () => false,
    });

    expect(result).toBe(0);
    expect(stdout.some((s) => s.includes("cancelled"))).toBe(true);
    expect(calls.length).toBe(0); // No removals on decline
  });

  it("rechecks eligibility after confirmation", async () => {
    const jarvisRoot = mkTemp();
    const projectRoot = mkTemp();
    const projectName = "test-project";
    const branchName = "feature-branch";

    const worktreePath = join(jarvisRoot, "worktrees", projectName, branchName);
    mkdirSync(worktreePath, { recursive: true });

    let checkCount = 0;
    const { runner } = createMockRunner();
    const stdout: string[] = [];

    const result = await cleanupCommand({
      io: { stdout: (s) => stdout.push(s), stderr: () => {}, readlineSync: () => "y" },
      jarvisRoot,
      projectRegistry: { [projectName]: { root: projectRoot } },
      runner,
      isMergedPr: async () => {
        checkCount++;
        return checkCount <= 1; // Merged during discovery, not after confirmation
      },
      getNonTerminalRuns: () => [],
      isDaemonRunLive: () => false,
    });

    expect(result).toBe(0);
    expect(stdout.some((s) => s.includes("PR no longer merged"))).toBe(true);
    expect(checkCount).toBe(2); // Called during discovery and post-confirmation
  });

  it("exits nonzero on removal failure", async () => {
    const jarvisRoot = mkTemp();
    const projectRoot = mkTemp();
    const projectName = "test-project";
    const branchName = "feature-branch";

    const worktreePath = join(jarvisRoot, "worktrees", projectName, branchName);
    mkdirSync(worktreePath, { recursive: true });

    const failingRunner: AsyncSubprocessRunner = {
      async runAsync(cmd: string, args: string[], _cwd: string) {
        if (cmd === "git" && args[0] === "worktree" && args[1] === "remove") {
          throw new Error("worktree removal failed");
        }
        return "";
      },
    };

    const stderr: string[] = [];

    const result = await cleanupCommand({
      io: { stdout: () => {}, stderr: (s) => stderr.push(s), readlineSync: () => "y" },
      jarvisRoot,
      projectRegistry: { [projectName]: { root: projectRoot } },
      runner: failingRunner,
      isMergedPr: async () => true,
      getNonTerminalRuns: () => [],
      isDaemonRunLive: () => false,
    });

    expect(result).toBe(1);
    expect(stderr.some((s) => s.includes("failed to remove"))).toBe(true);
  });

  it("verifies full argv for git worktree remove command", async () => {
    const jarvisRoot = mkTemp();
    const projectRoot = mkTemp();
    const projectName = "test-project";
    const branchName = "feature-branch";

    const worktreePath = join(jarvisRoot, "worktrees", projectName, branchName);
    mkdirSync(worktreePath, { recursive: true });

    const { runner, calls } = createMockRunner();
    const stdout: string[] = [];

    await cleanupCommand({
      io: { stdout: (s) => stdout.push(s), stderr: () => {}, readlineSync: () => "y" },
      jarvisRoot,
      projectRegistry: { [projectName]: { root: projectRoot } },
      runner,
      isMergedPr: async () => true,
      getNonTerminalRuns: () => [],
      isDaemonRunLive: () => false,
    });

    const removeCall = calls.find((c) => c.cmd === "git" && c.args[0] === "worktree" && c.args[1] === "remove");
    expect(removeCall).toBeDefined();
    expect(removeCall?.args).toEqual(["worktree", "remove", worktreePath]);
  });

  it("handles multiple projects independently", async () => {
    const jarvisRoot = mkTemp();
    const projectRoot1 = mkTemp();
    const projectRoot2 = mkTemp();

    const projectName1 = "project-1";
    const projectName2 = "project-2";
    const branchName = "feature-branch";

    mkdirSync(join(jarvisRoot, "worktrees", projectName1, branchName), { recursive: true });
    mkdirSync(join(jarvisRoot, "worktrees", projectName2, branchName), { recursive: true });

    const { runner } = createMockRunner();
    const stdout: string[] = [];

    const result = await cleanupCommand({
      io: { stdout: (s) => stdout.push(s), stderr: () => {}, readlineSync: () => "y" },
      jarvisRoot,
      projectRegistry: { [projectName1]: { root: projectRoot1 }, [projectName2]: { root: projectRoot2 } },
      runner,
      isMergedPr: async () => true,
      getNonTerminalRuns: () => [],
      isDaemonRunLive: () => false,
    });

    expect(result).toBe(0);
    expect(stdout.filter((s) => s.includes("removed")).length).toBe(2);
  });

  it("handles nested branch paths", async () => {
    const jarvisRoot = mkTemp();
    const projectRoot = mkTemp();
    const projectName = "test-project";
    const branchName = "feature/nested/branch";

    const worktreePath = join(jarvisRoot, "worktrees", projectName, branchName);
    mkdirSync(worktreePath, { recursive: true });

    const { runner, calls } = createMockRunner();
    const stdout: string[] = [];

    const result = await cleanupCommand({
      io: { stdout: (s) => stdout.push(s), stderr: () => {}, readlineSync: () => "y" },
      jarvisRoot,
      projectRegistry: { [projectName]: { root: projectRoot } },
      runner,
      isMergedPr: async () => true,
      getNonTerminalRuns: () => [],
      isDaemonRunLive: () => false,
    });

    expect(result).toBe(0);
    expect(stdout.some((s) => s.includes("feature/nested/branch"))).toBe(true);

    const removeCall = calls.find((c) => c.cmd === "git" && c.args[0] === "worktree" && c.args[1] === "remove");
    expect(removeCall?.args[2]).toBe(worktreePath);
  });

  it("leaves ineligible candidate intact", async () => {
    const jarvisRoot = mkTemp();
    const projectRoot = mkTemp();
    const projectName = "test-project";
    const branch1 = "merged-branch";
    const branch2 = "open-pr-branch";

    mkdirSync(join(jarvisRoot, "worktrees", projectName, branch1), { recursive: true });
    mkdirSync(join(jarvisRoot, "worktrees", projectName, branch2), { recursive: true });

    const { runner, calls } = createMockRunner();
    const stdout: string[] = [];

    const result = await cleanupCommand({
      io: { stdout: (s) => stdout.push(s), stderr: () => {}, readlineSync: () => "y" },
      jarvisRoot,
      projectRegistry: { [projectName]: { root: projectRoot } },
      runner,
      isMergedPr: async (branch) => branch === branch1,
      getNonTerminalRuns: () => [],
      isDaemonRunLive: () => false,
    });

    expect(result).toBe(0);
    // Only merged-branch should be removed
    expect(
      calls.filter((c) => c.cmd === "git" && c.args[0] === "branch" && c.args[1] === "-D").map((c) => c.args[2]),
    ).toEqual([branch1]);
  });
});
