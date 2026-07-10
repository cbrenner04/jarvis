// Real unix sockets are the behavior under test: this smoke proves the TUI log-tail
// client replays persisted records through production IPC stream framing end-to-end.
// The client's parse/stream logic is covered by fake-client tests in
// tui-log-tail-client.test.ts.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTailStreamHandler } from "../daemon/daemon.ts";
import { connectIpcClient } from "../ipc/client.ts";
import { type IpcServer, startIpcServer } from "../ipc/server.ts";
import { openLogReader, openLogSink } from "../persistence/log-stream.ts";
import { openStateStore, type StateStore } from "../persistence/state-store.ts";
import { canUseUnixSockets } from "../testing/unix-socket.ts";
import { connectTuiLogTail } from "./tui-log-tail-client.ts";

const SOCKET_PATH = join(tmpdir(), `jarvis-tui-log-tail-${process.pid}.sock`);
const LOGS_PATH = join(tmpdir(), `jarvis-tui-log-tail-logs-${process.pid}.jsonl`);
const socketTest = test.skipIf(!canUseUnixSockets());

let stateStore: StateStore;
let server: IpcServer;

function createRunWithLogs(): string {
  const runId = stateStore.createRun({
    project: "test-project",
    specRef: "main",
    worktreePath: "/tmp/test-worktree",
    branch: "test-branch",
    specPath: "/tmp/test-project/spec.md",
  });
  const logSink = openLogSink(LOGS_PATH);
  logSink.append(runId, { kind: "iteration_started", attemptId: "attempt-1" });
  logSink.append(runId, {
    kind: "boundary_committed",
    attemptId: "attempt-1",
    outcomeKind: "progress",
    runStatus: "in-progress",
  });
  logSink.close();
  return runId;
}

beforeEach(async () => {
  if (!canUseUnixSockets()) {
    return;
  }
  rmSync(SOCKET_PATH, { force: true });
  rmSync(LOGS_PATH, { force: true });
  stateStore = openStateStore(join(tmpdir(), `jarvis-tui-log-tail-state-${process.pid}-${Date.now()}.db`));
  const tailHandler = createTailStreamHandler({ stateStore, logReader: openLogReader(LOGS_PATH) });
  server = await startIpcServer(SOCKET_PATH, undefined, tailHandler);
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
  rmSync(LOGS_PATH, { force: true });
  try {
    stateStore.close();
  } catch {
    // store may be closed
  }
});

socketTest("replays fixture records through production IPC tail framing", async () => {
  const runId = createRunWithLogs();
  const tail = await connectTuiLogTail(runId, { socketPath: SOCKET_PATH, connectIpcClient });

  const iter = tail.records()[Symbol.asyncIterator]();
  const first = await iter.next();
  const second = await iter.next();

  expect(first.done).toBe(false);
  expect(first.value?.seq).toBe(1);
  expect(first.value?.event.kind).toBe("iteration_started");
  expect(second.done).toBe(false);
  expect(second.value?.seq).toBe(2);
  expect(second.value?.event.kind).toBe("boundary_committed");

  tail.close();
});
