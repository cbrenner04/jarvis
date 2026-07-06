import { afterEach, beforeEach, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WriteLoopInput } from "../execution/write-loop.ts";
import { connectIpcClient } from "../ipc/client.ts";
import { type IpcServer, startIpcServer } from "../ipc/server.ts";
import { openStateStore, type StateStore, type WorkflowSnapshot } from "../persistence/state-store.ts";
import { canUseUnixSockets } from "../testing/unix-socket.ts";
import { createRunControlHandlers } from "./daemon.ts";

const SOCKET_PATH = join(tmpdir(), `jarvis-daemon-revise-test-${process.pid}.sock`);
const socketTest = test.skipIf(!canUseUnixSockets());

async function flushBackgroundRuns(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

const REPEATED_STEP_ID = "implement";
const HUMAN_STEP_ID = "review";

function workflowSnapshot(maxRevisions: number): WorkflowSnapshot {
  return {
    invocationId: "wf-revise-1",
    steps: [
      { stepId: REPEATED_STEP_ID, role: "implement" },
      { stepId: HUMAN_STEP_ID, role: "", onRevise: { repeatStepId: REPEATED_STEP_ID, maxRevisions } },
    ],
  };
}

let stateStore: StateStore;
let server: IpcServer;
let dirty: boolean;
let starts: WriteLoopInput[];
let holdNextWriteLoop: boolean;

function seedRepeatedAndHumanRuns(maxRevisions: number): { repeatedRunId: string; humanRunId: string } {
  const snapshot = workflowSnapshot(maxRevisions);
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

  return { repeatedRunId, humanRunId };
}

beforeEach(async () => {
  if (!canUseUnixSockets()) {
    return;
  }
  rmSync(SOCKET_PATH, { force: true });
  stateStore = openStateStore(join(tmpdir(), `jarvis-state-revise-${process.pid}-${Date.now()}.db`));
  dirty = true;
  starts = [];
  holdNextWriteLoop = false;

  const { reportReviewDebateProgress: _reportReviewDebateProgress, ...handlers } = createRunControlHandlers({
    stateStore,
    writeLoopExecutor: async (input) => {
      starts.push(input);
      if (holdNextWriteLoop) {
        holdNextWriteLoop = false;
        await new Promise<void>(() => {
          // Never resolves: keeps the worktree claimed for the test's lifetime.
        });
      }
      // Otherwise settle immediately: tests only assert on spawn-time state.
    },
    failureReporter: () => {},
    isWorktreeDirty: () => dirty,
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

socketTest(
  "revise on a dirty worktree spawns the repeated step's write loop under ~r1 and marks revising",
  async () => {
    const client = await connectIpcClient(SOCKET_PATH, 2_000);
    const { humanRunId } = seedRepeatedAndHumanRuns(2);
    dirty = true;

    client.send({ kind: "request", id: "r1", method: "resume", params: { runId: humanRunId, decision: "revise" } });
    const response = await client.nextFrame();
    expect(response.kind).toBe("response");
    if (response.kind === "response") {
      expect((response.result as { stepId?: string })?.stepId).toBe("implement~r1");
    }

    expect(stateStore.loadRun(humanRunId)?.status).toBe("revising");
    const revisionRun = stateStore.findRunByProjectBranch({
      project: "test-project",
      branch: "test-branch",
      stepId: "implement~r1",
    });
    expect(revisionRun).not.toBeNull();
    expect(starts).toHaveLength(1);
    expect(starts[0]?.stepId).toBe("implement~r1");
    client.close();
  },
);

socketTest("revise on a clean worktree with no prompt is rejected revise_requires_input", async () => {
  const client = await connectIpcClient(SOCKET_PATH, 2_000);
  const { humanRunId } = seedRepeatedAndHumanRuns(2);
  dirty = false;

  client.send({ kind: "request", id: "r1", method: "resume", params: { runId: humanRunId, decision: "revise" } });
  const response = await client.nextFrame();
  expect(response.kind).toBe("error");
  if (response.kind === "error") {
    expect(response.code).toBe("revise_requires_input");
  }
  expect(stateStore.loadRun(humanRunId)?.status).toBe("awaiting-human");
  client.close();
});

socketTest("revise on a clean worktree with a prompt succeeds and appends the prompt to stepRules", async () => {
  const client = await connectIpcClient(SOCKET_PATH, 2_000);
  const { humanRunId } = seedRepeatedAndHumanRuns(2);
  dirty = false;

  client.send({
    kind: "request",
    id: "r1",
    method: "resume",
    params: { runId: humanRunId, decision: "revise", prompt: "please fix the edge case" },
  });
  const response = await client.nextFrame();
  expect(response.kind).toBe("response");
  expect(starts).toHaveLength(1);
  expect(starts[0]?.stepRules).toContain("please fix the edge case");
  client.close();
});

socketTest("revise with no onRevise configured is rejected regardless of worktree or prompt", async () => {
  const client = await connectIpcClient(SOCKET_PATH, 2_000);
  const humanRunId = stateStore.createRun({
    project: "test-project",
    specRef: "main",
    worktreePath: "",
    branch: "test-branch",
    specPath: "",
  });
  stateStore.setRunStatus(humanRunId, "awaiting-human");
  dirty = true;

  client.send({
    kind: "request",
    id: "r1",
    method: "resume",
    params: { runId: humanRunId, decision: "revise", prompt: "irrelevant" },
  });
  const response = await client.nextFrame();
  expect(response.kind).toBe("error");
  if (response.kind === "error") {
    expect(response.code).toBe("revise_unsupported");
  }
  client.close();
});

socketTest("a second revise after re-convergence spawns stepId implement~r2", async () => {
  const client = await connectIpcClient(SOCKET_PATH, 2_000);
  const { humanRunId } = seedRepeatedAndHumanRuns(2);
  dirty = true;

  client.send({ kind: "request", id: "r1", method: "resume", params: { runId: humanRunId, decision: "revise" } });
  expect((await client.nextFrame()).kind).toBe("response");
  await flushBackgroundRuns();

  // Simulate executeWorkflow's re-convergence once the ~r1 revision reaches a terminal outcome.
  const firstRevisionRun = stateStore.findRunByProjectBranch({
    project: "test-project",
    branch: "test-branch",
    stepId: "implement~r1",
  });
  if (!firstRevisionRun) throw new Error("expected ~r1 revision run to exist");
  stateStore.setRunStatus(firstRevisionRun.id, "completed");
  stateStore.setRunStatus(humanRunId, "awaiting-human");

  client.send({ kind: "request", id: "r2", method: "resume", params: { runId: humanRunId, decision: "revise" } });
  const secondResponse = await client.nextFrame();
  expect(secondResponse.kind).toBe("response");
  if (secondResponse.kind === "response") {
    expect((secondResponse.result as { stepId?: string })?.stepId).toBe("implement~r2");
  }
  client.close();
});

socketTest("revise is rejected revise_exhausted once maxRevisions is used up", async () => {
  const client = await connectIpcClient(SOCKET_PATH, 2_000);
  const { humanRunId } = seedRepeatedAndHumanRuns(1);
  dirty = true;

  client.send({ kind: "request", id: "r1", method: "resume", params: { runId: humanRunId, decision: "revise" } });
  expect((await client.nextFrame()).kind).toBe("response");

  const firstRevisionRun = stateStore.findRunByProjectBranch({
    project: "test-project",
    branch: "test-branch",
    stepId: "implement~r1",
  });
  if (!firstRevisionRun) throw new Error("expected ~r1 revision run to exist");
  stateStore.setRunStatus(firstRevisionRun.id, "completed");
  stateStore.setRunStatus(humanRunId, "awaiting-human");

  client.send({ kind: "request", id: "r2", method: "resume", params: { runId: humanRunId, decision: "revise" } });
  const response = await client.nextFrame();
  expect(response.kind).toBe("error");
  if (response.kind === "error") {
    expect(response.code).toBe("revise_exhausted");
  }
  client.close();
});

socketTest("revise rejects worktree_claimed when the (project, branch) is already live", async () => {
  const client = await connectIpcClient(SOCKET_PATH, 2_000);
  const { humanRunId } = seedRepeatedAndHumanRuns(2);
  dirty = true;
  holdNextWriteLoop = true;

  client.send({ kind: "request", id: "r1", method: "resume", params: { runId: humanRunId, decision: "revise" } });
  expect((await client.nextFrame()).kind).toBe("response");

  const firstRevisionRun = stateStore.findRunByProjectBranch({
    project: "test-project",
    branch: "test-branch",
    stepId: "implement~r1",
  });
  if (!firstRevisionRun) throw new Error("expected ~r1 revision run to exist");
  stateStore.setRunStatus(firstRevisionRun.id, "completed");
  stateStore.setRunStatus(humanRunId, "awaiting-human");

  client.send({ kind: "request", id: "r2", method: "resume", params: { runId: humanRunId, decision: "revise" } });
  const response = await client.nextFrame();
  expect(response.kind).toBe("error");
  if (response.kind === "error") {
    expect(response.code).toBe("worktree_claimed");
  }
  client.close();
});

socketTest(
  "resume is accepted (not rejected as terminal) once a revising run re-converges to awaiting-human",
  async () => {
    const client = await connectIpcClient(SOCKET_PATH, 2_000);
    const { humanRunId } = seedRepeatedAndHumanRuns(2);
    dirty = true;

    client.send({ kind: "request", id: "r1", method: "resume", params: { runId: humanRunId, decision: "revise" } });
    expect((await client.nextFrame()).kind).toBe("response");
    expect(stateStore.loadRun(humanRunId)?.status).toBe("revising");

    // While revising, resume is rejected rather than silently reinterpreted.
    client.send({ kind: "request", id: "r2", method: "resume", params: { runId: humanRunId } });
    const whileRevising = await client.nextFrame();
    expect(whileRevising.kind).toBe("error");

    // Once re-converged (simulating executeWorkflow's next call), approve is accepted normally.
    stateStore.setRunStatus(humanRunId, "awaiting-human");
    client.send({ kind: "request", id: "r3", method: "resume", params: { runId: humanRunId, decision: "approve" } });
    const afterReconverge = await client.nextFrame();
    expect(afterReconverge.kind).toBe("response");
    expect(stateStore.loadRun(humanRunId)?.status).toBe("completed");
    client.close();
  },
);
