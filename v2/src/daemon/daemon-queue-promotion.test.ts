import { afterEach, beforeEach, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WriteLoopInput } from "../execution/write-loop.ts";
import { connectIpcClient } from "../ipc/client.ts";
import { type IpcServer, startIpcServer } from "../ipc/server.ts";
import { openStateStore, type StateStore } from "../persistence/state-store.ts";
import { listRuns, mockWriteLoopInput, startRun } from "../testing/run-control.ts";
import { canUseUnixSockets } from "../testing/unix-socket.ts";
import { createRunControlHandlers } from "./daemon.ts";

const SOCKET_PATH = join(tmpdir(), `jarvis-daemon-queue-promotion-test-${process.pid}.sock`);
const socketTest = test.skipIf(!canUseUnixSockets());

type PendingExecutorRun = {
  input: WriteLoopInput;
  signal: AbortSignal;
  release: () => void;
};

function createFakeWriteLoopExecutor() {
  const pending: PendingExecutorRun[] = [];

  const executor = async (input: WriteLoopInput, signal: AbortSignal): Promise<void> => {
    await new Promise<void>((resolve) => {
      let released = false;
      const release = (): void => {
        if (released) return;
        released = true;
        resolve();
      };
      pending.push({ input, signal, release });
      signal.addEventListener("abort", release, { once: true });
    });
  };

  return {
    executor,
    settleOne: (): void => {
      pending.shift()?.release();
    },
    settleAll: (): void => {
      while (pending.length > 0) {
        pending.shift()?.release();
      }
    },
    pendingCount: (): number => pending.length,
    pendingKeys: (): string[] =>
      pending.map((run) => `${run.input.worktree.projectName}:${run.input.worktree.branchName}`),
  };
}

type FakeWriteLoopExecutor = ReturnType<typeof createFakeWriteLoopExecutor>;

let stateStore: StateStore;
let server: IpcServer;
let fakeExecutor: FakeWriteLoopExecutor;
let memoryHeadroom: boolean;

async function flushBackgroundRuns(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
  await new Promise<void>((resolve) => setImmediate(resolve));
}

async function startHandlers(settleDelayMs: number): Promise<void> {
  server = await startIpcServer(
    SOCKET_PATH,
    createRunControlHandlers({
      stateStore,
      writeLoopExecutor: fakeExecutor.executor,
      failureReporter: () => {},
      hasMemoryHeadroom: () => memoryHeadroom,
      settleDelayMs,
    }),
  );
}

beforeEach(async () => {
  if (!canUseUnixSockets()) {
    return;
  }
  rmSync(SOCKET_PATH, { force: true });
  stateStore = openStateStore(join(tmpdir(), `jarvis-state-queue-promotion-${process.pid}-${Date.now()}.db`));
  fakeExecutor = createFakeWriteLoopExecutor();
  memoryHeadroom = true;
});

afterEach(async () => {
  if (!canUseUnixSockets()) {
    return;
  }
  fakeExecutor.settleAll();
  await flushBackgroundRuns();
  try {
    await server.close();
  } catch {
    // server may have already stopped
  }
  rmSync(SOCKET_PATH, { force: true });
  try {
    stateStore.close();
  } catch {
    // store may be closed
  }
});

socketTest(
  "promotes the oldest queued run before a younger one once memory clears and the settle delay has elapsed",
  async () => {
    await startHandlers(0);
    const client = await connectIpcClient(SOCKET_PATH, 2_000);

    memoryHeadroom = false;
    const runIdA = await startRun(client, mockWriteLoopInput({ projectName: "project-a" }));
    const runIdB = await startRun(client, mockWriteLoopInput({ projectName: "project-b" }));
    expect(stateStore.loadRun(runIdA!)?.status).toBe("queued");
    expect(stateStore.loadRun(runIdB!)?.status).toBe("queued");

    memoryHeadroom = true;
    // A start on a distinct, unrelated key triggers the post-admit promotion check.
    await startRun(client, mockWriteLoopInput({ projectName: "project-trigger" }));
    await flushBackgroundRuns();

    expect(stateStore.loadRun(runIdA!)?.status).toBe("in-progress");
    expect(stateStore.loadRun(runIdB!)?.status).toBe("queued");

    client.close();
  },
);

socketTest("a queued run stays queued while memory stays below the watermark", async () => {
  await startHandlers(0);
  const client = await connectIpcClient(SOCKET_PATH, 2_000);

  memoryHeadroom = false;
  const runId = await startRun(client, mockWriteLoopInput({ projectName: "project-a" }));
  await flushBackgroundRuns();

  expect(stateStore.loadRun(runId!)?.status).toBe("queued");
  client.close();
});

