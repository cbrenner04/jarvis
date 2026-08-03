import { describe, expect, test } from "bun:test";
import type { AnyWorkflowStep } from "../execution/workflow-runner.ts";
import type { WriteLoopOutcomeKind } from "../execution/write-loop.ts";
import type { PersistedRecord } from "../persistence/log-stream.ts";
import type { Run, RunStatus, StateStore } from "../persistence/state-store.ts";
import {
  adoptAndSettlePipelineStage,
  dispatchPipelineStage,
  type PipelineWorkflowDispatch,
  type PipelineWorkflowWait,
} from "./pipeline-stage-dispatch.ts";
import type { TerminalLogRecord } from "./run-operator-error.ts";
import { composeRunOperatorError } from "./run-operator-error.ts";

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
    loadPipeline: () => null,
  } as unknown as StateStore;
  return { store, patches };
}

function loopFinished(
  entryRunId: string,
  loopOutcomeKind: WriteLoopOutcomeKind,
  extra: Partial<Extract<TerminalLogRecord["event"], { kind: "loop_finished" }>> = {},
): PersistedRecord {
  return {
    runId: entryRunId,
    seq: 1,
    ts: "2026-01-01T00:00:00.000Z",
    event: { kind: "loop_finished", loopOutcomeKind, iterationsConsumed: 1, resumable: false, ...extra },
  };
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
    expect(linkagePatch?.patch.status).toBe("running");
    expect(patches.some((p) => p.patch.status === "succeeded")).toBe(false);
    expect(patches.some((p) => p.patch.status === "failed")).toBe(false);
    expect(patches.some((p) => p.patch.endedAt !== undefined)).toBe(false);
    // @mutate v2/src/daemon/pipeline-stage-dispatch.ts "const rollupStatus = await wait(dispatched.entryRunId);" -> "store.updateStage({ ...stageTarget, patch: { status: \"failed\", endedAt: Date.now() } }); const rollupStatus = await wait(dispatched.entryRunId);"
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

  test("pre-run dispatch refusal leaves the stage failed and unlinked", async () => {
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
    // @mutate v2/src/daemon/pipeline-stage-dispatch.ts "if (!dispatched.ok) {" -> "if (false) {"
  });

  test("post-admission linkage-write failure preserves the live entry run and settles after recovery", async () => {
    let linkageWrites = 0;
    const dispatch: PipelineWorkflowDispatch = async () => ({
      ok: true,
      entryRunId: "entry-link-fail",
      invocationId: "inv-link-fail",
    });
    const wait: PipelineWorkflowWait = async () => "completed";
    const { store, patches } = fakeStore({
      "entry-link-fail": { specPath: "spec/recover.md", status: "in-progress" },
    });
    const originalUpdateStage = store.updateStage.bind(store);
    store.updateStage = (args) => {
      if (args.patch.workflowInvocationId !== undefined) {
        linkageWrites += 1;
        if (linkageWrites === 1) throw new Error("forced linkage write failure");
      }
      originalUpdateStage(args);
    };

    await dispatchPipelineStage({ pipelineId: "p1", stageId: "s1", steps: [okStep], dispatch, wait, store });
    expect(patches.some((p) => p.patch.status === "failed")).toBe(false);

    await adoptAndSettlePipelineStage({
      store,
      stageTarget: { pipelineId: "p1", stageId: "s1" },
      entryRunId: "entry-link-fail",
      invocationId: "inv-link-fail",
      wait,
    });

    const successPatch = patches.find((p) => p.patch.status === "succeeded");
    expect(successPatch?.patch.artifact).toEqual({
      entryRunId: "entry-link-fail",
      invocationId: "inv-link-fail",
      specPath: "spec/recover.md",
    });
    // @mutate v2/src/daemon/pipeline-stage-dispatch.ts "if (admittedEntryRunId !== undefined && isLiveEntryRun(store, admittedEntryRunId)) {" -> "if (false) {"
  });

  test("post-admission wait rejection preserves the live entry run and settles after recovery", async () => {
    const dispatch: PipelineWorkflowDispatch = async () => ({
      ok: true,
      entryRunId: "entry-wait-fail",
      invocationId: "inv-wait-fail",
    });
    let waitAttempts = 0;
    const wait: PipelineWorkflowWait = async () => {
      waitAttempts += 1;
      if (waitAttempts === 1) throw new Error("forced wait rejection");
      return "completed";
    };
    const { store, patches } = fakeStore({
      "entry-wait-fail": { specPath: "spec/wait-recover.md", status: "in-progress" },
    });

    await dispatchPipelineStage({ pipelineId: "p1", stageId: "s1", steps: [okStep], dispatch, wait, store });
    expect(patches.some((p) => p.patch.status === "failed")).toBe(false);
    expect(patches.find((p) => p.patch.workflowInvocationId === "entry-wait-fail")).toBeDefined();

    await adoptAndSettlePipelineStage({
      store,
      stageTarget: { pipelineId: "p1", stageId: "s1" },
      entryRunId: "entry-wait-fail",
      invocationId: "inv-wait-fail",
      wait,
    });

    const successPatch = patches.find((p) => p.patch.status === "succeeded");
    expect(successPatch?.patch.artifact).toEqual({
      entryRunId: "entry-wait-fail",
      invocationId: "inv-wait-fail",
      specPath: "spec/wait-recover.md",
    });
    // @mutate v2/src/daemon/pipeline-stage-dispatch.ts "if (admittedEntryRunId !== undefined && isLiveEntryRun(store, admittedEntryRunId)) {" -> "if (false) {"
  });

  test("non-success settlement mirrors composeRunOperatorError from terminal log context", async () => {
    const entryRunId = "entry-commit-fail";
    const terminalRecord = loopFinished(entryRunId, "completion_commit_failed", { resumable: true });
    const dispatch: PipelineWorkflowDispatch = async () => ({
      ok: true,
      entryRunId,
      invocationId: "inv-commit-fail",
    });
    const wait: PipelineWorkflowWait = async () => "failed";
    const { store, patches } = fakeStore({
      [entryRunId]: { specPath: "spec/commit-fail.md", status: "failed" },
    });

    await dispatchPipelineStage({
      pipelineId: "p1",
      stageId: "s1",
      steps: [okStep],
      dispatch,
      wait,
      store,
      loadLogRecords: () => [terminalRecord],
    });

    const terminalPatch = patches.find((p) => p.patch.status === "failed");
    const entryRun = store.loadRun(entryRunId);
    if (entryRun === null) throw new Error("expected entry run");
    expect(terminalPatch?.patch.failureDetail).toEqual(
      composeRunOperatorError(entryRun, terminalRecord as TerminalLogRecord),
    );
    expect(terminalPatch?.patch.failureDetail).toEqual({
      reason: "completion_commit_failed",
      nextAction: "resume",
      retryable: true,
    });
    // @mutate v2/src/daemon/pipeline-stage-dispatch.ts "composeRunOperatorError(entryRun, terminalRecord)" -> "composeRunOperatorError(entryRun)"
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

  test("a completed rollup records downstreamInputs from the entry run on the stage artifact", async () => {
    const dispatch: PipelineWorkflowDispatch = async () => ({
      ok: true,
      entryRunId: "entry-multi",
      invocationId: "inv-multi",
    });
    const wait: PipelineWorkflowWait = async () => "completed";
    const { store, patches } = fakeStore({
      "entry-multi": {
        specPath: "ready-intents",
        downstreamInputs: ["ready-intents/one.md", "ready-intents/two.md"],
      },
    });

    await dispatchPipelineStage({ pipelineId: "p1", stageId: "s1", steps: [okStep], dispatch, wait, store });

    const successPatch = patches.find((p) => p.patch.status === "succeeded");
    // Mutation checkpoint: pipeline-stage-dispatch.test.ts multi-file downstreamInputs artifact
    expect(successPatch?.patch.artifact).toEqual({
      entryRunId: "entry-multi",
      invocationId: "inv-multi",
      specPath: "ready-intents",
      downstreamInputs: ["ready-intents/one.md", "ready-intents/two.md"],
    });
  });

  test("a completed rollup omits downstreamInputs when the entry run has a file specPath only", async () => {
    const dispatch: PipelineWorkflowDispatch = async () => ({
      ok: true,
      entryRunId: "entry-single-file",
      invocationId: "inv-single-file",
    });
    const wait: PipelineWorkflowWait = async () => "completed";
    const { store, patches } = fakeStore({
      "entry-single-file": { specPath: "ready-intents/single.md" },
    });

    await dispatchPipelineStage({ pipelineId: "p1", stageId: "s1", steps: [okStep], dispatch, wait, store });

    const successPatch = patches.find((p) => p.patch.status === "succeeded");
    // Mutation checkpoint: pipeline-stage-dispatch.test.ts single-file no downstreamInputs artifact
    expect(successPatch?.patch.artifact).toEqual({
      entryRunId: "entry-single-file",
      invocationId: "inv-single-file",
      specPath: "ready-intents/single.md",
    });
  });
});
