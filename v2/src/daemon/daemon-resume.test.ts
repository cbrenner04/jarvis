import { afterEach, beforeEach, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WriteLoopInput } from "../execution/write-loop.ts";
import { connectIpcClient } from "../ipc/client.ts";
import { type IpcServer, startIpcServer } from "../ipc/server.ts";
import { openStateStore, type StateStore } from "../persistence/state-store.ts";
import { canUseUnixSockets } from "../testing/unix-socket.ts";
import { createRunControlHandlers } from "./daemon.ts";

const SOCKET_PATH = join(tmpdir(), `jarvis-daemon-resume-test-${process.pid}.sock`);
const socketTest = test.skipIf(!canUseUnixSockets());

let stateStore: StateStore;
let server: IpcServer;
let starts: WriteLoopInput[];

beforeEach(async () => {
  if (!canUseUnixSockets()) {
    return;
  }
  rmSync(SOCKET_PATH, { force: true });
  stateStore = openStateStore(join(tmpdir(), `jarvis-state-resume-${process.pid}-${Date.now()}.db`));
  starts = [];

  const handlers = createRunControlHandlers({
    stateStore,
    writeLoopExecutor: async (input) => {
      starts.push(input);
    },
    failureReporter: () => {},
    isWorktreeDirty: () => false,
  });

  server = await startIpcServer(SOCKET_PATH, handlers);
});

afterEach(async () => {
  if (!canUseUnixSockets()) {
    return;
  }
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

socketTest("resume on a paused run returns not_implemented without invoking the executor", async () => {
  const client = await connectIpcClient(SOCKET_PATH, 2_000);
  const pausedRunId = stateStore.createRun({
    project: "test-project",
    specRef: "main",
    worktreePath: "/tmp/test-project-worktree",
    branch: "test-branch",
    specPath: "/tmp/test-project/spec.md",
  });
  stateStore.setRunStatus(pausedRunId, "paused");

  client.send({ kind: "request", id: "r1", method: "resume", params: { runId: pausedRunId } });
  const response = await client.nextFrame();
  expect(response.kind).toBe("error");
  if (response.kind === "error") {
    expect(response.code).toBe("not_implemented");
    expect(response.message).toBe("Paused run resume is not yet implemented");
  }

  expect(starts).toHaveLength(0);
  expect(stateStore.loadRun(pausedRunId)?.status).toBe("paused");
  client.close();
});
