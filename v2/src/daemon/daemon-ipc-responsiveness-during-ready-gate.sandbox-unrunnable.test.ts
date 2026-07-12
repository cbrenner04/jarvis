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
  run: (worktreePath: string) => Promise<void>;
  whenPending: () => Promise<void>;
  release: () => void;
} {
  let releaseGate: (() => void) | undefined;
  let notifyPending: (() => void) | undefined;
  const pending = new Promise<void>((resolve) => {
    notifyPending = resolve;
  });

  return {
    run: async () => {
      await new Promise<void>((resolve) => {
        releaseGate = resolve;
        notifyPending?.();
        notifyPending = undefined;
      });
    },
    whenPending: () => pending,
    release: () => {
      releaseGate?.();
      releaseGate = undefined;
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

function uniqueSocketPath(): string {
  return join(tmpdir(), `jarvis-daemon-ready-gate-${process.pid}-${Date.now()}.sock`);
}

let stateStore: StateStore;
let dbPath: string;
let logsPath: string;
const tempRoots: string[] = [];

beforeEach(() => {
  if (!canUseUnixSockets()) return;
  const suffix = `${process.pid}-${Date.now()}`;
  dbPath = join(tmpdir(), `jarvis-ready-gate-state-${suffix}.db`);
  logsPath = join(tmpdir(), `jarvis-ready-gate-logs-${suffix}.jsonl`);
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
  rmSync(logsPath, { force: true });
});

socketTest("list and tail answer before the held ready gate releases", async () => {
  const { jarvisRoot } = createJarvisHome();
  tempRoots.push(join(jarvisRoot, ".."));
  const branchName = "ready-gate-responsive";
  const heldGate = createHeldReadyGate();
  const readyFinalizer = createReadyFinalizer({
    runReadyGate: heldGate.run,
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
  const logReader = openLogReader(logsPath);
  const handlers = createRunControlHandlers({
    stateStore,
    logReader,
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
          logSink,
          withExternalWorktree: createWorktreeWithGit(jarvisRoot),
          signal,
          pauseSignal,
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

  const socketPath = uniqueSocketPath();
  const server = await startIpcServer(socketPath, toIpcHandlers(handlers), createTailStreamHandler({ stateStore, logReader }));
  try {
    const startClient = await connectIpcClient(socketPath, 2_000);
    const listClient = await connectIpcClient(socketPath, 2_000);
    const tailClient = await connectIpcClient(socketPath, 2_000);
    const startPromise = startRun(
      startClient,
      {
        ...mockWriteLoopInput({ projectName: "demo", branchName, projectRoot: "/fake", jarvisRoot }),
        specPath: "spec.md",
        stepRules: "Return exactly one terminal token.",
        expectedArtifactPath: "proof.txt",
        bindings: [],
      },
    );

    await heldGate.whenPending();
    const runId = await startPromise;
    expect(typeof runId).toBe("string");
    if (!runId) throw new Error("start did not return a run ID");

    let released = false;
    const runs = await listRuns(listClient);
    expect(released).toBe(false);
    expect(runs?.[0]?.runId).toBe(runId);

    tailClient.send({ kind: "stream-open", streamId: "tail-ready-gate", payload: { runId } });
    const tailFrame = await tailClient.nextFrame();
    expect(released).toBe(false);
    expect(tailFrame.kind).toBe("stream-data");
    if (tailFrame.kind === "stream-data") {
      expect(JSON.parse(tailFrame.payload as string)).toMatchObject({ runId });
    }

    released = true;
    heldGate.release();
    await runFinished;

    const settled = await listRuns(listClient);
    expect(settled?.[0]).toMatchObject({ runId, status: "completed", isLive: false });

    tailClient.send({ kind: "stream-end", streamId: "tail-ready-gate" });
    startClient.close();
    listClient.close();
    tailClient.close();
  } finally {
    await server.close();
    rmSync(socketPath, { force: true });
  }
});
