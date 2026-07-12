// Proves daemon IPC stays responsive while finalization's ready gate is pending.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createReadyFinalizer } from "../execution/ready-finalize.ts";
import { executeWriteLoop, type WriteLoopInput } from "../execution/write-loop.ts";
import { connectIpcClient } from "../ipc/client.ts";
import { startIpcServer } from "../ipc/server.ts";
import { openLogReader, openLogSink } from "../persistence/log-stream.ts";
import { openStateStore, type StateStore } from "../persistence/state-store.ts";
import { simulatedBindings } from "../testing/bindings.ts";
import { listRuns, mockWriteLoopInput, startRun, toIpcHandlers } from "../testing/run-control.ts";
import { canUseUnixSockets } from "../testing/unix-socket.ts";
import { createFakeWithExternalWorktree, createJarvisHome } from "../testing/write-fixtures.ts";
import { createRunControlHandlers, createTailStreamHandler } from "./daemon.ts";

const socketTest = test.skipIf(!canUseUnixSockets());

function createHeldReadyGate(): {
  run: () => Promise<void>;
  whenPending: () => Promise<void>;
  isReleased: () => boolean;
  release: () => void;
} {
  let releaseGate: (() => void) | undefined;
  let notifyPending: (() => void) | undefined;
  let released = false;
  const pending = new Promise<void>((resolve) => {
    notifyPending = resolve;
  });
  const held = new Promise<void>((resolve) => {
    releaseGate = resolve;
  });

  return {
    run: async () => {
      notifyPending?.();
      notifyPending = undefined;
      await held;
    },
    whenPending: () => pending,
    isReleased: () => released,
    release: () => {
      released = true;
      releaseGate?.();
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

function uniquePath(suffix: string): string {
  return join(tmpdir(), `jarvis-ready-gate-${process.pid}-${Date.now()}-${suffix}`);
}

let stateStore: StateStore;
let statePath: string;
const tempRoots: string[] = [];

beforeEach(() => {
  if (!canUseUnixSockets()) return;
  statePath = uniquePath("state.db");
  stateStore = openStateStore(statePath);
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
  rmSync(statePath, { force: true });
});

socketTest("list and tail complete while finalization's ready gate is held", async () => {
  const { jarvisRoot } = createJarvisHome();
  tempRoots.push(join(jarvisRoot, ".."));
  const branchName = "ready-gate-responsive";
  const logsPath = uniquePath("logs.jsonl");
  const readyGate = createHeldReadyGate();
  const readyFinalizer = createReadyFinalizer({
    runReadyGate: readyGate.run,
    ghReadyFlip: async () => {},
  });
  let finishRun: (() => void) | undefined;
  const runFinished = new Promise<void>((resolve) => {
    finishRun = resolve;
  });

  const loopInput: WriteLoopInput = {
    ...mockWriteLoopInput({ projectName: "demo", branchName, projectRoot: "/fake", jarvisRoot }),
    specPath: "spec.md",
    stepRules: "Return exactly one terminal token.",
    expectedArtifactPath: "proof.txt",
    bindings: simulatedBindings(["done"], { artifactPath: "proof.txt", emitArtifact: true }),
    completionCommitter: async () => ({ commitSha: "commit-1", filesChanged: 1 }),
    completionPublisher: async () => ({}),
    readyFinalizer,
  };

  const handlers = createRunControlHandlers({
    stateStore,
    logReader: openLogReader(logsPath),
    writeLoopExecutor: async (input, signal, pauseSignal) => {
      const logSink = openLogSink(logsPath);
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
          logSink,
        });
      } finally {
        logSink.close();
        finishRun?.();
      }
    },
    failureReporter: () => {},
    hasMemoryHeadroom: () => true,
    settleDelayMs: 0,
  });

  const socketPath = uniquePath("daemon.sock");
  const server = await startIpcServer(
    socketPath,
    toIpcHandlers(handlers),
    createTailStreamHandler({ stateStore, logReader: openLogReader(logsPath) }),
  );
  try {
    const startClient = await connectIpcClient(socketPath, 2_000);
    const listClient = await connectIpcClient(socketPath, 2_000);
    const tailClient = await connectIpcClient(socketPath, 2_000);
    const startPromise = startRun(startClient, {
      ...mockWriteLoopInput({ projectName: "demo", branchName, projectRoot: "/fake", jarvisRoot }),
      specPath: "spec.md",
      stepRules: "Return exactly one terminal token.",
      expectedArtifactPath: "proof.txt",
      bindings: [],
    });

    await readyGate.whenPending();
    const runId = await startPromise;
    expect(typeof runId).toBe("string");
    if (!runId) throw new Error("start did not return runId");

    const runs = await listRuns(listClient);
    expect(runs?.[0]?.runId).toBe(runId);
    expect(runs?.[0]?.status).toBe("completed");
    expect(readyGate.isReleased()).toBe(false);

    tailClient.send({ kind: "stream-open", streamId: "tail-1", payload: { runId } });
    const tailFrame = await tailClient.nextFrame();
    expect(tailFrame.kind).toBe("stream-data");
    expect(readyGate.isReleased()).toBe(false);
    tailClient.send({ kind: "stream-end", streamId: "tail-1" });

    readyGate.release();
    await runFinished;

    const settled = await listRuns(listClient);
    expect(settled?.[0]?.status).toBe("completed");
    expect(settled?.[0]?.isLive).toBe(false);

    startClient.close();
    listClient.close();
    tailClient.close();
  } finally {
    await server.close();
    rmSync(socketPath, { force: true });
    rmSync(logsPath, { force: true });
  }
});
