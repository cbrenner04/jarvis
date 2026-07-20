import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AsyncSubprocessRunner } from "../../../shared/subprocess.ts";
import { trackedTempRoots } from "../testing/write-fixtures.ts";
import {
  getExternalWorktreeLockPath,
  getExternalWorktreePath,
  WorktreeBusyError,
  WorktreeMaterializationError,
  withExternalWorktree,
} from "./external-worktree.ts";

const { roots } = trackedTempRoots();

type RepoState = {
  commonDir: string;
  localBranches: Set<string>;
  remoteBranches: Set<string>;
};

type WorktreeState = {
  repoCommonDir: string;
  branch: string;
};

type FakeGitState = {
  repos: Map<string, RepoState>;
  worktrees: Map<string, WorktreeState>;
};

function createFakeGitState(): FakeGitState {
  return { repos: new Map(), worktrees: new Map() };
}

function registerRepo(state: FakeGitState, projectRoot: string): void {
  state.repos.set(projectRoot, {
    commonDir: join(projectRoot, ".git"),
    localBranches: new Set(),
    remoteBranches: new Set(),
  });
}

function createWorktreeRunner(state: FakeGitState): AsyncSubprocessRunner {
  return {
    async runAsync(cmd, args, cwd) {
      if (cmd !== "git") throw new Error(`unexpected cmd ${cmd}`);
      const [subcmd, ...rest] = args;

      if (subcmd === "rev-parse") {
        const key = rest.join(" ");
        if (key.startsWith("--verify origin/")) {
          const branch = key.slice("--verify origin/".length);
          const repo = state.repos.get(cwd);
          if (!repo?.remoteBranches.has(branch)) throw new Error("not a valid ref");
          return "remote-sha\n";
        }
        if (key.startsWith("--verify ")) {
          const branch = key.slice("--verify ".length);
          const repo = state.repos.get(cwd);
          if (!repo?.localBranches.has(branch)) throw new Error("not a valid ref");
          return "local-sha\n";
        }
        if (key === "--is-inside-work-tree") {
          if (!state.worktrees.has(cwd)) throw new Error("not a worktree");
          return "true\n";
        }
        if (key === "--path-format=absolute --git-common-dir") {
          const worktree = state.worktrees.get(cwd);
          if (worktree) return `${worktree.repoCommonDir}\n`;
          const repo = state.repos.get(cwd);
          if (repo) return `${repo.commonDir}\n`;
          throw new Error("not a git dir");
        }
        if (key === "--abbrev-ref HEAD") {
          const worktree = state.worktrees.get(cwd);
          if (!worktree) throw new Error("not a worktree");
          return `${worktree.branch}\n`;
        }
      }

      if (subcmd === "branch") {
        const branchName = rest[0];
        const repo = state.repos.get(cwd);
        if (!repo || !branchName) throw new Error("branch failed");
        repo.localBranches.add(branchName);
        return "";
      }

      if (subcmd === "worktree" && rest[0] === "add") {
        const addArgs = rest.slice(1);
        const checkout = addArgs[0] === "--checkout";
        const path = checkout ? addArgs[1] : addArgs[0];
        const branch = checkout ? addArgs[2] : addArgs[1];
        const repo = state.repos.get(cwd);
        if (!repo || !path || !branch) throw new Error("worktree add failed");
        mkdirSync(path, { recursive: true });
        repo.localBranches.add(branch);
        state.worktrees.set(path, { repoCommonDir: repo.commonDir, branch });
        return "";
      }

      if (subcmd === "worktree" && rest[0] === "prune") {
        return "";
      }

      if (subcmd === "checkout") {
        const branch = rest[rest.length - 1];
        const worktree = state.worktrees.get(cwd);
        if (!worktree || !branch) throw new Error("checkout failed");
        worktree.branch = branch;
        return "";
      }

      throw new Error(`createWorktreeRunner: no handler for git ${args.join(" ")}`);
    },
  };
}

function setupMockRepo(): { repoRoot: string; jarvisRoot: string; runner: AsyncSubprocessRunner } {
  const root = mkdtempSync(join(tmpdir(), "jarvis-v2-worktree-mock-"));
  roots.push(root);
  const repoRoot = join(root, "repo");
  const jarvisRoot = join(root, "jarvis-home");
  mkdirSync(repoRoot, { recursive: true });
  mkdirSync(join(repoRoot, "node_modules"));
  const state = createFakeGitState();
  registerRepo(state, repoRoot);
  return { repoRoot, jarvisRoot, runner: createWorktreeRunner(state) };
}

