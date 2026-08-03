import { describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PipelineDefinition } from "../execution/pipeline-definition.ts";
import type { AnyWorkflowStep } from "../execution/workflow-runner.ts";
import { openStateStore, type Run, type RunStatus, type StateStore } from "../persistence/state-store.ts";
import {
  adoptAndSettlePipelineStage,
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
  admissions: Array<{ runId: string; admission: Record<string, unknown> }>;
} {
  const patches: Array<{ pipelineId: string; stageId: string; patch: Record<string, unknown> }> = [];
  const admissions: Array<{ runId: string; admission: Record<string, unknown> }> = [];
  const admissionsByRun = new Map<string, Record<string, unknown>>();
  const store = {
    updateStage: (args: { pipelineId: string; stageId: string; patch: Record<string, unknown> }) => {
      patches.push(args);
    },
    loadRun: (runId: string) => {
      const run = runsById[runId];
      return run ? ({ id: runId, attempts: [], ...run } as unknown as Run & { attempts: [] }) : null;
    },
    setPipelineStageAdmission: (runId: string, admission: Record<string, unknown>) => {
      admissions.push({ runId, admission });
      admissionsByRun.set(runId, admission);
    },
    clearPipelineStageAdmission: (runId: string) => {
      admissionsByRun.delete(runId);
    },
    loadPipeline: (pipelineId: string) => {
      const stages = new Map<string, Record<string, unknown>>();
      for (const patch of patches) {
        if (patch.pipelineId !== pipelineId) continue;
        const branchKey = (patch as { branchKey?: string }).branchKey ?? "default";
        const key = `${patch.stageId}::${branchKey}`;
        stages.set(key, { stageId: patch.stageId, branchKey, ...(stages.get(key) ?? {}), ...patch.patch });
      }
      return { stages: [...stages.values()] } as unknown as ReturnType<StateStore["loadPipeline"]>;
    },
    findAdmittedEntryRunForStage: (args: Record<string, unknown>) => {
      for (const [runId, admission] of admissionsByRun.entries()) {
        if (
          admission.pipelineId === args.pipelineId &&
          admission.stageId === args.stageId &&
          admission.branchKey === args.branchKey
        ) {
          const run = runsById[runId];
          if (run) return { id: runId, attempts: [], ...run } as unknown as Run & { attempts: [] };
        }
      }
      return null;
    },
  } as unknown as StateStore;
  return { store, patches, admissions };
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
    // @mutate v2/src/daemon/pipeline-stage-dispatch.ts "store.setPipelineStageAdmission(dispatched.entryRunId, stageTargetKey(stageTarget));" -> ""
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
    const store = openStateStore(
      join(tmpdir(), `jarvis-pre-admission-refusal-${process.pid}-${Date.now()}-${Math.random()}.db`),
    );
    const definition: PipelineDefinition = {
      name: "pre-admission",
      stages: [{ stageId: "s1", kind: "workflow", workflow: "intent", review: "none" }],
    };
    const pipelineId = store.createPipeline({ definition, context: { cwd: "/repo", seed: "seed" } });
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

    await dispatchPipelineStage({
      pipelineId,
      stageId: "s1",
      steps: [okStep],
      dispatch,
      wait,
      store,
    });

    expect(waitCalled).toBe(false);
    const stage = store.loadPipeline(pipelineId)?.stages.find((row) => row.stageId === "s1");
    expect(stage?.status).toBe("failed");
    expect(stage?.startedAt).toBeNull();
    expect(stage?.workflowInvocationId).toBeNull();
    // @mutate v2/src/daemon/pipeline-stage-dispatch.ts "if (!dispatched.ok) {" -> "if (false) {"
    store.close();
  });

  test("post-admission linkage-write failure preserves the live entry run and settles after recovery", async () => {
    let linkageWrites = 0;
    const dispatch: PipelineWorkflowDispatch = async () => ({
      ok: true,
      entryRunId: "entry-link-fail",
      invocationId: "inv-link-fail",
    });
    const wait: PipelineWorkflowWait = async () => "completed";
    const { store, patches, admissions } = fakeStore({
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
    expect(admissions).toHaveLength(1);

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
