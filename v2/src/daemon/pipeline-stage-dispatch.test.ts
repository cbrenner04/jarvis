import { describe, expect, test } from "bun:test";
import type { AnyWorkflowStep } from "../execution/workflow-runner.ts";
import type { Run, RunStatus, StateStore } from "../persistence/state-store.ts";
import {
  dispatchPipelineStage,
  type PipelineWorkflowDispatch,
  type PipelineWorkflowWait,
} from "./pipeline-stage-dispatch.ts";

const okStep = { behavior: "write" } as unknown as AnyWorkflowStep;

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function fakeStore(runsById: Record<string, Partial<Run>> = {}): {
  store: StateStore;
  patches: Array<{ pipelineId: string; stageId: string; patch: Record<string, unknown> }>;
} {
  const patches: Array<{ pipelineId: string; stageId: string; patch: Record<string, unknown> }> = [];
  const store = {
    updateStage: (args: { pipelineId: string; stageId: string; patch: Record<string, unknown> }) => {
      patches.push(args);
    },
    loadRun: (runId: string) => {
      const run = runsById[runId];
      return run ? ({ id: runId, attempts: [], ...run } as unknown as Run & { attempts: [] }) : null;
    },
  } as unknown as StateStore;
  return { store, patches };
}

describe("dispatchPipelineStage", () => {
  test("records workflowInvocationId before the wait primitive resolves", async () => {
    const dispatch: PipelineWorkflowDispatch = async () => ({
      ok: true,
      entryRunId: "entry-1",
      invocationId: "inv-1",
    });
    const waitDeferred = deferred<RunStatus>();
    let waitCalled = false;
    const wait: PipelineWorkflowWait = async () => {
      waitCalled = true;
      return waitDeferred.promise;
    };
    const { store, patches } = fakeStore({ "entry-1": { specPath: "spec/foo.md" } });

    const donePromise = dispatchPipelineStage({
      pipelineId: "p1",
      stageId: "s1",
      steps: [okStep],
      dispatch,
      wait,
      store,
    });

    while (!waitCalled) {
      await Promise.resolve();
    }

    const linkagePatch = patches.find((p) => p.patch.workflowInvocationId !== undefined);
    expect(linkagePatch?.patch.workflowInvocationId).toBe("entry-1");
    expect(patches.some((p) => p.patch.status === "succeeded")).toBe(false);

    waitDeferred.resolve("completed");
    await donePromise;
  });

  test("a completed rollup records succeeded, endedAt, and an artifact reference", async () => {
    const dispatch: PipelineWorkflowDispatch = async () => ({
      ok: true,
      entryRunId: "entry-2",
      invocationId: "inv-2",
    });
    const wait: PipelineWorkflowWait = async () => "completed";
    const { store, patches } = fakeStore({
      "entry-2": { specPath: "spec/bar.md", prNumber: 42, prUrl: "https://example.com/pr/42" },
    });

    await dispatchPipelineStage({ pipelineId: "p1", stageId: "s1", steps: [okStep], dispatch, wait, store });

    const successPatch = patches.find((p) => p.patch.status === "succeeded");
    expect(successPatch?.patch.endedAt).toBeDefined();
    expect(successPatch?.patch.artifact).toEqual({
      entryRunId: "entry-2",
      invocationId: "inv-2",
      specPath: "spec/bar.md",
      prNumber: 42,
      prUrl: "https://example.com/pr/42",
    });
  });

  test.each([
    "failed",
    "blocked",
    "killed",
    "interrupted",
  ] as const)("a %s rollup records failed, endedAt, and a failure detail with no artifact", async (rollupStatus) => {
    const dispatch: PipelineWorkflowDispatch = async () => ({
      ok: true,
      entryRunId: "entry-3",
      invocationId: "inv-3",
    });
    const wait: PipelineWorkflowWait = async () => rollupStatus;
    const { store, patches } = fakeStore({ "entry-3": { specPath: "spec/baz.md", status: rollupStatus } });

    await dispatchPipelineStage({ pipelineId: "p1", stageId: "s1", steps: [okStep], dispatch, wait, store });

    const terminalPatch = patches.find((p) => p.patch.status !== undefined && p.patch.status !== "running");
    expect(terminalPatch?.patch.status).toBe("failed");
    expect(terminalPatch?.patch.endedAt).toBeDefined();
    expect(terminalPatch?.patch.failureDetail).toBeDefined();
    expect(terminalPatch?.patch.artifact).toBeUndefined();
  });

  test("a dispatch refusal records failed and failureDetail immediately with no linkage ever written", async () => {
    const dispatch: PipelineWorkflowDispatch = async () => ({
      ok: false,
      code: "worktree_claimed",
      message: "already claimed",
    });
    let waitCalled = false;
    const wait: PipelineWorkflowWait = async () => {
      waitCalled = true;
      return "completed";
    };
    const { store, patches } = fakeStore();

    await dispatchPipelineStage({ pipelineId: "p1", stageId: "s1", steps: [okStep], dispatch, wait, store });

    expect(waitCalled).toBe(false);
    expect(patches).toHaveLength(1);
    expect(patches[0]?.patch.status).toBe("failed");
    expect(patches[0]?.patch.failureDetail).toEqual({ code: "worktree_claimed", message: "already claimed" });
    expect(patches[0]?.patch.startedAt).toBeUndefined();
    expect(patches[0]?.patch.workflowInvocationId).toBeUndefined();
  });

  test("a completed rollup without a recorded spec path records failed, not succeeded with an empty artifact", async () => {
    const dispatch: PipelineWorkflowDispatch = async () => ({
      ok: true,
      entryRunId: "entry-missing-spec",
    });
    const wait: PipelineWorkflowWait = async () => "completed";
    const { store, patches } = fakeStore({ "entry-missing-spec": {} });

    await dispatchPipelineStage({ pipelineId: "p1", stageId: "s1", steps: [okStep], dispatch, wait, store });

    const terminalPatch = patches.find((p) => p.patch.status === "failed");
    expect(terminalPatch?.patch.failureDetail).toMatchObject({
      message: expect.stringContaining("without a recorded spec path"),
    });
    expect(patches.some((p) => p.patch.status === "succeeded")).toBe(false);
  });
});