function getLockRoot(jarvisRoot: string): string {
  return join(jarvisRoot, "worktree-locks", "demo", "write-run");
}

function makeInput(
  jarvisRoot: string,
  projectRoot: string,
): {
  projectRoot: string;
  projectName: string;
  branchName: string;
  baseRef: string;
  jarvisRoot: string;
} {
  return {
    projectRoot,
    projectName: "demo",
    branchName: "write-run",
    baseRef: "HEAD",
    jarvisRoot,
  };
}

describe("external worktree helper", () => {
  test("provisions project dependencies before the first callback", async () => {
    const { repoRoot, jarvisRoot, runner } = setupMockRepo();
    let callbackLink: string | undefined;

    await withExternalWorktree(
      makeInput(jarvisRoot, repoRoot),
      (worktree) => {
        callbackLink = readlinkSync(join(worktree.path, "node_modules"));
      },
      runner,
    );

    expect(callbackLink).toBe(join(repoRoot, "node_modules"));
  });

  test("creates a fresh external worktree and releases lock on success", async () => {
    const { repoRoot, jarvisRoot, runner } = setupMockRepo();
    const result = await withExternalWorktree(makeInput(jarvisRoot, repoRoot), () => "ok", runner);

    expect(result.lock.kind).toBe("acquired");
    expect(result.worktree.reused).toBe(false);
    expect(existsSync(result.worktree.path)).toBe(true);

    const lockPath = getExternalWorktreeLockPath(getLockRoot(jarvisRoot));
    expect(existsSync(lockPath)).toBe(false);
    expect(existsSync(join(result.worktree.path, ".jarvis.lock"))).toBe(false);
  });

  test("recovers stale lock and reports recovered status", async () => {
    const { repoRoot, jarvisRoot, runner } = setupMockRepo();

    await withExternalWorktree(makeInput(jarvisRoot, repoRoot), () => undefined, runner);

    const lockPath = getExternalWorktreeLockPath(getLockRoot(jarvisRoot));
    writeFileSync(
      lockPath,
      `${JSON.stringify({
        pid: 999_999_999,
        started_at: "2000-01-01T00:00:00.000Z",
        host: "stale-host",
      })}\n`,
      "utf8",
    );

    const result = await withExternalWorktree(makeInput(jarvisRoot, repoRoot), () => "ok", runner);

    expect(result.worktree.reused).toBe(true);
    expect(result.lock.kind).toBe("recovered");
  });

  test("refuses to reuse a worktree from a different repository", async () => {
    const root = mkdtempSync(join(tmpdir(), "jarvis-v2-worktree-mock-"));
    roots.push(root);
    const repoRoot = join(root, "repo");
    const otherRepoRoot = join(root, "other-repo");
    const jarvisRoot = join(root, "jarvis-home");
    mkdirSync(repoRoot, { recursive: true });
    mkdirSync(otherRepoRoot, { recursive: true });
    const state = createFakeGitState();
    registerRepo(state, repoRoot);
    registerRepo(state, otherRepoRoot);
    const runner = createWorktreeRunner(state);

    await withExternalWorktree(makeInput(jarvisRoot, repoRoot), () => undefined, runner);

    await expect(withExternalWorktree(makeInput(jarvisRoot, otherRepoRoot), () => "never", runner)).rejects.toThrow(
      "belongs to a different repository",
    );
  });

  test("refuses to reuse a worktree on a different branch", async () => {
    const { repoRoot, jarvisRoot, runner } = setupMockRepo();

    const result = await withExternalWorktree(makeInput(jarvisRoot, repoRoot), () => undefined, runner);
    await runner.runAsync("git", ["checkout", "-b", "other-branch"], result.worktree.path);

    await expect(withExternalWorktree(makeInput(jarvisRoot, repoRoot), () => "never", runner)).rejects.toThrow(
      "is on branch other-branch, expected write-run",
    );
  });

  test("refuses busy lock with v1-compatible payload", async () => {
    const { repoRoot, jarvisRoot, runner } = setupMockRepo();

    await withExternalWorktree(makeInput(jarvisRoot, repoRoot), () => undefined, runner);

    const lockPath = getExternalWorktreeLockPath(getLockRoot(jarvisRoot));
    writeFileSync(
      lockPath,
      `${JSON.stringify({
        pid: process.pid,
        started_at: "2000-01-01T00:00:00.000Z",
        host: "alive-host",
      })}\n`,
      "utf8",
    );

    await expect(withExternalWorktree(makeInput(jarvisRoot, repoRoot), () => "never", runner)).rejects.toBeInstanceOf(
      WorktreeBusyError,
    );
  });

  test("refuses reusing a non-worktree directory", async () => {
    const { repoRoot, jarvisRoot, runner } = setupMockRepo();
    const path = getExternalWorktreePath(makeInput(jarvisRoot, repoRoot));
    mkdirSync(path, { recursive: true });

    await expect(withExternalWorktree(makeInput(jarvisRoot, repoRoot), () => "never", runner)).rejects.toThrow(
      `existing path is not a git worktree: ${path}`,
    );
  });

  test("releases lock when callback fails", async () => {
    const { repoRoot, jarvisRoot, runner } = setupMockRepo();

    await expect(
      withExternalWorktree(
        makeInput(jarvisRoot, repoRoot),
        () => {
          throw new Error("boom");
        },
        runner,
      ),
    ).rejects.toThrow("boom");

    expect(existsSync(getExternalWorktreeLockPath(getLockRoot(jarvisRoot)))).toBe(false);
  });

  test("releases lock when setup fails and leaves later setup admissible", async () => {
    const { repoRoot, jarvisRoot, runner: innerRunner } = setupMockRepo();
    const failingRunner: AsyncSubprocessRunner = {
      async runAsync(cmd, args, cwd, options) {
        if (cmd === "git" && args[0] === "worktree" && args[1] === "add") {
          throw new Error("worktree add failed");
        }
        return innerRunner.runAsync(cmd, args, cwd, options);
      },
    };

    await expect(withExternalWorktree(makeInput(jarvisRoot, repoRoot), () => "never", failingRunner)).rejects.toThrow(
      "worktree add failed",
    );
    expect(existsSync(getExternalWorktreeLockPath(getLockRoot(jarvisRoot)))).toBe(false);

    const result = await withExternalWorktree(makeInput(jarvisRoot, repoRoot), () => "ok", innerRunner);
    expect(result.value).toBe("ok");
    expect(existsSync(getExternalWorktreeLockPath(getLockRoot(jarvisRoot)))).toBe(false);
  });

  test("rejects a successful worktree add that does not materialize a valid worktree before callback", async () => {
    const { repoRoot, jarvisRoot, runner: innerRunner } = setupMockRepo();
    let callbackCalled = false;
    const incompleteRunner: AsyncSubprocessRunner = {
      async runAsync(cmd, args, cwd, options) {
        if (cmd === "git" && args[0] === "worktree" && args[1] === "add") return "";
        return innerRunner.runAsync(cmd, args, cwd, options);
      },
    };
    const worktreePath = getExternalWorktreePath(makeInput(jarvisRoot, repoRoot));

    await expect(
      withExternalWorktree(
        makeInput(jarvisRoot, repoRoot),
        () => {
          callbackCalled = true;
        },
        incompleteRunner,
      ),
    ).rejects.toMatchObject({
      name: "WorktreeMaterializationError",
      worktreePath,
      message: expect.stringContaining(`created path is not a git worktree: ${worktreePath}`),
    } satisfies Partial<WorktreeMaterializationError>);
    expect(callbackCalled).toBe(false);
  });

  test("recreates a missing but still-registered worktree", async () => {
    const { repoRoot, jarvisRoot, runner } = setupMockRepo();

    const first = await withExternalWorktree(makeInput(jarvisRoot, repoRoot), () => undefined, runner);
    rmSync(first.worktree.path, { recursive: true, force: true });

    const second = await withExternalWorktree(makeInput(jarvisRoot, repoRoot), () => "ok", runner);

    expect(second.worktree.reused).toBe(false);
    expect(existsSync(second.worktree.path)).toBe(true);
  });
});
