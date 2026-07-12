import { afterEach, beforeEach, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WriteLoopInput } from "../execution/write-loop.ts";
import { openStateStore, type StateStore, type WorkflowSnapshot } from "../persistence/state-store.ts";
import { createRunControlHandlers } from "./daemon.ts";

type Handlers = ReturnType<typeof createRunControlHandlers>;

async function flushBackgroundRuns(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

async function resumeDirect(
  handlers: Handlers,
  id: string,
  params: unknown,
): Promise<Awaited<ReturnType<Handlers["resume"]>>> {
  return handlers.resume({ kind: "request", id, method: "resume", params }, new AbortController().signal);
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
let handlers: Handlers;
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

beforeEach(() => {
  stateStore = openStateStore(join(tmpdir(), `jarvis-state-revise-${process.pid}-${Date.now()}.db`));
  dirty = true;
  starts = [];
  holdNextWriteLoop = false;

  handlers = createRunControlHandlers({
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
    isWorktreeDirty: async () => dirty,
    hasMemoryHeadroom: () => true,
    settleDelayMs: 0,
  });
});

afterEach(() => {
  try {
    stateStore.close();
  } catch {
    // store may be closed
  }
});

test("revise on a dirty worktree spawns the repeated step's write loop under ~r1 and marks revising", async () => {
  const { humanRunId } = seedRepeatedAndHumanRuns(2);
  dirty = true;

  const response = await resumeDirect(handlers, "r1", { runId: humanRunId, decision: "revise" });
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
});

test("revise on a clean worktree with no prompt is rejected revise_requires_input", async () => {
  const { humanRunId } = seedRepeatedAndHumanRuns(2);
  dirty = false;

  const response = await resumeDirect(handlers, "r1", { runId: humanRunId, decision: "revise" });
  expect(response.kind).toBe("error");
  if (response.kind === "error") {
    expect(response.code).toBe("revise_requires_input");
  }
  expect(stateStore.loadRun(humanRunId)?.status).toBe("awaiting-human");
});

test("revise on a clean worktree with a prompt succeeds and appends the prompt to stepRules", async () => {
  const { humanRunId } = seedRepeatedAndHumanRuns(2);
  dirty = false;

  const response = await resumeDirect(handlers, "r1", {
    runId: humanRunId,
    decision: "revise",
    prompt: "please fix the edge case",
  });
  expect(response.kind).toBe("response");
  expect(starts).toHaveLength(1);
  expect(starts[0]?.stepRules).toContain("please fix the edge case");
});

test("revise with no onRevise configured is rejected regardless of worktree or prompt", async () => {
  const humanRunId = stateStore.createRun({
    project: "test-project",
    specRef: "main",
    worktreePath: "",
    branch: "test-branch",
    specPath: "",
  });
  stateStore.setRunStatus(humanRunId, "awaiting-human");
  dirty = true;

  const response = await resumeDirect(handlers, "r1", {
    runId: humanRunId,
    decision: "revise",
    prompt: "irrelevant",
  });
  expect(response.kind).toBe("error");
  if (response.kind === "error") {
    expect(response.code).toBe("revise_unsupported");
  }
});

test("a second revise after re-convergence spawns stepId implement~r2", async () => {
  const { humanRunId } = seedRepeatedAndHumanRuns(2);
  dirty = true;

  expect((await resumeDirect(handlers, "r1", { runId: humanRunId, decision: "revise" })).kind).toBe("response");
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

  const secondResponse = await resumeDirect(handlers, "r2", { runId: humanRunId, decision: "revise" });
  expect(secondResponse.kind).toBe("response");
  if (secondResponse.kind === "response") {
    expect((secondResponse.result as { stepId?: string })?.stepId).toBe("implement~r2");
  }
});

test("revise is rejected revise_exhausted once maxRevisions is used up", async () => {
  const { humanRunId } = seedRepeatedAndHumanRuns(1);
  dirty = true;

  expect((await resumeDirect(handlers, "r1", { runId: humanRunId, decision: "revise" })).kind).toBe("response");

  const firstRevisionRun = stateStore.findRunByProjectBranch({
    project: "test-project",
    branch: "test-branch",
    stepId: "implement~r1",
  });
  if (!firstRevisionRun) throw new Error("expected ~r1 revision run to exist");
  stateStore.setRunStatus(firstRevisionRun.id, "completed");
  stateStore.setRunStatus(humanRunId, "awaiting-human");

  const response = await resumeDirect(handlers, "r2", { runId: humanRunId, decision: "revise" });
  expect(response.kind).toBe("error");
  if (response.kind === "error") {
    expect(response.code).toBe("revise_exhausted");
  }
});

test("revise rejects worktree_claimed when the (project, branch) is already live", async () => {
  const { humanRunId } = seedRepeatedAndHumanRuns(2);
  dirty = true;
  holdNextWriteLoop = true;

  expect((await resumeDirect(handlers, "r1", { runId: humanRunId, decision: "revise" })).kind).toBe("response");

  const firstRevisionRun = stateStore.findRunByProjectBranch({
    project: "test-project",
    branch: "test-branch",
    stepId: "implement~r1",
  });
  if (!firstRevisionRun) throw new Error("expected ~r1 revision run to exist");
  stateStore.setRunStatus(firstRevisionRun.id, "completed");
  stateStore.setRunStatus(humanRunId, "awaiting-human");

  const response = await resumeDirect(handlers, "r2", { runId: humanRunId, decision: "revise" });
  expect(response.kind).toBe("error");
  if (response.kind === "error") {
    expect(response.code).toBe("worktree_claimed");
  }
});

test("resume is accepted (not rejected as terminal) once a revising run re-converges to awaiting-human", async () => {
  const { humanRunId } = seedRepeatedAndHumanRuns(2);
  dirty = true;

  expect((await resumeDirect(handlers, "r1", { runId: humanRunId, decision: "revise" })).kind).toBe("response");
  expect(stateStore.loadRun(humanRunId)?.status).toBe("revising");

  // While revising, resume is rejected rather than silently reinterpreted.
  const whileRevising = await resumeDirect(handlers, "r2", { runId: humanRunId });
  expect(whileRevising.kind).toBe("error");

  // Once re-converged (simulating executeWorkflow's next call), approve is accepted normally.
  stateStore.setRunStatus(humanRunId, "awaiting-human");
  const afterReconverge = await resumeDirect(handlers, "r3", { runId: humanRunId, decision: "approve" });
  expect(afterReconverge.kind).toBe("response");
  expect(stateStore.loadRun(humanRunId)?.status).toBe("completed");
});
