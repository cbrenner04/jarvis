// Proves daemon IPC stays responsive while a held run-path async op is pending.
// One property, parametrized over three hold points: the finalization ready gate,
// a run-path git command, and completion-publication's gh call. Real sockets are
// the seam under test, so this stays sandbox-unrunnable.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AsyncSubprocessRunner } from "../../../shared/subprocess.ts";
import { createCompletionPublisher } from "../execution/completion-publisher.ts";
import { withExternalWorktree } from "../execution/external-worktree.ts";
import { createReadyFinalizer } from "../execution/ready-finalize.ts";
import { executeWriteLoop, type WriteLoopInput } from "../execution/write-loop.ts";
import { connectIpcClient } from "../ipc/client.ts";
import { startIpcServer } from "../ipc/server.ts";
import { openStateStore, type StateStore } from "../persistence/state-store.ts";
import { simulatedBindings } from "../testing/bindings.ts";
import { createHoldableAsyncFn } from "../testing/holdable-async-subprocess-runner.ts";
import { listRuns, mockWriteLoopInput, startRun, toIpcHandlers } from "../testing/run-control.ts";
import { canUseUnixSockets } from "../testing/unix-socket.ts";
import { createFakeWithExternalWorktree, createJarvisHome } from "../testing/write-fixtures.ts";
import { createRunControlHandlers } from "./daemon.ts";

const socketTest = test.skipIf(!canUseUnixSockets());

type WriteLoopExecutor = (input: WriteLoopInput, signal: AbortSignal, pauseSignal: AbortSignal) => Promise<void>;

type HoldCase = {
  /** Run-path op the seam holds while IPC is probed. */
  name: string;
  make: (ctx: { stateStore: StateStore; jarvisRoot: string }) => {
    executor: WriteLoopExecutor;
    whenPending: () => Promise<void>;
    release: () => void;
    startInput: WriteLoopInput;
    /** Post-release assertions on the settled list row and side effects. */
    expectSettled: (row: { status: string; isLive: boolean } | undefined) => void;
  };
};

/** Fake worktree with a `.git` marker so the loop's git-aware steps accept it. */
function createWorktreeWithGit(jarvisRoot: string) {
  const base = createFakeWithExternalWorktree(jarvisRoot);
  return async <T>(
    args: { branchName: string; projectName: string; jarvisRoot?: string },
    run: (worktree: { path: string; reused: boolean }) => Promise<T> | T,
  ) =>
    base(args, async (worktree) => {
      mkdirSync(join(worktree.path, ".git"), { recursive: true });
      return run(worktree);
    });
}

/** Answers the fresh-worktree creation sequence of withExternalWorktree. */
function fakeGitRunner(): AsyncSubprocessRunner {
  return {
    async runAsync(_cmd, args) {
      const key = args.join(" ");
      if (key.startsWith("rev-parse --verify")) throw new Error("not a valid ref");
      if (key === "worktree prune") return "";
      if (args[0] === "branch") return "";
      if (args[0] === "worktree" && args[1] === "add") {
        const path = args[2] === "--checkout" ? args[3] : args[2];
        if (path) mkdirSync(path, { recursive: true });
        return "";
      }
      throw new Error(`fakeGitRunner: no handler for git ${key}`);
    },
  };
}

function completionStepInput(base: WriteLoopInput, jarvisRoot: string, stateStore: StateStore): WriteLoopInput {
  return {
    ...base,
    specPath: "spec.md",
    stepRules: "Return exactly one terminal token.",
    expectedArtifactPath: "proof.txt",
    bindings: simulatedBindings(["done"], { artifactPath: "proof.txt", emitArtifact: true }),
    completionCommitter: async () => ({ commitSha: "commit-1", filesChanged: 1 }),
    completionPublisher: async () => ({}),
    readyFinalizer: async () => {},
    stateStore,
    withExternalWorktree: createWorktreeWithGit(jarvisRoot),
  };
}

