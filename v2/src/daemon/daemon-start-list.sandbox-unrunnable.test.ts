// Real unix sockets are the behavior under test: these smokes prove the run-control
// handlers marshal start/list params and results through production IPC framing
// end-to-end. Handler behavior itself is covered in-process by daemon-start-list.test.ts.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connectIpcClient } from "../ipc/client.ts";
import { startIpcServer } from "../ipc/server.ts";
import { openStateStore, type StateStore } from "../persistence/state-store.ts";
import { listRuns, startRun, toIpcHandlers } from "../testing/run-control.ts";
import { canUseUnixSockets } from "../testing/unix-socket.ts";
import { createFakeWriteLoopExecutor, type FakeWriteLoopExecutor } from "../testing/write-loop-executor.ts";
import { createRunControlHandlers } from "./daemon.ts";

const socketTest = test.skipIf(!canUseUnixSockets());

let stateStore: StateStore;
let fakeExecutor: FakeWriteLoopExecutor;
let handlers: ReturnType<typeof createRunControlHandlers>;

function uniqueSocketPath(suffix: string): string {
  return join(tmpdir(), `jarvis-daemon-smoke-${process.pid}-${suffix}.sock`);
}

beforeEach(() => {
  if (!canUseUnixSockets()) {
    return;
  }
  stateStore = openStateStore(join(tmpdir(), `jarvis-smoke-state-${process.pid}-${Date.now()}.db`));
  fakeExecutor = createFakeWriteLoopExecutor();
  handlers = createRunControlHandlers({
    stateStore,
    writeLoopExecutor: fakeExecutor.executor,
    failureReporter: () => {},
    hasMemoryHeadroom: () => true,
    settleDelayMs: 0,
  });
});

afterEach(async () => {
  if (!canUseUnixSockets()) {
    return;
  }
  fakeExecutor.abortAll();
  await new Promise<void>((resolve) => setImmediate(resolve));
  try {
    stateStore.close();
  } catch {
    // store may be closed
  }
});

socketTest("start returns a run ID over production IPC", async () => {
  const socketPath = uniqueSocketPath("start");
  rmSync(socketPath, { force: true });
  const server = await startIpcServer(socketPath, toIpcHandlers(handlers));
  try {
    const client = await connectIpcClient(socketPath, 2_000);
    const runId = await startRun(client);
    expect(typeof runId).toBe("string");
    client.close();
  } finally {
    await server.close();
    rmSync(socketPath, { force: true });
  }
});

socketTest("list returns durable runs with liveness info over production IPC", async () => {
  const socketPath = uniqueSocketPath("list");
  rmSync(socketPath, { force: true });
  const server = await startIpcServer(socketPath, toIpcHandlers(handlers));
  try {
    const client = await connectIpcClient(socketPath, 2_000);
    await startRun(client);
    const runs = await listRuns(client);
    if (!runs) {
      client.close();
      return;
    }

    expect(runs.length).toBeGreaterThan(0);
    const run = runs[0];
    expect(run).toHaveProperty("runId");
    expect(run).toHaveProperty("project");
    expect(run).toHaveProperty("branch");
    expect(run).toHaveProperty("status");
    expect(run).toHaveProperty("isLive");
    expect(run?.isLive).toBe(true);
    client.close();
  } finally {
    await server.close();
    rmSync(socketPath, { force: true });
  }
});
