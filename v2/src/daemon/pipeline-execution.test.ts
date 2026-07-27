import { describe, expect, test } from "bun:test";
import type { PipelineDefinition } from "../execution/pipeline-definition.ts";
import type { AnyWorkflowStep } from "../execution/workflow-runner.ts";
import type { Pipeline, PipelineStageRecord, Run, RunStatus, StateStore } from "../persistence/state-store.ts";
import { derivePipelineState, runPipeline } from "./pipeline-execution.ts";
import type { PipelineWorkflowDispatch, PipelineWorkflowWait } from "./pipeline-stage-dispatch.ts";
import type {
  PipelineContext,
  PipelineStageResolutionResult,
  PipelineStageResolveDeps,
} from "./pipeline-stage-resolve.ts";

const PIPELINE_ID = "pipeline-1";
const baseContext: PipelineContext = { cwd: "/repo", seed: "seed text" };

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/** A tagged step so a fake `dispatch`/`resolveStage` can tell which stage index it built. */
function taggedStep(stageIndex: number): AnyWorkflowStep {
  return { behavior: "write", stageIndex } as unknown as AnyWorkflowStep;
}

function stageIndexOf(steps: AnyWorkflowStep[]): number {
  return (steps[0] as unknown as { stageIndex: number }).stageIndex;
}

function fakeStore(
  definition: PipelineDefinition,
  runs: Record<string, Partial<Run>> = {},
): { store: StateStore; stages: () => PipelineStageRecord[] } {
  const stages: PipelineStageRecord[] = definition.stages.map((stage, index) => ({
    id: `row-${index}`,
    pipelineId: PIPELINE_ID,
    stageId: stage.stageId,
    position: index,
    status: "pending",
    workflowInvocationId: null,
    startedAt: null,
    endedAt: null,
    artifact: null,
    failureDetail: null,
  }));

  const store = {
    loadPipeline: (id: string) =>
      id === PIPELINE_ID
        ? ({
            id: PIPELINE_ID,
            name: definition.name,
            createdAt: 0,
            definition,
            stages: stages.map((s) => ({ ...s })),
          } as Pipeline & {
            stages: PipelineStageRecord[];
          })
        : null,
    updateStage: (args: { stageId: string; patch: Record<string, unknown> }) => {
      const record = stages.find((s) => s.stageId === args.stageId);
      if (!record) throw new Error(`unknown stage ${args.stageId}`);
      Object.assign(record, args.patch);
    },
    loadRun: (runId: string) => {
      const run = runs[runId];
      return run ? ({ id: runId, attempts: [], ...run } as unknown as Run & { attempts: [] }) : null;
    },
  } as unknown as StateStore;

  return { store, stages: () => stages };
}

function resolveStageStub(): (
  definition: PipelineDefinition,
  stageIndex: number,
  context: PipelineContext,
  artifactSpecPaths: ReadonlyMap<string, string>,
  deps?: PipelineStageResolveDeps,
) => Promise<PipelineStageResolutionResult> {
  return async (_definition, stageIndex) => ({ ok: true, steps: [taggedStep(stageIndex)] });
}

