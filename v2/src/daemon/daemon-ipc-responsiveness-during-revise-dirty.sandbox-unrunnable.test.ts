// Proves daemon IPC stays responsive while a revise dirty-worktree probe is pending.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connectIpcClient } from "../ipc/client.ts";
import { startIpcServer } from "../ipc/server.ts";
import { openStateStore, type StateStore, type WorkflowSnapshot } from "../persistence/state-store.ts";
import { toIpcHandlers } from "../testing/run-control.ts";
import { canUseUnixSockets } from "../testing/unix-socket.ts";
import { createRunControlHandlers } from "./daemon.ts";

const socketTest = test.skipIf(!canUseUnixSockets());

const REPEATED_STEP_ID = "implement";
const HUMAN_STEP_ID = "review";

function workflowSnapshot(maxRevisions: number): WorkflowSnapshot {
  return {
    invocationId: "wf-revise-ipc-1",
    steps: [
      { stepId: REPEATED_STEP_ID, role: "implement" },
      { stepId: HUMAN_STEP_ID, role: "", onRevise: { repeatStepId: REPEATED_STEP_ID, maxRevisions } },
    ],
  };
}

function uniqueSocketPath(suffix: string): string {
  return join(tmpdir(), `jarvis-daemon-revise-dirty-${process.pid}-${suffix}.sock`);
}

let stateStore: StateStore;
let dbPath: string;

beforeEach(() => {
  if (!canUseUnixSockets()) {
    return;
  }
  dbPath = join(tmpdir(), `jarvis-revise-dirty-ipc-${process.pid}-${Date.now()}.db`);
  stateStore = openStateStore(dbPath);
});

afterEach(async () => {
  if (!canUseUnixSockets()) {
    return;
  }
  await new Promise<void>((resolve) => setImmediate(resolve));
  try {
    stateStore.close();
  } catch {
    // store may be closed
  }
  rmSync(dbPath, { force: true });
});

socketTest("health completes before held revise dirty-worktree probe releases", async () => {
  const snapshot = workflowSnapshot(2);
  const repeatedRunId = stateStore.createRun({
    project: "test-project",
    specRef: "main",
    worktreePath: "/tmp/test-project-worktree",
    branch: "test-branch",
    specPath: "/tmp/test-project/spec.md",
    stepId: REPEATED_STEP_ID,
    workflowSnapshot: snapshot,
  });
  stateStore.setRunStatus(repeatedRunId, "completed");

  const humanRunId = stateStore.createRun({
    project: "test-project",
    specRef: "main",
    worktreePath: "",
    branch: "test-branch",
    specPath: "",
    stepId: HUMAN_STEP_ID,
    workflowSnapshot: snapshot,
  });
  stateStore.setRunStatus(humanRunId, "awaiting-human");

  let releaseProbe: (() => void) | undefined;
  const probeHeld = new Promise<void>((resolve) => {
    releaseProbe = resolve;
  });

  const handlers = createRunControlHandlers({
    stateStore,
    writeLoopExecutor: async () => undefined,
    failureReporter: () => {},
    isWorktreeDirty: async () => {
      await probeHeld;
      return true;
    },
    hasMemoryHeadroom: () => true,
    settleDelayMs: 0,
  });

  const socketPath = uniqueSocketPath("responsive-revise-dirty");
  rmSync(socketPath, { force: true });
  const server = await startIpcServer(socketPath, {
    health: () => ({ kind: "response", result: { ok: true } }),
    ...toIpcHandlers(handlers),
  });
  try {
    const reviseClient = await connectIpcClient(socketPath, 2_000);
    const healthClient = await connectIpcClient(socketPath, 2_000);

    reviseClient.send({
      kind: "request",
      id: "rev1",
      method: "resume",
      params: { runId: humanRunId, decision: "revise" },
    });

    await new Promise<void>((resolve) => setImmediate(resolve));
    healthClient.send({ kind: "request", id: "h1", method: "health" });
    const healthFrame = await healthClient.nextFrame();
    expect(healthFrame).toEqual({ kind: "response", id: "h1", result: { ok: true } });

    releaseProbe?.();

    const reviseFrame = await reviseClient.nextFrame();
    expect(reviseFrame.kind).toBe("response");
    if (reviseFrame.kind === "response") {
      expect((reviseFrame.result as { stepId?: string })?.stepId).toBe("implement~r1");
    }

    reviseClient.close();
    healthClient.close();
  } finally {
    await server.close();
    rmSync(socketPath, { force: true });
  }
});