socketTest(
  "promoting one queued run does not touch an already-running run when headroom later reports insufficient",
  async () => {
    await startHandlers(100_000);
    const client = await connectIpcClient(SOCKET_PATH, 2_000);

    const runningId = await startRun(client, mockWriteLoopInput({ projectName: "project-running" }));

    memoryHeadroom = false;
    const queuedId = await startRun(client, mockWriteLoopInput({ projectName: "project-queued" }));
    expect(stateStore.loadRun(queuedId!)?.status).toBe("queued");

    memoryHeadroom = true;
    // A start on a distinct, unrelated key admits directly and triggers the post-admit
    // promotion check; project-running is never touched by it.
    await startRun(client, mockWriteLoopInput({ projectName: "project-trigger" }));
    await flushBackgroundRuns();

    expect(stateStore.loadRun(queuedId!)?.status).toBe("in-progress");
    expect(stateStore.loadRun(runningId!)?.status).toBe("in-progress");

    // Memory now drops below the watermark again; project-running's status must never
    // change as a side effect of headroom checks — there is no preemption.
    memoryHeadroom = false;
    await flushBackgroundRuns();
    expect(stateStore.loadRun(runningId!)?.status).toBe("in-progress");

    client.close();
  },
);

socketTest(
  "a queued run whose key is claimed by a live run is skipped in favor of the next-oldest eligible queued run",
  async () => {
    await startHandlers(0);
    const client = await connectIpcClient(SOCKET_PATH, 2_000);

    const liveKey = mockWriteLoopInput({ projectName: "project-live" });
    const liveRunId = await startRun(client, liveKey);

    memoryHeadroom = false;
    const blockedQueuedId = await startRun(client, liveKey);
    const eligibleQueuedId = await startRun(client, mockWriteLoopInput({ projectName: "project-eligible" }));
    expect(stateStore.loadRun(blockedQueuedId!)?.status).toBe("queued");
    expect(stateStore.loadRun(eligibleQueuedId!)?.status).toBe("queued");

    memoryHeadroom = true;
    await startRun(client, mockWriteLoopInput({ projectName: "project-trigger" }));
    await flushBackgroundRuns();

    expect(stateStore.loadRun(eligibleQueuedId!)?.status).toBe("in-progress");
    expect(stateStore.loadRun(blockedQueuedId!)?.status).toBe("queued");
    expect(stateStore.loadRun(liveRunId!)?.status).toBe("in-progress");

    client.close();
  },
);

socketTest(
  "a start that queues because memory is briefly tight is promoted immediately once memory has already recovered",
  async () => {
    let calls = 0;
    server = await startIpcServer(
      SOCKET_PATH,
      createRunControlHandlers({
        stateStore,
        writeLoopExecutor: fakeExecutor.executor,
        failureReporter: () => {},
        // Reports no headroom for the initial admission check, then recovered for the
        // immediate recheck performed right after the row is persisted.
        hasMemoryHeadroom: () => {
          calls += 1;
          return calls > 1;
        },
        settleDelayMs: 0,
      }),
    );
    const client = await connectIpcClient(SOCKET_PATH, 2_000);

    const runId = await startRun(client, mockWriteLoopInput({ projectName: "project-recovering" }));
    await flushBackgroundRuns();

    expect(stateStore.loadRun(runId!)?.status).toBe("in-progress");

    client.close();
  },
);

socketTest("a run reaching a paused status frees its key for promotion of an eligible queued run", async () => {
  await startHandlers(0);
  const client = await connectIpcClient(SOCKET_PATH, 2_000);

  const pausedKey = mockWriteLoopInput({ projectName: "project-pausing" });
  const pausingRunId = await startRun(client, pausedKey);

  memoryHeadroom = false;
  const queuedId = await startRun(client, mockWriteLoopInput({ projectName: "project-queued-2" }));
  expect(stateStore.loadRun(queuedId!)?.status).toBe("queued");

  memoryHeadroom = true;
  stateStore.setRunStatus(pausingRunId!, "paused");
  fakeExecutor.settleOne();
  await flushBackgroundRuns();

  expect(stateStore.loadRun(queuedId!)?.status).toBe("in-progress");

  client.close();
});

socketTest("list reports a promoted run as in-progress and live", async () => {
  await startHandlers(0);
  const client = await connectIpcClient(SOCKET_PATH, 2_000);

  memoryHeadroom = false;
  const queuedId = await startRun(client, mockWriteLoopInput({ projectName: "project-list" }));

  memoryHeadroom = true;
  await startRun(client, mockWriteLoopInput({ projectName: "project-trigger-list" }));
  await flushBackgroundRuns();

  const runs = await listRuns(client);
  const row = runs?.find((candidate) => candidate.runId === queuedId);
  expect(row?.status).toBe("in-progress");
  expect(row?.isLive).toBe(true);

  client.close();
});