const holdCases: HoldCase[] = [
  {
    name: "finalization ready gate",
    make: ({ stateStore, jarvisRoot }) => {
      const heldGate = createHoldableAsyncFn(async (_worktreePath: string) => {});
      const readyFinalizer = createReadyFinalizer({ runReadyGate: heldGate.fn, ghReadyFlip: async () => {} });
      const startInput = mockWriteLoopInput({
        projectName: "demo",
        branchName: "held-gate",
        projectRoot: "/fake",
        jarvisRoot,
      });
      return {
        executor: async (input, signal, pauseSignal) => {
          await executeWriteLoop({
            ...completionStepInput(startInput, jarvisRoot, stateStore),
            worktree: input.worktree,
            readyFinalizer,
            signal,
            pauseSignal,
          });
        },
        whenPending: heldGate.whenPending,
        release: heldGate.release,
        startInput,
        expectSettled: (row) => {
          expect(row?.status).toBe("completed");
        },
      };
    },
  },
  {
    name: "run-path git command",
    make: ({ jarvisRoot }) => {
      const holdable = createHoldableAsyncFn(fakeGitRunner().runAsync);
      const runner: AsyncSubprocessRunner = { runAsync: holdable.fn };
      const worktreePath = join(jarvisRoot, "worktrees", "demo", "held-git");
      return {
        executor: async (input) => {
          await withExternalWorktree(input.worktree, async () => undefined, runner);
        },
        whenPending: holdable.whenPending,
        release: holdable.release,
        startInput: mockWriteLoopInput({
          projectName: "demo",
          branchName: "held-git",
          projectRoot: join(jarvisRoot, "repo"),
          baseRef: "main",
          jarvisRoot,
        }),
        expectSettled: (row) => {
          expect(row).toBeDefined();
          expect(existsSync(worktreePath)).toBe(true);
        },
      };
    },
  },
  {
    name: "completion-publication gh call",
    make: ({ stateStore, jarvisRoot }) => {
      const branchName = "held-publication";
      const holdableGh = createHoldableAsyncFn(async (_cwd: string, args: readonly string[]) => {
        if (args[0] === "pr" && args[1] === "list") return JSON.stringify([]);
        if (args[0] === "pr" && args[1] === "create") return "https://github.com/demo/demo/pull/42";
        if (args[0] === "pr" && args[1] === "view") {
          return JSON.stringify({ number: 42, url: "https://github.com/demo/demo/pull/42", baseRefName: "main" });
        }
        return "";
      });
      const completionPublisher = createCompletionPublisher({
        git: async (_cwd, args) => {
          if (args[0] === "rev-parse" && args.includes(`${branchName}@{u}`)) throw new Error("no upstream");
          if (args[0] === "rev-parse" && args[1] === "HEAD") return "abc123def456";
          return "";
        },
        gh: holdableGh.fn,
        delay: async () => {},
        fetchPrBody: async () => "",
        writePrBody: async () => {},
        renderFooter: async () => "",
      });
      const startInput = mockWriteLoopInput({ projectName: "demo", branchName, projectRoot: "/fake", jarvisRoot });
      return {
        executor: async (input, signal, pauseSignal) => {
          await executeWriteLoop({
            ...completionStepInput(startInput, jarvisRoot, stateStore),
            worktree: input.worktree,
            completionPublisher,
            signal,
            pauseSignal,
          });
        },
        whenPending: holdableGh.whenPending,
        release: holdableGh.release,
        startInput,
        expectSettled: (row) => {
          expect(row?.status).toBe("completed");
        },
      };
    },
  },
];

let stateStore: StateStore;
let dbPath: string;
const tempRoots: string[] = [];

beforeEach(() => {
  if (!canUseUnixSockets()) return;
  dbPath = join(tmpdir(), `jarvis-ipc-responsiveness-${process.pid}-${Date.now()}-${Math.random()}.db`);
  stateStore = openStateStore(dbPath);
});

afterEach(async () => {
  if (!canUseUnixSockets()) return;
  await new Promise<void>((resolve) => setImmediate(resolve));
  for (const root of tempRoots.splice(0, tempRoots.length)) {
    rmSync(root, { recursive: true, force: true });
  }
  try {
    stateStore.close();
  } catch {
    // store may be closed
  }
  rmSync(dbPath, { force: true });
});

for (const holdCase of holdCases) {
  socketTest(`list answers while the held ${holdCase.name} is pending`, async () => {
    const { jarvisRoot } = createJarvisHome();
    tempRoots.push(join(jarvisRoot, ".."));
    const seam = holdCase.make({ stateStore, jarvisRoot });

    let finishRun: (() => void) | undefined;
    const runFinished = new Promise<void>((resolve) => {
      finishRun = resolve;
    });
    const handlers = createRunControlHandlers({
      stateStore,
      writeLoopExecutor: async (input, signal, pauseSignal) => {
        try {
          await seam.executor(input, signal, pauseSignal);
        } finally {
          finishRun?.();
        }
      },
      failureReporter: () => {},
      hasMemoryHeadroom: () => true,
      settleDelayMs: 0,
    });

    const socketPath = join(tmpdir(), `jarvis-ipc-responsiveness-${process.pid}-${Date.now()}-${Math.random()}.sock`);
    rmSync(socketPath, { force: true });
    const server = await startIpcServer(socketPath, toIpcHandlers(handlers));
    try {
      const startClient = await connectIpcClient(socketPath, 2_000);
      const listClient = await connectIpcClient(socketPath, 2_000);

      const startPromise = startRun(startClient, seam.startInput);

      await seam.whenPending();
      let released = false;
      const runs = await listRuns(listClient);
      expect(released).toBe(false);
      expect(runs?.length).toBe(1);

      released = true;
      seam.release();

      const runId = await startPromise;
      expect(typeof runId).toBe("string");
      await runFinished;

      const settled = await listRuns(listClient);
      const row = settled?.find((candidate) => candidate.runId === runId);
      expect(row?.isLive).toBe(false);
      seam.expectSettled(row);

      startClient.close();
      listClient.close();
    } finally {
      await server.close();
      rmSync(socketPath, { force: true });
    }
  });
}
