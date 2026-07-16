// Proves daemon IPC stays responsive while a completion-publication command is pending.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCompletionPublisher } from "../execution/completion-publisher.ts";
import { executeWriteLoop, type WriteLoopInput } from "../execution/write-loop.ts";
import { connectIpcClient } from "../ipc/client.ts";
import { startIpcServer } from "../ipc/server.ts";
import { openStateStore, type StateStore } from "../persistence/state-store.ts";
import { simulatedBindings } from "../testing/bindings.ts";
import { listRuns, mockWriteLoopInput, startRun, toIpcHandlers } from "../testing/run-control.ts";
import { canUseUnixSockets } from "../testing/unix-socket.ts";
import { createFakeWithExternalWorktree, createJarvisHome } from "../testing/write-fixtures.ts";
import { createRunControlHandlers } from "./daemon.ts";

const socketTest = test.skipIf(!canUseUnixSockets());

function createHoldableAsyncSeam<T extends (...args: never[]) => Promise<unknown>>(
  inner: T,
): {
  fn: T;
  whenPending: () => Promise<void>;
  release: () => void;
} {
  let releaseHeld: (() => void) | undefined;
  let notifyPending: (() => void) | undefined;
  const pendingPromise = new Promise<void>((resolve) => {
    notifyPending = resolve;
  });
  let holdNext = true;

  const fn = (async (...args: Parameters<T>) => {
    if (holdNext) {
      holdNext = false;
      await new Promise<void>((resolve) => {
        releaseHeld = resolve;
        notifyPending?.();
        notifyPending = undefined;
      });
    }
    return inner(...args);
  }) as T;

  return {
    fn,
    whenPending: () => pendingPromise,
    release: () => {
      releaseHeld?.();
      releaseHeld = undefined;
    },
  };
}

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

function uniqueSocketPath(suffix: string): string {
  return join(tmpdir(), `jarvis-daemon-ipc-publication-${process.pid}-${suffix}.sock`);
}

let stateStore: StateStore;
const tempRoots: string[] = [];

beforeEach(() => {
  if (!canUseUnixSockets()) {
    return;
  }
  stateStore = openStateStore(join(tmpdir(), `jarvis-ipc-publication-state-${process.pid}-${Date.now()}.db`));
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

socketTest("list completes after publication gh auth signals pending and before auth is released", async () => {
  const { jarvisRoot } = createJarvisHome();
  tempRoots.push(join(jarvisRoot, ".."));
  const branchName = "pub-responsive";
  const holdableAuth = createHoldableAsyncSeam(async (_cwd: string) => true);
  let publicationCompleted = false;

  const completionPublisher = createCompletionPublisher({
    ghReady: holdableAuth.fn,
    git: async (_cwd, args) => {
      if (args[0] === "rev-parse" && args.includes(`${branchName}@{u}`)) {
        throw new Error("no upstream");
      }
      if (args[0] === "rev-parse" && args[1] === "HEAD") {
        return "abc123def456";
      }
      return "";
    },
    gh: async (_cwd, args) => {
      if (args[0] === "pr" && args[1] === "list") {
        return JSON.stringify([]);
      }
      if (args[0] === "pr" && args[1] === "create") {
        return "https://github.com/demo/demo/pull/42";
      }
      // Publication confirms the created PR exists before reporting success.
      if (args[0] === "pr" && args[1] === "view") {
        return JSON.stringify({ number: 42, url: "https://github.com/demo/demo/pull/42", baseRefName: "main" });
      }
      return "";
    },
    delay: async () => {},
    fetchPrBody: async () => "",
    writePrBody: async () => {},
    renderFooter: async () => "",
  });

  let finishRun: (() => void) | undefined;
  const runFinished = new Promise<void>((resolve) => {
    finishRun = resolve;
  });

  const loopInput: WriteLoopInput = {
    ...mockWriteLoopInput({
      projectName: "demo",
      branchName,
      projectRoot: "/fake",
      jarvisRoot,
    }),
    specPath: "spec.md",
    stepRules: "Return exactly one terminal token.",
    expectedArtifactPath: "proof.txt",
    bindings: simulatedBindings(["done"], { artifactPath: "proof.txt", emitArtifact: true }),
    completionCommitter: async () => ({ commitSha: "commit-1", filesChanged: 1 }),
    completionPublisher: async (input) => {
      const result = await completionPublisher(input);
      publicationCompleted = true;
      return result;
    },
    readyFinalizer: async () => {},
  };

  const handlers = createRunControlHandlers({
    stateStore,
    writeLoopExecutor: async (input, signal, pauseSignal) => {
      try {
        await executeWriteLoop({
          ...loopInput,
          worktree: input.worktree,
          specPath: input.specPath,
          stepRules: input.stepRules,
          expectedArtifactPath: input.expectedArtifactPath,
          stateStore,
          withExternalWorktree: createWorktreeWithGit(jarvisRoot),
          signal,
          pauseSignal,
        });
      } finally {
        finishRun?.();
      }
    },
    failureReporter: () => {},
    hasMemoryHeadroom: () => true,
    settleDelayMs: 0,
  });

  const socketPath = uniqueSocketPath("responsive-publication");
  rmSync(socketPath, { force: true });
  const server = await startIpcServer(socketPath, toIpcHandlers(handlers));
  try {
    const startClient = await connectIpcClient(socketPath, 2_000);
    const listClient = await connectIpcClient(socketPath, 2_000);

    const startPromise = startRun(startClient, {
      ...mockWriteLoopInput({
        projectName: "demo",
        branchName,
        projectRoot: "/fake",
        jarvisRoot,
      }),
      specPath: "spec.md",
      stepRules: "Return exactly one terminal token.",
      expectedArtifactPath: "proof.txt",
      bindings: [],
    });

    await holdableAuth.whenPending();
    let released = false;
    const runs = await listRuns(listClient);
    expect(released).toBe(false);
    expect(runs?.length).toBe(1);

    released = true;
    holdableAuth.release();

    const runId = await startPromise;
    expect(typeof runId).toBe("string");
    await runFinished;
    expect(publicationCompleted).toBe(true);

    const settled = await listRuns(listClient);
    expect(settled?.[0]?.status).toBe("completed");
    expect(settled?.[0]?.isLive).toBe(false);

    startClient.close();
    listClient.close();
  } finally {
    await server.close();
    rmSync(socketPath, { force: true });
  }
});