describe("runPipeline", () => {
  test("dispatches workflow stages in authored order, only after the preceding stage succeeds", async () => {
    const definition: PipelineDefinition = {
      name: "p",
      stages: [
        { stageId: "s1", kind: "workflow", workflow: "intent", review: "none" },
        { stageId: "s2", kind: "workflow", workflow: "plan", review: "none" },
      ],
    };
    const { store, stages } = fakeStore(definition, {
      "run-0": { specPath: "spec/s1.md" },
      "run-1": { specPath: "spec/s2.md" },
    });

    const dispatchOrder: number[] = [];
    const stage0Wait = deferred<RunStatus>();
    let stage0WaitCalled = false;
    const dispatch: PipelineWorkflowDispatch = async (steps) => {
      const index = stageIndexOf(steps);
      dispatchOrder.push(index);
      return { ok: true, entryRunId: `run-${index}`, invocationId: `inv-${index}` };
    };
    const wait: PipelineWorkflowWait = async (entryRunId) => {
      if (entryRunId === "run-0") {
        stage0WaitCalled = true;
        return stage0Wait.promise;
      }
      return "completed";
    };

    const donePromise = runPipeline(PIPELINE_ID, {
      store,
      dispatch,
      wait,
      context: baseContext,
      resolveStage: resolveStageStub(),
    });

    while (!stage0WaitCalled) {
      await Promise.resolve();
    }

    expect(dispatchOrder).toEqual([0]);
    expect(stages().find((s) => s.stageId === "s2")?.status).toBe("pending");

    stage0Wait.resolve("completed");
    await donePromise;

    expect(dispatchOrder).toEqual([0, 1]);
    expect(stages().map((s) => s.status)).toEqual(["succeeded", "succeeded"]);
  });

  test("a stage that settles failed settles the pipeline failed and skips every later stage undispatched", async () => {
    const definition: PipelineDefinition = {
      name: "p",
      stages: [
        { stageId: "s1", kind: "workflow", workflow: "intent", review: "none" },
        { stageId: "s2", kind: "workflow", workflow: "plan", review: "none" },
        { stageId: "s3", kind: "workflow", workflow: "implement", review: "light" },
      ],
    };
    const { store, stages } = fakeStore(definition, { "run-0": { specPath: "spec/s1.md" } });

    const dispatchOrder: number[] = [];
    const dispatch: PipelineWorkflowDispatch = async (steps) => {
      const index = stageIndexOf(steps);
      dispatchOrder.push(index);
      if (index === 1) {
        return { ok: false, code: "worktree_claimed", message: "claimed" };
      }
      return { ok: true, entryRunId: `run-${index}`, invocationId: `inv-${index}` };
    };
    const wait: PipelineWorkflowWait = async () => "completed";

    await runPipeline(PIPELINE_ID, { store, dispatch, wait, context: baseContext, resolveStage: resolveStageStub() });

    expect(dispatchOrder).toEqual([0, 1]);
    const byId = new Map(stages().map((s) => [s.stageId, s]));
    expect(byId.get("s1")?.status).toBe("succeeded");
    expect(byId.get("s2")?.status).toBe("failed");
    expect(byId.get("s3")?.status).toBe("skipped");
  });

  test("a pipeline whose next stage is an approval stage stops there: no dispatch, later stages pending", async () => {
    const definition: PipelineDefinition = {
      name: "p",
      stages: [
        { stageId: "s1", kind: "workflow", workflow: "intent", review: "none" },
        { stageId: "gate", kind: "approval" },
        { stageId: "s3", kind: "workflow", workflow: "plan", review: "none" },
      ],
    };
    const { store, stages } = fakeStore(definition, { "run-0": { specPath: "spec/s1.md" } });

    const dispatchOrder: number[] = [];
    const dispatch: PipelineWorkflowDispatch = async (steps) => {
      const index = stageIndexOf(steps);
      dispatchOrder.push(index);
      return { ok: true, entryRunId: `run-${index}`, invocationId: `inv-${index}` };
    };
    const wait: PipelineWorkflowWait = async () => "completed";

    await runPipeline(PIPELINE_ID, { store, dispatch, wait, context: baseContext, resolveStage: resolveStageStub() });

    expect(dispatchOrder).toEqual([0]);
    const byId = new Map(stages().map((s) => [s.stageId, s]));
    expect(byId.get("s1")?.status).toBe("succeeded");
    expect(byId.get("gate")?.status).toBe("pending");
    expect(byId.get("s3")?.status).toBe("pending");

    const pipeline = store.loadPipeline(PIPELINE_ID);
    if (!pipeline) throw new Error("expected pipeline");
    expect(derivePipelineState(pipeline)).toBe("awaiting-approval");
  });
});

describe("derivePipelineState", () => {
  const definition: PipelineDefinition = {
    name: "p",
    stages: [
      { stageId: "s1", kind: "workflow", workflow: "intent", review: "none" },
      { stageId: "s2", kind: "workflow", workflow: "plan", review: "none" },
    ],
  };

  function pipelineWith(statuses: Record<string, string>): Pipeline & { stages: PipelineStageRecord[] } {
    return {
      id: PIPELINE_ID,
      name: definition.name,
      createdAt: 0,
      ownerIdentity: null,
      status: "active",
      definition,
      stages: definition.stages.map((stage, index) => ({
        id: `row-${index}`,
        pipelineId: PIPELINE_ID,
        stageId: stage.stageId,
        position: index,
        status: statuses[stage.stageId] ?? "pending",
        workflowInvocationId: null,
        startedAt: null,
        endedAt: null,
        artifact: null,
        failureDetail: null,
      })),
    };
  }

  test("reports succeeded only once every authored stage in order has succeeded, including no pending approval gate", () => {
    expect(derivePipelineState(pipelineWith({ s1: "succeeded", s2: "pending" }))).toBe("pending");
    expect(derivePipelineState(pipelineWith({ s1: "succeeded", s2: "succeeded" }))).toBe("succeeded");
  });

  test("reports awaiting-approval when every workflow stage succeeded and the next stage is an undispatched approval gate", () => {
    const definition: PipelineDefinition = {
      name: "p",
      stages: [
        { stageId: "s1", kind: "workflow", workflow: "intent", review: "none" },
        { stageId: "gate", kind: "approval" },
      ],
    };
    const pipeline: Pipeline & { stages: PipelineStageRecord[] } = {
      id: PIPELINE_ID,
      name: definition.name,
      createdAt: 0,
      ownerIdentity: null,
      status: "active",
      definition,
      stages: definition.stages.map((stage, index) => ({
        id: `row-${index}`,
        pipelineId: PIPELINE_ID,
        stageId: stage.stageId,
        position: index,
        status: stage.stageId === "s1" ? "succeeded" : "pending",
        workflowInvocationId: null,
        startedAt: null,
        endedAt: null,
        artifact: null,
        failureDetail: null,
      })),
    };
    expect(derivePipelineState(pipeline)).toBe("awaiting-approval");
  });

  test("reports failed when any workflow stage row reads failed", () => {
    expect(derivePipelineState(pipelineWith({ s1: "succeeded", s2: "failed" }))).toBe("failed");
  });

  test("reports running when any workflow stage row reads running", () => {
    expect(derivePipelineState(pipelineWith({ s1: "succeeded", s2: "running" }))).toBe("running");
  });

  test("reports pending when the loop has not yet reached a dispatchable stage", () => {
    expect(derivePipelineState(pipelineWith({}))).toBe("pending");
  });
});
