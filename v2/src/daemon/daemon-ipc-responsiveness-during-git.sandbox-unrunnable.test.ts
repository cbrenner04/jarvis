// Proves daemon IPC stays responsive while a representative run-path Git command is pending.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AsyncSubprocessRunner } from "../../../shared/subprocess.ts";
import { withExternalWorktree } from "../execution/external-worktree.ts";
import { connectIpcClient } from "../ipc/client.ts";
import { startIpcServer } from "../ipc/server.ts";
import { openStateStore, type StateStore } from "../persistence/state-store.ts";
import { createHoldableAsyncSubprocessRunner } from "../testing/holdable-async-subprocess-runner.ts";
import { mockWriteLoopInput, startRun, toIpcHandlers } from "../testing/run-control.ts";
import { canUseUnixSockets } from "../testing/unix-socket.ts";
import { createRunControlHandlers } from "./daemon.ts";

const socketTest = test.skipIf(!canUseUnixSockets());

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
    localBranches: new Set(["main"]),
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

      throw new Error(`createWorktreeRunner: no handler for git ${args.join(" ")}`);
    },
  };
}

function setupMockRepo(tempRoots: string[]): { repoRoot: string; jarvisRoot: string; runner: AsyncSubprocessRunner } {
  const root = mkdtempSync(join(tmpdir(), "jarvis-v2-ipc-git-"));
  tempRoots.push(root);
  const repoRoot = join(root, "repo");
  const jarvisRoot = join(root, "jarvis-home");
  mkdirSync(repoRoot, { recursive: true });
  const state = createFakeGitState();
  registerRepo(state, repoRoot);
  return { repoRoot, jarvisRoot, runner: createWorktreeRunner(state) };
}

function uniqueSocketPath(suffix: string): string {
  return join(tmpdir(), `jarvis-daemon-ipc-git-${process.pid}-${suffix}.sock`);
}

let stateStore: StateStore;
const tempRoots: string[] = [];

beforeEach(() => {
  if (!canUseUnixSockets()) {
    return;
  }
  stateStore = openStateStore(join(tmpdir(), `jarvis-ipc-git-state-${process.pid}-${Date.now()}.db`));
});

afterEach(async () => {
  if (!canUseUnixSockets()) {
    return;
  }
  await new Promise<void>((resolve) => setImmediate(resolve));
  for (const root of tempRoots.splice(0, tempRoots.length)) {
    rmSync(root, { recursive: true, force: true });
  }
  try {
    stateStore.close();
  } catch {
    // store may be closed
  }
});

socketTest("health completes after run-path Git signals pending and before Git is released", async () => {
  const { repoRoot, jarvisRoot, runner: innerRunner } = setupMockRepo(tempRoots);
  const holdable = createHoldableAsyncSubprocessRunner(innerRunner);
  let finishRun: (() => void) | undefined;
  const runFinished = new Promise<void>((resolve) => {
    finishRun = resolve;
  });

  const handlers = createRunControlHandlers({
    stateStore,
    writeLoopExecutor: async (input) => {
      try {
        await withExternalWorktree(input.worktree, async () => undefined, holdable.runner);
      } finally {
        finishRun?.();
      }
    },
    failureReporter: () => {},
    hasMemoryHeadroom: () => true,
    settleDelayMs: 0,
  });

  const socketPath = uniqueSocketPath("responsive-git");
  rmSync(socketPath, { force: true });
  const server = await startIpcServer(socketPath, {
    health: () => ({ kind: "response", result: { ok: true } }),
    ...toIpcHandlers(handlers),
  });
  try {
    const startClient = await connectIpcClient(socketPath, 2_000);
    const healthClient = await connectIpcClient(socketPath, 2_000);

    const startPromise = startRun(
      startClient,
      mockWriteLoopInput({
        projectRoot: repoRoot,
        projectName: "demo",
        branchName: "feature",
        baseRef: "main",
        jarvisRoot,
      }),
    );

    await holdable.whenPending();
    let released = false;
    healthClient.send({ kind: "request", id: "h1", method: "health" });
    const healthFrame = await healthClient.nextFrame();
    expect(released).toBe(false);
    expect(healthFrame).toEqual({ kind: "response", id: "h1", result: { ok: true } });

    released = true;
    holdable.release();

    const runId = await startPromise;
    expect(typeof runId).toBe("string");
    await runFinished;

    const worktreePath = join(jarvisRoot, "worktrees", "demo", "feature");
    expect(existsSync(worktreePath)).toBe(true);

    startClient.close();
    healthClient.close();
  } finally {
    await server.close();
    rmSync(socketPath, { force: true });
  }
});
