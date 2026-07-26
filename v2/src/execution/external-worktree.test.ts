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
  /** Heads `ls-remote` reports on origin. */
  remoteBranches: Set<string>;
  /** Local `origin/<branch>` refs that resolve via rev-parse but may be absent from ls-remote. */
  originTrackingRefs: Set<string>;
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
    originTrackingRefs: new Set(),
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
          if (!repo?.originTrackingRefs.has(branch) && !repo?.remoteBranches.has(branch)) {
            throw new Error("not a valid ref");
          }
          return "remote-sha\n";
        }
        if (key.startsWith("--verify ")) {
          const branch = key.slice("--verify ".length);
          const repo = state.repos.get(cwd);
          if (!repo?.localBranches.has(branch)) throw new Error("not a valid ref");
          return "local-sha\n";
        }
        if (key === "--is-inside-work-tree") {
          if (!state.worktrees.has(cwd)) throw new Error("fatal: not a git repository");
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

      if (subcmd === "ls-remote" && rest[0] === "--heads" && rest[1] === "origin") {
        const branch = rest[2];
        const repo = state.repos.get(cwd);
        if (!repo || !branch) throw new Error("ls-remote failed");
        if (!repo.remoteBranches.has(branch)) return "";
        return `remote-sha\trefs/heads/${branch}\n`;
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

      if (subcmd === "worktree" && rest[0] === "list" && rest[1] === "--porcelain") {
        const repo = state.repos.get(cwd);
        if (!repo) throw new Error("fatal: not a git repository");
        return [...state.worktrees.entries()]
          .filter(([, worktree]) => worktree.repoCommonDir === repo.commonDir)
          .map(([path]) => `worktree ${path}\n`)
          .join("");
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

  test("materializes from --base when only a stale remote-tracking ref exists", async () => {
    const root = mkdtempSync(join(tmpdir(), "jarvis-v2-worktree-stale-origin-"));
    roots.push(root);
    const repoRoot = join(root, "repo");
    const jarvisRoot = join(root, "jarvis-home");
    mkdirSync(repoRoot, { recursive: true });
    mkdirSync(join(repoRoot, "node_modules"));
    const state = createFakeGitState();
    registerRepo(state, repoRoot);
    const repo = state.repos.get(repoRoot);
    if (!repo) throw new Error("repo missing");
    repo.originTrackingRefs.add("write-run");
    const calls: string[] = [];
    const inner = createWorktreeRunner(state);
    const runner: AsyncSubprocessRunner = {
      async runAsync(cmd, args, cwd, options) {
        if (cmd === "git") calls.push(args.join(" "));
        return inner.runAsync(cmd, args, cwd, options);
      },
    };

    await withExternalWorktree(makeInput(jarvisRoot, repoRoot), () => "ok", runner);

    expect(calls.some((c) => c === "branch write-run origin/write-run")).toBe(false);
    expect(calls.some((c) => c === "branch write-run HEAD")).toBe(true);
    expect(calls.some((c) => c.startsWith("worktree add ") && !c.includes("--checkout"))).toBe(true);
  });

  test("materializes from origin when ls-remote lists the remote head", async () => {
    const root = mkdtempSync(join(tmpdir(), "jarvis-v2-worktree-remote-head-"));
    roots.push(root);
    const repoRoot2 = join(root, "repo");
    const jarvisRoot2 = join(root, "jarvis-home");
    mkdirSync(repoRoot2, { recursive: true });
    mkdirSync(join(repoRoot2, "node_modules"));
    const fakeState = createFakeGitState();
    registerRepo(fakeState, repoRoot2);
    const repo = fakeState.repos.get(repoRoot2);
    if (!repo) throw new Error("repo missing");
    repo.remoteBranches.add("write-run");
    const calls: string[] = [];
    const runner: AsyncSubprocessRunner = {
      async runAsync(cmd, args, cwd, options) {
        if (cmd === "git") calls.push(args.join(" "));
        return createWorktreeRunner(fakeState).runAsync(cmd, args, cwd, options);
      },
    };

    await withExternalWorktree(makeInput(jarvisRoot2, repoRoot2), () => "ok", runner);

    expect(calls.some((c) => c === "branch write-run origin/write-run")).toBe(true);
    expect(calls.some((c) => c.startsWith("worktree add --checkout"))).toBe(true);
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

  test("rejects a successful worktree add that does not materialize a valid worktree before its callback", async () => {
    const { repoRoot, jarvisRoot, runner: innerRunner } = setupMockRepo();
    let callbackCalled = false;
    const runner: AsyncSubprocessRunner = {
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
        runner,
      ),
    ).rejects.toMatchObject({
      name: "WorktreeMaterializationError",
      worktreePath,
      message: expect.stringContaining(`created path is not a git worktree: ${worktreePath}`),
    } satisfies Partial<WorktreeMaterializationError>);
    expect(callbackCalled).toBe(false);
  });

  test("preserves an Error cause's message verbatim (no wrapping prefix)", () => {
    // Pins the `cause instanceof Error ? cause.message : String(cause)` branch: an Error cause
    // must contribute its bare `.message`, not `String(error)` (which would add an "Error: " prefix).
    const err = new WorktreeMaterializationError("/managed/wt", new Error("git worktree add left no checkout"));
    expect(err.worktreePath).toBe("/managed/wt");
    expect(err.cause).toBeInstanceOf(Error);
    expect(err.message).toBe("Failed to materialize worktree /managed/wt: git worktree add left no checkout");
  });

  test("stringifies a non-Error cause", () => {
    // Pins the `String(cause)` branch: a non-Error cause has no `.message`, so it must be stringified.
    const err = new WorktreeMaterializationError("/managed/wt", "raw failure");
    expect(err.message).toBe("Failed to materialize worktree /managed/wt: raw failure");
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
    expect(existsSync(getExternalWorktreePath(makeInput(jarvisRoot, otherRepoRoot)))).toBe(true);
  });

  test("refuses to reuse a worktree on a different branch", async () => {
    const { repoRoot, jarvisRoot, runner } = setupMockRepo();

    const result = await withExternalWorktree(makeInput(jarvisRoot, repoRoot), () => undefined, runner);
    await runner.runAsync("git", ["checkout", "-b", "other-branch"], result.worktree.path);

    await expect(withExternalWorktree(makeInput(jarvisRoot, repoRoot), () => "never", runner)).rejects.toThrow(
      "is on branch other-branch, expected write-run",
    );
    expect(existsSync(result.worktree.path)).toBe(true);
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

  test("reclaims an unregistered non-Git directory and reaches its callback in one retry", async () => {
    const { repoRoot, jarvisRoot, runner } = setupMockRepo();
    const path = getExternalWorktreePath(makeInput(jarvisRoot, repoRoot));
    mkdirSync(path, { recursive: true });
    writeFileSync(join(path, "failed-materialization"), "husk");
    let callbackBranch: string | undefined;

    const result = await withExternalWorktree(
      makeInput(jarvisRoot, repoRoot),
      async (worktree) => {
        callbackBranch = (await runner.runAsync("git", ["rev-parse", "--abbrev-ref", "HEAD"], worktree.path)).trim();
      },
      runner,
    );

    expect(result.worktree).toEqual({ path, reused: false });
    expect(callbackBranch).toBe("write-run");
    expect(existsSync(join(path, "failed-materialization"))).toBe(false);
    expect(existsSync(getExternalWorktreeLockPath(getLockRoot(jarvisRoot)))).toBe(false);
  });

  test("refuses a registered non-Git directory and leaves it intact", async () => {
    const { repoRoot, jarvisRoot, runner: innerRunner } = setupMockRepo();
    const path = getExternalWorktreePath(makeInput(jarvisRoot, repoRoot));
    mkdirSync(path, { recursive: true });
    writeFileSync(join(path, "registered-residue"), "keep");
    const runner: AsyncSubprocessRunner = {
      async runAsync(cmd, args, cwd, options) {
        if (cmd === "git" && args.join(" ") === "worktree list --porcelain") return `worktree ${path}\n`;
        return innerRunner.runAsync(cmd, args, cwd, options);
      },
    };

    await expect(withExternalWorktree(makeInput(jarvisRoot, repoRoot), () => "never", runner)).rejects.toThrow(
      `existing path is registered as a git worktree: ${path}`,
    );
    expect(existsSync(join(path, "registered-residue"))).toBe(true);
    expect(existsSync(getExternalWorktreeLockPath(getLockRoot(jarvisRoot)))).toBe(false);
  });

  test("refuses an ambiguous Git-worktree probe and leaves the path intact", async () => {
    const { repoRoot, jarvisRoot, runner: innerRunner } = setupMockRepo();
    const path = getExternalWorktreePath(makeInput(jarvisRoot, repoRoot));
    mkdirSync(path, { recursive: true });
    writeFileSync(join(path, "ambiguous-residue"), "keep");
    const runner: AsyncSubprocessRunner = {
      async runAsync(cmd, args, cwd, options) {
        if (cmd === "git" && args.join(" ") === "rev-parse --is-inside-work-tree") {
          throw new Error("validation probe failed");
        }
        return innerRunner.runAsync(cmd, args, cwd, options);
      },
    };

    await expect(withExternalWorktree(makeInput(jarvisRoot, repoRoot), () => "never", runner)).rejects.toThrow(
      `could not validate existing path as a git worktree: ${path}`,
    );
    expect(existsSync(join(path, "ambiguous-residue"))).toBe(true);
    expect(existsSync(getExternalWorktreeLockPath(getLockRoot(jarvisRoot)))).toBe(false);
  });

  test("refuses an inconclusive worktree-registration probe and leaves the path intact", async () => {
    const { repoRoot, jarvisRoot, runner: innerRunner } = setupMockRepo();
    const path = getExternalWorktreePath(makeInput(jarvisRoot, repoRoot));
    mkdirSync(path, { recursive: true });
    writeFileSync(join(path, "registration-residue"), "keep");
    const runner: AsyncSubprocessRunner = {
      async runAsync(cmd, args, cwd, options) {
        if (cmd === "git" && args.join(" ") === "worktree list --porcelain") {
          throw new Error("worktree registration probe failed");
        }
        return innerRunner.runAsync(cmd, args, cwd, options);
      },
    };

    await expect(withExternalWorktree(makeInput(jarvisRoot, repoRoot), () => "never", runner)).rejects.toThrow(
      "worktree registration probe failed",
    );
    expect(existsSync(join(path, "registration-residue"))).toBe(true);
    expect(existsSync(getExternalWorktreeLockPath(getLockRoot(jarvisRoot)))).toBe(false);
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

  test("recreates a missing but still-registered worktree", async () => {
    const { repoRoot, jarvisRoot, runner } = setupMockRepo();

    const first = await withExternalWorktree(makeInput(jarvisRoot, repoRoot), () => undefined, runner);
    rmSync(first.worktree.path, { recursive: true, force: true });

    const second = await withExternalWorktree(makeInput(jarvisRoot, repoRoot), () => "ok", runner);

    expect(second.worktree.reused).toBe(false);
    expect(existsSync(second.worktree.path)).toBe(true);
  });
});
