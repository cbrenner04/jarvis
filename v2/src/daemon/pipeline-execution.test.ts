import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PipelineDefinition } from "../execution/pipeline-definition.ts";
import type { AnyWorkflowStep } from "../execution/workflow-runner.ts";
import type { Pipeline, PipelineStageRecord, Run, RunStatus, StateStore } from "../persistence/state-store.ts";
import { openStateStore } from "../persistence/state-store.ts";
import { removeOrchestrationStore } from "../persistence/state-store-on-disk.ts";
import {
  approvalGateBlocksProgress,
  approvalGatePermitsProgress,
  approvalGateSettlesRejected,
  approvalOutcomeBlocksActivation,
  approvalOutcomePermitsActivation,
  continuePipeline,
  derivePipelineState,
  isPipelineContinuable,
  persistedContextLoadPermitsContinuation,
  recoverContinuablePipelines,
  reopenedFailurePermitsActivation,
  runPipeline,
} from "./pipeline-execution.ts";
import type { PipelineWorkflowDispatch, PipelineWorkflowWait } from "./pipeline-stage-dispatch.ts";
import type {
  PipelineContext,
  PipelineStageResolutionResult,
  PipelineStageResolveDeps,
} from "./pipeline-stage-resolve.ts";

const PIPELINE_ID = "pipeline-1";
const baseContext: PipelineContext = { cwd: "/repo", seed: "seed text" };
const persistedContext: PipelineContext = { cwd: "/persisted-repo", seed: "persisted seed" };
const PRIOR_OWNER = "11111:1000000";
const CURRENT_OWNER = "22222:2000000";

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
  options: {
    context?: PipelineContext | null;
    ownerIdentity?: string | null;
    currentIdentity?: string;
  } = {},
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

  let ownerIdentity = options.ownerIdentity ?? options.currentIdentity ?? CURRENT_OWNER;
  const pipelineContext = options.context === undefined ? baseContext : options.context;
  const currentIdentity = options.currentIdentity ?? CURRENT_OWNER;

  const store = {
    loadPipeline: (id: string) =>
      id === PIPELINE_ID
        ? ({
            id: PIPELINE_ID,
            name: definition.name,
            createdAt: 0,
            ownerIdentity,
            status: "active",
            definition,
            context: pipelineContext,
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
    claimPipelineContinuation: (args: { pipelineId: string; priorOwnerIdentity: string | null }) => {
      if (args.pipelineId !== PIPELINE_ID) {
        return { kind: "refused" as const, pipelineId: args.pipelineId, reason: "pipeline_not_found" as const };
      }
      if (ownerIdentity !== args.priorOwnerIdentity) {
        return { kind: "refused" as const, pipelineId: args.pipelineId, reason: "stale_owner" as const };
      }
      if (ownerIdentity === currentIdentity) {
        return { kind: "applied" as const, pipelineId: args.pipelineId };
      }
      ownerIdentity = currentIdentity;
      return { kind: "applied" as const, pipelineId: args.pipelineId };
    },
    commitApprovalBoundary: (args: { stageRecordId: string }) => {
      const record = stages.find((s) => s.id === args.stageRecordId);
      if (!record) {
        return { kind: "refused" as const, stageRecordId: args.stageRecordId, reason: "stage_not_found" as const };
      }
      const authored = definition.stages[record.position];
      if (authored?.kind !== "approval") {
        return { kind: "refused" as const, stageRecordId: args.stageRecordId, reason: "not_approval_stage" as const };
      }
      if (record.status !== "pending") {
        return { kind: "refused" as const, stageRecordId: args.stageRecordId, reason: "status_not_pending" as const };
      }
      record.status = "awaiting";
      return { kind: "applied" as const, stageRecordId: args.stageRecordId };
    },
    loadRun: (runId: string) => {
      const run = runs[runId];
      return run ? ({ id: runId, attempts: [], ...run } as unknown as Run & { attempts: [] }) : null;
    },
    listPipelines: () => {
      const pipeline = store.loadPipeline(PIPELINE_ID);
      return pipeline ? [pipeline] : [];
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

  test("a pipeline whose next stage is an approval stage persists awaiting and leaves later stages pending", async () => {
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
    expect(byId.get("gate")?.status).toBe("awaiting");
    expect(byId.get("gate")?.id).toBe("row-1");
    expect(byId.get("s3")?.status).toBe("pending");

    const pipeline = store.loadPipeline(PIPELINE_ID);
    if (!pipeline) throw new Error("expected pipeline");
    expect(derivePipelineState(pipeline)).toBe("awaiting-approval");
  });

  test("continues past an approved gate and dispatches the next workflow stage", async () => {
    const definition: PipelineDefinition = {
      name: "p",
      stages: [
        { stageId: "s1", kind: "workflow", workflow: "intent", review: "none" },
        { stageId: "gate", kind: "approval" },
        { stageId: "s3", kind: "workflow", workflow: "plan", review: "none" },
      ],
    };
    const { store, stages } = fakeStore(definition, {
      "run-0": { specPath: "spec/s1.md" },
      "run-2": { specPath: "spec/s3.md" },
    });
    store.updateStage({ pipelineId: PIPELINE_ID, stageId: "gate", patch: { status: "approved" } });

    const dispatchOrder: number[] = [];
    const dispatch: PipelineWorkflowDispatch = async (steps) => {
      dispatchOrder.push(stageIndexOf(steps));
      return { ok: true, entryRunId: `run-${stageIndexOf(steps)}`, invocationId: `inv-${stageIndexOf(steps)}` };
    };
    const wait: PipelineWorkflowWait = async () => "completed";

    await runPipeline(PIPELINE_ID, { store, dispatch, wait, context: baseContext, resolveStage: resolveStageStub() });

    expect(dispatchOrder).toEqual([0, 2]);
    const byId = new Map(stages().map((s) => [s.stageId, s]));
    expect(byId.get("gate")?.status).toBe("approved");
    expect(byId.get("s3")?.status).toBe("succeeded");
  });

  test("stops at a rejected gate without dispatching later stages", async () => {
    const definition: PipelineDefinition = {
      name: "p",
      stages: [
        { stageId: "s1", kind: "workflow", workflow: "intent", review: "none" },
        { stageId: "gate", kind: "approval" },
        { stageId: "s3", kind: "workflow", workflow: "plan", review: "none" },
      ],
    };
    const { store, stages } = fakeStore(definition, { "run-0": { specPath: "spec/s1.md" } });
    store.updateStage({ pipelineId: PIPELINE_ID, stageId: "gate", patch: { status: "rejected" } });

    const dispatchOrder: number[] = [];
    const dispatch: PipelineWorkflowDispatch = async (steps) => {
      dispatchOrder.push(stageIndexOf(steps));
      return { ok: true, entryRunId: `run-${stageIndexOf(steps)}`, invocationId: `inv-${stageIndexOf(steps)}` };
    };
    const wait: PipelineWorkflowWait = async () => "completed";

    await runPipeline(PIPELINE_ID, { store, dispatch, wait, context: baseContext, resolveStage: resolveStageStub() });

    expect(dispatchOrder).toEqual([0]);
    const byId = new Map(stages().map((s) => [s.stageId, s]));
    expect(byId.get("gate")?.status).toBe("rejected");
    expect(byId.get("s3")?.status).toBe("pending");
    const pipeline = store.loadPipeline(PIPELINE_ID);
    if (!pipeline) throw new Error("expected pipeline");
    expect(derivePipelineState(pipeline)).toBe("rejected");
  });

  test("blocks at an already-awaiting gate without rewriting its row", async () => {
    const definition: PipelineDefinition = {
      name: "p",
      stages: [
        { stageId: "s1", kind: "workflow", workflow: "intent", review: "none" },
        { stageId: "gate", kind: "approval" },
        { stageId: "s3", kind: "workflow", workflow: "plan", review: "none" },
      ],
    };
    const { store, stages } = fakeStore(definition, { "run-0": { specPath: "spec/s1.md" } });
    store.updateStage({ pipelineId: PIPELINE_ID, stageId: "gate", patch: { status: "awaiting" } });

    let boundaryCalls = 0;
    const instrumentedStore = {
      ...store,
      commitApprovalBoundary: (args: { stageRecordId: string }) => {
        boundaryCalls += 1;
        return store.commitApprovalBoundary(args);
      },
    };

    const dispatch: PipelineWorkflowDispatch = async () => ({
      ok: true,
      entryRunId: "run-0",
      invocationId: "inv-0",
    });
    const wait: PipelineWorkflowWait = async () => "completed";

    await runPipeline(PIPELINE_ID, {
      store: instrumentedStore,
      dispatch,
      wait,
      context: baseContext,
      resolveStage: resolveStageStub(),
    });

    expect(boundaryCalls).toBe(0);
    expect(stages().find((s) => s.stageId === "gate")?.status).toBe("awaiting");
    expect(stages().find((s) => s.stageId === "s3")?.status).toBe("pending");
  });

  test("a refused boundary write reloads the addressed row and blocks at awaiting without dispatching the suffix", async () => {
    const definition: PipelineDefinition = {
      name: "p",
      stages: [
        { stageId: "s1", kind: "workflow", workflow: "intent", review: "none" },
        { stageId: "gate", kind: "approval" },
        { stageId: "s3", kind: "workflow", workflow: "plan", review: "none" },
      ],
    };
    const { store, stages } = fakeStore(definition, { "run-0": { specPath: "spec/s1.md" } });

    const racingStore = {
      ...store,
      commitApprovalBoundary: (args: { stageRecordId: string }) => {
        store.updateStage({ pipelineId: PIPELINE_ID, stageId: "gate", patch: { status: "awaiting" } });
        return { kind: "refused" as const, stageRecordId: args.stageRecordId, reason: "status_not_pending" as const };
      },
    };

    const dispatchOrder: number[] = [];
    const dispatch: PipelineWorkflowDispatch = async (steps) => {
      dispatchOrder.push(stageIndexOf(steps));
      return { ok: true, entryRunId: `run-${stageIndexOf(steps)}`, invocationId: `inv-${stageIndexOf(steps)}` };
    };
    const wait: PipelineWorkflowWait = async () => "completed";

    await runPipeline(PIPELINE_ID, {
      store: racingStore,
      dispatch,
      wait,
      context: baseContext,
      resolveStage: resolveStageStub(),
    });

    expect(dispatchOrder).toEqual([0]);
    expect(stages().find((s) => s.stageId === "gate")?.status).toBe("awaiting");
    expect(stages().find((s) => s.stageId === "s3")?.status).toBe("pending");
  });

  test("a refused boundary write with an unexpected status settles failed without skipping the suffix", async () => {
    const definition: PipelineDefinition = {
      name: "p",
      stages: [
        { stageId: "s1", kind: "workflow", workflow: "intent", review: "none" },
        { stageId: "gate", kind: "approval" },
        { stageId: "s3", kind: "workflow", workflow: "plan", review: "none" },
      ],
    };
    const { store, stages } = fakeStore(definition, { "run-0": { specPath: "spec/s1.md" } });
    store.updateStage({ pipelineId: PIPELINE_ID, stageId: "gate", patch: { status: "running" } });

    const dispatchOrder: number[] = [];
    const dispatch: PipelineWorkflowDispatch = async (steps) => {
      dispatchOrder.push(stageIndexOf(steps));
      return { ok: true, entryRunId: `run-${stageIndexOf(steps)}`, invocationId: `inv-${stageIndexOf(steps)}` };
    };
    const wait: PipelineWorkflowWait = async () => "completed";

    await runPipeline(PIPELINE_ID, { store, dispatch, wait, context: baseContext, resolveStage: resolveStageStub() });

    expect(dispatchOrder).toEqual([0]);
    const byId = new Map(stages().map((s) => [s.stageId, s]));
    expect(byId.get("gate")?.status).toBe("failed");
    expect(byId.get("s3")?.status).toBe("pending");
    const pipeline = store.loadPipeline(PIPELINE_ID);
    if (!pipeline) throw new Error("expected pipeline");
    expect(derivePipelineState(pipeline)).toBe("failed");
  });
});

describe("continuePipeline", () => {
  const definition: PipelineDefinition = {
    name: "p",
    stages: [
      { stageId: "s1", kind: "workflow", workflow: "intent", review: "none" },
      { stageId: "gate", kind: "approval" },
      { stageId: "s3", kind: "workflow", workflow: "plan", review: "none" },
    ],
  };
  test("after restart dispatches the eligible later stage from persisted context and predecessor artifact without caller context", async () => {
    const { store, stages } = fakeStore(
      definition,
      { "run-2": { specPath: "spec/s3.md" } },
      { context: persistedContext, ownerIdentity: PRIOR_OWNER },
    );
    store.updateStage({
      pipelineId: PIPELINE_ID,
      stageId: "s1",
      patch: { status: "succeeded", artifact: { specPath: "spec/s1.md" } },
    });
    store.updateStage({ pipelineId: PIPELINE_ID, stageId: "gate", patch: { status: "approved" } });

    let resolvedContext: PipelineContext | undefined;
    const resolveStage = async (
      _definition: PipelineDefinition,
      stageIndex: number,
      context: PipelineContext,
    ): Promise<PipelineStageResolutionResult> => {
      if (stageIndex === 2) resolvedContext = context;
      return { ok: true, steps: [taggedStep(stageIndex)] };
    };

    const dispatchOrder: number[] = [];
    const dispatch: PipelineWorkflowDispatch = async (steps) => {
      dispatchOrder.push(stageIndexOf(steps));
      return { ok: true, entryRunId: `run-${stageIndexOf(steps)}`, invocationId: `inv-${stageIndexOf(steps)}` };
    };
    const wait: PipelineWorkflowWait = async () => "completed";

    const outcome = await continuePipeline(PIPELINE_ID, {
      store,
      dispatch,
      wait,
      context: { cwd: "/caller-should-be-ignored", seed: "ignored" },
      resolveStage,
    });

    expect(outcome).toEqual({ kind: "continued", pipelineId: PIPELINE_ID });
    expect(dispatchOrder).toEqual([2]);
    expect(resolvedContext).toEqual(persistedContext);
    expect(stages().find((s) => s.stageId === "s3")?.status).toBe("succeeded");
  });

  test("claims one live owner before dispatch and refuses a losing claim without a second dispatch", async () => {
    const { store, stages } = fakeStore(
      definition,
      { "run-2": { specPath: "spec/s3.md" } },
      { context: persistedContext, ownerIdentity: PRIOR_OWNER },
    );
    store.updateStage({
      pipelineId: PIPELINE_ID,
      stageId: "s1",
      patch: { status: "succeeded", artifact: { specPath: "spec/s1.md" } },
    });
    store.updateStage({ pipelineId: PIPELINE_ID, stageId: "gate", patch: { status: "approved" } });

    let claimCalls = 0;
    const claimOnceStore = {
      ...store,
      claimPipelineContinuation: (args: { pipelineId: string; priorOwnerIdentity: string | null }) => {
        claimCalls += 1;
        if (claimCalls === 1) return store.claimPipelineContinuation(args);
        return { kind: "refused" as const, pipelineId: PIPELINE_ID, reason: "claim_lost" as const };
      },
    };

    const dispatchOrder: number[] = [];
    const dispatch: PipelineWorkflowDispatch = async (steps) => {
      dispatchOrder.push(stageIndexOf(steps));
      return { ok: true, entryRunId: `run-${stageIndexOf(steps)}`, invocationId: `inv-${stageIndexOf(steps)}` };
    };
    const wait: PipelineWorkflowWait = async () => "completed";

    const first = await continuePipeline(PIPELINE_ID, {
      store: claimOnceStore,
      dispatch,
      wait,
      resolveStage: resolveStageStub(),
    });
    const beforeSecond = stages().map((s) => ({ stageId: s.stageId, status: s.status }));
    const second = await continuePipeline(PIPELINE_ID, {
      store: claimOnceStore,
      dispatch,
      wait,
      resolveStage: resolveStageStub(),
    });

    expect(first).toEqual({ kind: "continued", pipelineId: PIPELINE_ID });
    expect(second).toEqual({ kind: "refused", pipelineId: PIPELINE_ID, reason: "claim_refused" });
    expect(dispatchOrder).toEqual([2]);
    expect(stages().map((s) => ({ stageId: s.stageId, status: s.status }))).toEqual(beforeSecond);
  });

  test("refuses continuation when persisted context is absent and dispatches nothing", async () => {
    const { store, stages } = fakeStore(definition, {}, { context: null, ownerIdentity: PRIOR_OWNER });
    store.updateStage({
      pipelineId: PIPELINE_ID,
      stageId: "s1",
      patch: { status: "succeeded", artifact: { specPath: "spec/s1.md" } },
    });
    store.updateStage({ pipelineId: PIPELINE_ID, stageId: "gate", patch: { status: "approved" } });

    const dispatchOrder: number[] = [];
    const dispatch: PipelineWorkflowDispatch = async (steps) => {
      dispatchOrder.push(stageIndexOf(steps));
      return { ok: true, entryRunId: "run-x", invocationId: "inv-x" };
    };

    const outcome = await continuePipeline(PIPELINE_ID, {
      store,
      dispatch,
      wait: async () => "completed",
      resolveStage: resolveStageStub(),
    });

    expect(outcome).toEqual({ kind: "refused", pipelineId: PIPELINE_ID, reason: "missing_context" });
    expect(dispatchOrder).toEqual([]);
    expect(stages().find((s) => s.stageId === "s3")?.status).toBe("pending");
  });

  test("refuses continuation when the ownership claim is lost and dispatches nothing", async () => {
    const { store, stages } = fakeStore(definition, {}, { context: persistedContext, ownerIdentity: PRIOR_OWNER });
    store.updateStage({
      pipelineId: PIPELINE_ID,
      stageId: "s1",
      patch: { status: "succeeded", artifact: { specPath: "spec/s1.md" } },
    });
    store.updateStage({ pipelineId: PIPELINE_ID, stageId: "gate", patch: { status: "approved" } });

    const racingStore = {
      ...store,
      claimPipelineContinuation: () => ({
        kind: "refused" as const,
        pipelineId: PIPELINE_ID,
        reason: "claim_lost" as const,
      }),
    };

    const dispatchOrder: number[] = [];
    const dispatch: PipelineWorkflowDispatch = async (steps) => {
      dispatchOrder.push(stageIndexOf(steps));
      return { ok: true, entryRunId: "run-x", invocationId: "inv-x" };
    };

    const outcome = await continuePipeline(PIPELINE_ID, {
      store: racingStore,
      dispatch,
      wait: async () => "completed",
      resolveStage: resolveStageStub(),
    });

    expect(outcome).toEqual({ kind: "refused", pipelineId: PIPELINE_ID, reason: "claim_refused" });
    expect(dispatchOrder).toEqual([]);
    expect(stages().find((s) => s.stageId === "s3")?.status).toBe("pending");
  });
});

describe("continuation execution guards", () => {
  test("inverting persisted-context guard fails restart continuation regression", () => {
    expect(persistedContextLoadPermitsContinuation(baseContext)).toBe(true);
    expect(persistedContextLoadPermitsContinuation(null)).toBe(false);
    expect(!persistedContextLoadPermitsContinuation(baseContext)).toBe(false);
  });
});

describe("pipeline activation after restart", () => {
  const approvalDefinition: PipelineDefinition = {
    name: "p",
    stages: [
      { stageId: "s1", kind: "workflow", workflow: "intent", review: "none" },
      { stageId: "gate", kind: "approval" },
      { stageId: "s3", kind: "workflow", workflow: "plan", review: "none" },
    ],
  };
  const reopenDefinition: PipelineDefinition = {
    name: "p",
    stages: [
      { stageId: "s1", kind: "workflow", workflow: "intent", review: "none" },
      { stageId: "s2", kind: "workflow", workflow: "plan", review: "none" },
      { stageId: "s3", kind: "workflow", workflow: "implement", review: "light" },
    ],
  };
  function pipelineWithApprovalGate(gateStatus: string) {
    const { store, stages } = fakeStore(
      approvalDefinition,
      { "run-2": { specPath: "spec/s3.md" } },
      { context: persistedContext, ownerIdentity: PRIOR_OWNER },
    );
    store.updateStage({
      pipelineId: PIPELINE_ID,
      stageId: "s1",
      patch: { status: "succeeded", artifact: { specPath: "spec/s1.md" }, workflowInvocationId: "inv-1" },
    });
    store.updateStage({ pipelineId: PIPELINE_ID, stageId: "gate", patch: { status: gateStatus } });
    return { store, stages };
  }

  test("does not activate awaiting or rejected approvals after restart reconciliation", async () => {
    for (const gateStatus of ["awaiting", "rejected"] as const) {
      const { store } = pipelineWithApprovalGate(gateStatus);
      const pipeline = store.loadPipeline(PIPELINE_ID);
      if (!pipeline) throw new Error("expected pipeline");
      expect(isPipelineContinuable(pipeline)).toBe(false);

      const dispatchOrder: number[] = [];
      const dispatch: PipelineWorkflowDispatch = async (steps) => {
        dispatchOrder.push(stageIndexOf(steps));
        return { ok: true, entryRunId: "run-x", invocationId: "inv-x" };
      };

      const { continued } = await recoverContinuablePipelines(
        store,
        { store, dispatch, wait: async () => "completed", resolveStage: resolveStageStub() },
        async () => false,
      );
      expect(continued).toBe(0);
      expect(dispatchOrder).toEqual([]);
    }
  });

  test("activates an approved approval continuation under one live owner after restart", async () => {
    const { store, stages } = pipelineWithApprovalGate("approved");

    const dispatchOrder: number[] = [];
    const dispatch: PipelineWorkflowDispatch = async (steps) => {
      dispatchOrder.push(stageIndexOf(steps));
      return { ok: true, entryRunId: `run-${stageIndexOf(steps)}`, invocationId: `inv-${stageIndexOf(steps)}` };
    };

    const { continued } = await recoverContinuablePipelines(
      store,
      { store, dispatch, wait: async () => "completed", resolveStage: resolveStageStub() },
      async () => false,
    );

    expect(continued).toBe(1);
    expect(dispatchOrder).toEqual([2]);
    expect(stages().find((s) => s.stageId === "s1")?.workflowInvocationId).toBe("inv-1");
    expect(stages().find((s) => s.stageId === "s3")?.status).toBe("succeeded");
  });

  test("after an applied reopen dispatches only the reopened failed stage and preserves predecessor evidence", async () => {
    const { store, stages } = fakeStore(
      reopenDefinition,
      { "run-1": { specPath: "spec/s2.md" } },
      { context: persistedContext, ownerIdentity: PRIOR_OWNER },
    );
    store.updateStage({
      pipelineId: PIPELINE_ID,
      stageId: "s1",
      patch: { status: "succeeded", artifact: { specPath: "spec/s1.md" }, workflowInvocationId: "inv-1" },
    });
    store.updateStage({
      pipelineId: PIPELINE_ID,
      stageId: "s2",
      patch: { status: "pending", workflowInvocationId: null, endedAt: null, failureDetail: null, artifact: null },
    });
    store.updateStage({ pipelineId: PIPELINE_ID, stageId: "s3", patch: { status: "pending" } });

    const pipeline = store.loadPipeline(PIPELINE_ID);
    if (!pipeline) throw new Error("expected pipeline");
    expect(isPipelineContinuable(pipeline)).toBe(true);

    const dispatchOrder: number[] = [];
    const stage1Wait = deferred<RunStatus>();
    let stage1WaitCalled = false;
    const dispatch: PipelineWorkflowDispatch = async (steps) => {
      dispatchOrder.push(stageIndexOf(steps));
      return { ok: true, entryRunId: `run-${stageIndexOf(steps)}`, invocationId: `inv-${stageIndexOf(steps)}` };
    };
    const wait: PipelineWorkflowWait = async (entryRunId) => {
      if (entryRunId === "run-1") {
        stage1WaitCalled = true;
        return stage1Wait.promise;
      }
      return "completed";
    };

    const activation = recoverContinuablePipelines(
      store,
      { store, dispatch, wait, resolveStage: resolveStageStub() },
      async () => false,
    );

    while (!stage1WaitCalled) {
      await Promise.resolve();
    }

    expect(dispatchOrder).toEqual([1]);
    const byId = new Map(stages().map((s) => [s.stageId, s]));
    expect(byId.get("s1")?.workflowInvocationId).toBe("inv-1");
    expect(byId.get("s1")?.artifact).toEqual({ specPath: "spec/s1.md" });
    expect(byId.get("s3")?.status).toBe("pending");

    stage1Wait.resolve("completed");
    const { continued } = await activation;
    expect(continued).toBe(1);
    expect(byId.get("s2")?.status).toBe("succeeded");
  });

  test("does not activate a failed pipeline before reopen is applied", async () => {
    const { store } = fakeStore(reopenDefinition, {}, { context: persistedContext, ownerIdentity: PRIOR_OWNER });
    store.updateStage({ pipelineId: PIPELINE_ID, stageId: "s1", patch: { status: "succeeded" } });
    store.updateStage({ pipelineId: PIPELINE_ID, stageId: "s2", patch: { status: "failed" } });
    store.updateStage({ pipelineId: PIPELINE_ID, stageId: "s3", patch: { status: "skipped" } });

    const pipeline = store.loadPipeline(PIPELINE_ID);
    if (!pipeline) throw new Error("expected pipeline");
    expect(isPipelineContinuable(pipeline)).toBe(false);

    const dispatchOrder: number[] = [];
    const { continued } = await recoverContinuablePipelines(
      store,
      {
        store,
        dispatch: async (steps) => {
          dispatchOrder.push(stageIndexOf(steps));
          return { ok: true, entryRunId: "run-x", invocationId: "inv-x" };
        },
        wait: async () => "completed",
        resolveStage: resolveStageStub(),
      },
      async () => false,
    );
    expect(continued).toBe(0);
    expect(dispatchOrder).toEqual([]);
  });

  test("a duplicate activation request changes no stage row and produces no additional dispatch", async () => {
    const { store, stages } = pipelineWithApprovalGate("approved");

    let claimCalls = 0;
    const claimOnceStore = {
      ...store,
      claimPipelineContinuation: (args: { pipelineId: string; priorOwnerIdentity: string | null }) => {
        claimCalls += 1;
        if (claimCalls === 1) return store.claimPipelineContinuation(args);
        return { kind: "refused" as const, pipelineId: PIPELINE_ID, reason: "claim_lost" as const };
      },
    };

    const dispatchOrder: number[] = [];
    const deps = {
      store: claimOnceStore,
      dispatch: (async (steps: AnyWorkflowStep[]) => {
        dispatchOrder.push(stageIndexOf(steps));
        return { ok: true, entryRunId: "run-2", invocationId: "inv-2" };
      }) as PipelineWorkflowDispatch,
      wait: (async () => "completed") as PipelineWorkflowWait,
      resolveStage: resolveStageStub(),
    };

    const first = await recoverContinuablePipelines(claimOnceStore, deps, async () => false);
    const beforeSecond = stages().map((s) => ({ stageId: s.stageId, status: s.status }));
    const second = await recoverContinuablePipelines(claimOnceStore, deps, async () => false);

    expect(first.continued).toBe(1);
    expect(second.continued).toBe(0);
    expect(dispatchOrder).toEqual([2]);
    expect(stages().map((s) => ({ stageId: s.stageId, status: s.status }))).toEqual(beforeSecond);
  });
});

describe("activation eligibility guards", () => {
  const definition: PipelineDefinition = {
    name: "p",
    stages: [
      { stageId: "s1", kind: "workflow", workflow: "intent", review: "none" },
      { stageId: "gate", kind: "approval" },
      { stageId: "s3", kind: "workflow", workflow: "plan", review: "none" },
    ],
  };

  function pipelineWithGateStatus(gateStatus: string): Pipeline & { stages: PipelineStageRecord[] } {
    const { store } = fakeStore(definition, {}, { context: baseContext });
    store.updateStage({ pipelineId: PIPELINE_ID, stageId: "s1", patch: { status: "succeeded" } });
    store.updateStage({ pipelineId: PIPELINE_ID, stageId: "gate", patch: { status: gateStatus } });
    const pipeline = store.loadPipeline(PIPELINE_ID);
    if (!pipeline) throw new Error("expected pipeline");
    return pipeline;
  }

  test("inverting approval activation eligibility guard fails approved activation regression", () => {
    const approved = pipelineWithGateStatus("approved");
    expect(approvalOutcomePermitsActivation(approved)).toBe(true);
    expect(approvalOutcomeBlocksActivation("awaiting")).toBe(true);
    expect(approvalOutcomeBlocksActivation("rejected")).toBe(true);
    expect(approvalOutcomeBlocksActivation("approved")).toBe(false);
    expect(approvalOutcomePermitsActivation(pipelineWithGateStatus("awaiting"))).toBe(false);
    expect(approvalOutcomePermitsActivation(pipelineWithGateStatus("rejected"))).toBe(false);
  });

  test("inverting reopen activation eligibility guard fails reopened activation regression", () => {
    const reopenDefinition: PipelineDefinition = {
      name: "p",
      stages: [
        { stageId: "s1", kind: "workflow", workflow: "intent", review: "none" },
        { stageId: "s2", kind: "workflow", workflow: "plan", review: "none" },
      ],
    };
    const { store } = fakeStore(reopenDefinition, {}, { context: baseContext });
    store.updateStage({ pipelineId: PIPELINE_ID, stageId: "s1", patch: { status: "succeeded" } });
    store.updateStage({ pipelineId: PIPELINE_ID, stageId: "s2", patch: { status: "pending" } });
    const reopened = store.loadPipeline(PIPELINE_ID);
    if (!reopened) throw new Error("expected pipeline");
    expect(reopenedFailurePermitsActivation(reopened)).toBe(true);

    store.updateStage({ pipelineId: PIPELINE_ID, stageId: "s2", patch: { status: "failed" } });
    const failed = store.loadPipeline(PIPELINE_ID);
    if (!failed) throw new Error("expected pipeline");
    expect(reopenedFailurePermitsActivation(failed)).toBe(false);
  });
});

describe("approval execution guards", () => {
  test("inverting approval-stop guard fails awaiting block regression", () => {
    expect(approvalGateBlocksProgress("awaiting")).toBe(true);
    expect(!approvalGateBlocksProgress("awaiting")).toBe(false);
  });

  test("inverting approved-continue guard fails approved continue regression", () => {
    expect(approvalGatePermitsProgress("approved")).toBe(true);
    expect(!approvalGatePermitsProgress("approved")).toBe(false);
  });

  test("inverting rejected-settlement guard fails rejected settlement regression", () => {
    expect(approvalGateSettlesRejected("rejected")).toBe(true);
    expect(!approvalGateSettlesRejected("rejected")).toBe(false);
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
      context: null,
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

  test("reports awaiting-approval when the first unsatisfied approval row reads awaiting", () => {
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
      context: null,
      stages: definition.stages.map((stage, index) => ({
        id: `row-${index}`,
        pipelineId: PIPELINE_ID,
        stageId: stage.stageId,
        position: index,
        status: stage.stageId === "s1" ? "succeeded" : "awaiting",
        workflowInvocationId: null,
        startedAt: null,
        endedAt: null,
        artifact: null,
        failureDetail: null,
      })),
    };
    expect(derivePipelineState(pipeline)).toBe("awaiting-approval");
  });

  test("reports pending when an approved gate is followed by an undispatched workflow stage", () => {
    const definition: PipelineDefinition = {
      name: "p",
      stages: [
        { stageId: "s1", kind: "workflow", workflow: "intent", review: "none" },
        { stageId: "gate", kind: "approval" },
        { stageId: "s2", kind: "workflow", workflow: "plan", review: "none" },
      ],
    };
    const pipeline: Pipeline & { stages: PipelineStageRecord[] } = {
      id: PIPELINE_ID,
      name: definition.name,
      createdAt: 0,
      ownerIdentity: null,
      status: "active",
      definition,
      context: null,
      stages: definition.stages.map((stage, index) => ({
        id: `row-${index}`,
        pipelineId: PIPELINE_ID,
        stageId: stage.stageId,
        position: index,
        status: stage.stageId === "s1" ? "succeeded" : stage.stageId === "gate" ? "approved" : "pending",
        workflowInvocationId: null,
        startedAt: null,
        endedAt: null,
        artifact: null,
        failureDetail: null,
      })),
    };
    expect(derivePipelineState(pipeline)).toBe("pending");
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
      context: null,
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

  test("reports failed when an approval row reads failed", () => {
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
      context: null,
      stages: definition.stages.map((stage, index) => ({
        id: `row-${index}`,
        pipelineId: PIPELINE_ID,
        stageId: stage.stageId,
        position: index,
        status: stage.stageId === "s1" ? "succeeded" : "failed",
        workflowInvocationId: null,
        startedAt: null,
        endedAt: null,
        artifact: null,
        failureDetail: null,
      })),
    };
    expect(derivePipelineState(pipeline)).toBe("failed");
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

  test("walks durable position order, not definition array index", () => {
    const definition: PipelineDefinition = {
      name: "p",
      stages: [
        { stageId: "plan", kind: "workflow", workflow: "intent", review: "none" },
        { stageId: "gate", kind: "approval" },
        { stageId: "implement", kind: "workflow", workflow: "plan", review: "none" },
      ],
    };
    const pipeline: Pipeline & { stages: PipelineStageRecord[] } = {
      id: PIPELINE_ID,
      name: definition.name,
      createdAt: 0,
      ownerIdentity: null,
      status: "active",
      definition,
      context: null,
      stages: [
        {
          id: "row-implement",
          pipelineId: PIPELINE_ID,
          stageId: "implement",
          position: 0,
          status: "pending",
          workflowInvocationId: null,
          startedAt: null,
          endedAt: null,
          artifact: null,
          failureDetail: null,
        },
        {
          id: "row-gate",
          pipelineId: PIPELINE_ID,
          stageId: "gate",
          position: 1,
          status: "awaiting",
          workflowInvocationId: null,
          startedAt: null,
          endedAt: null,
          artifact: null,
          failureDetail: null,
        },
        {
          id: "row-plan",
          pipelineId: PIPELINE_ID,
          stageId: "plan",
          position: 2,
          status: "succeeded",
          workflowInvocationId: null,
          startedAt: null,
          endedAt: null,
          artifact: null,
          failureDetail: null,
        },
      ],
    };

    expect(derivePipelineState(pipeline)).toBe("pending");
  });

  test("reports rejected when any approval stage row reads rejected", () => {
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
      context: null,
      stages: definition.stages.map((stage, index) => ({
        id: `row-${index}`,
        pipelineId: PIPELINE_ID,
        stageId: stage.stageId,
        position: index,
        status: stage.stageId === "s1" ? "succeeded" : "rejected",
        workflowInvocationId: null,
        startedAt: null,
        endedAt: null,
        artifact: null,
        failureDetail: null,
      })),
    };
    expect(derivePipelineState(pipeline)).toBe("rejected");
  });

  test("reports interrupted when any stage row reads interrupted", () => {
    expect(
      derivePipelineState({
        ...pipelineWith({ s1: "succeeded", s2: "succeeded" }),
        status: "interrupted",
      }),
    ).toBe("succeeded");

    const definition: PipelineDefinition = {
      name: "p",
      stages: [{ stageId: "s1", kind: "workflow", workflow: "intent", review: "none" }],
    };
    const pipeline: Pipeline & { stages: PipelineStageRecord[] } = {
      id: PIPELINE_ID,
      name: definition.name,
      createdAt: 0,
      ownerIdentity: null,
      status: "active",
      definition,
      context: null,
      stages: [
        {
          id: "row-0",
          pipelineId: PIPELINE_ID,
          stageId: "s1",
          position: 0,
          status: "interrupted",
          workflowInvocationId: null,
          startedAt: null,
          endedAt: null,
          artifact: null,
          failureDetail: null,
        },
      ],
    };
    expect(derivePipelineState(pipeline)).toBe("interrupted");
  });
});

const REAL_STORE_DB_PATH = join(tmpdir(), `jarvis-pipeline-activation-${process.pid}.sqlite`);

describe("post-reconcile activation on real store", () => {
  const PRIOR_IDENTITY = "11111:1000000";
  const CURRENT_IDENTITY = "22222:2000000";

  const approvalDefinition: PipelineDefinition = {
    name: "p",
    stages: [
      { stageId: "s1", kind: "workflow", workflow: "intent", review: "none" },
      { stageId: "gate", kind: "approval" },
      { stageId: "s3", kind: "workflow", workflow: "plan", review: "none" },
    ],
  };
  const reopenDefinition: PipelineDefinition = {
    name: "p",
    stages: [
      { stageId: "s1", kind: "workflow", workflow: "intent", review: "none" },
      { stageId: "s2", kind: "workflow", workflow: "plan", review: "none" },
      { stageId: "s3", kind: "workflow", workflow: "implement", review: "light" },
    ],
  };

  function seedStages(
    dbPath: string,
    pipelineId: string,
    patches: Record<string, { status: string; artifact?: unknown; workflowInvocationId?: string | null }>,
  ): void {
    const raw = new Database(dbPath);
    try {
      for (const [stageId, patch] of Object.entries(patches)) {
        raw
          .prepare(
            `UPDATE pipeline_stages
             SET status = ?, artifact = ?, workflow_invocation_id = ?
             WHERE pipeline_id = ? AND stage_id = ?`,
          )
          .run(
            patch.status,
            patch.artifact === undefined ? null : JSON.stringify(patch.artifact),
            patch.workflowInvocationId ?? null,
            pipelineId,
            stageId,
          );
      }
    } finally {
      raw.close();
    }
  }

  function dispatchWithRuns(store: StateStore): PipelineWorkflowDispatch {
    let branchCounter = 0;
    return async (steps) => {
      const index = stageIndexOf(steps);
      const entryRunId = store.createRun({
        project: "pipeline-project",
        specRef: "main",
        worktreePath: "/tmp/worktree",
        branch: `branch-${branchCounter++}`,
        specPath: `spec/s${index}.md`,
      });
      return { ok: true, entryRunId, invocationId: `inv-${index}` };
    };
  }

  test("activates an approved gate after reconcilePipelines claims ownership and dispatches once", async () => {
    removeOrchestrationStore(REAL_STORE_DB_PATH);
    const seedStore = openStateStore(REAL_STORE_DB_PATH, { currentIdentity: PRIOR_IDENTITY });
    const pipelineId = seedStore.createPipeline({ definition: approvalDefinition, context: persistedContext });
    const gateRecord = seedStore.loadPipeline(pipelineId)?.stages.find((stage) => stage.stageId === "gate");
    if (!gateRecord) throw new Error("expected gate row");
    seedStages(REAL_STORE_DB_PATH, pipelineId, {
      s1: { status: "succeeded", artifact: { specPath: "spec/s1.md" }, workflowInvocationId: "inv-1" },
      gate: { status: "awaiting" },
    });
    expect(seedStore.commitApprovalDecision({ stageRecordId: gateRecord.id, decision: "approved" }).kind).toBe(
      "applied",
    );
    seedStore.close();

    const sweepStore = openStateStore(REAL_STORE_DB_PATH, {
      currentIdentity: CURRENT_IDENTITY,
      isOwnerAlive: async () => false,
    });
    await sweepStore.reconcilePipelines();
    const reconciled = sweepStore.loadPipeline(pipelineId);
    if (!reconciled) throw new Error("expected pipeline");
    expect(reconciled.status).toBe("interrupted");
    expect(isPipelineContinuable(reconciled)).toBe(true);

    const dispatchOrder: number[] = [];
    const dispatch: PipelineWorkflowDispatch = async (steps) => {
      dispatchOrder.push(stageIndexOf(steps));
      return (await dispatchWithRuns(sweepStore)(steps)) as Awaited<ReturnType<PipelineWorkflowDispatch>>;
    };
    const { continued } = await recoverContinuablePipelines(
      sweepStore,
      { store: sweepStore, dispatch, wait: async () => "completed", resolveStage: resolveStageStub() },
      async () => false,
    );

    expect(continued).toBe(1);
    expect(dispatchOrder).toEqual([2]);
    const after = sweepStore.loadPipeline(pipelineId);
    expect(after?.status).toBe("active");
    expect(after?.ownerIdentity).toBe(CURRENT_IDENTITY);
    expect(after?.stages.find((stage) => stage.stageId === "s3")?.status).toBe("succeeded");
    sweepStore.close();
  });

  test("activates a reopened failed continuation after reconcilePipelines", async () => {
    removeOrchestrationStore(REAL_STORE_DB_PATH);
    const seedStore = openStateStore(REAL_STORE_DB_PATH, { currentIdentity: PRIOR_IDENTITY });
    const pipelineId = seedStore.createPipeline({ definition: reopenDefinition, context: persistedContext });
    seedStages(REAL_STORE_DB_PATH, pipelineId, {
      s1: { status: "succeeded", artifact: { specPath: "spec/s1.md" }, workflowInvocationId: "inv-1" },
      s2: { status: "failed" },
      s3: { status: "skipped" },
    });
    seedStore.close();

    const sweepStore = openStateStore(REAL_STORE_DB_PATH, {
      currentIdentity: CURRENT_IDENTITY,
      isOwnerAlive: async () => false,
    });
    await sweepStore.reconcilePipelines();
    expect(sweepStore.reopenFailedPipeline({ pipelineId }).kind).toBe("applied");
    const reconciled = sweepStore.loadPipeline(pipelineId);
    if (!reconciled) throw new Error("expected pipeline");
    expect(reconciled.status).toBe("interrupted");
    expect(isPipelineContinuable(reconciled)).toBe(true);

    const dispatchOrder: number[] = [];
    const dispatch: PipelineWorkflowDispatch = async (steps) => {
      dispatchOrder.push(stageIndexOf(steps));
      return (await dispatchWithRuns(sweepStore)(steps)) as Awaited<ReturnType<PipelineWorkflowDispatch>>;
    };
    const { continued } = await recoverContinuablePipelines(
      sweepStore,
      {
        store: sweepStore,
        dispatch,
        wait: async () => "completed",
        resolveStage: resolveStageStub(),
      },
      async () => false,
    );

    expect(continued).toBe(1);
    expect(dispatchOrder).toEqual([1, 2]);
    const after = sweepStore.loadPipeline(pipelineId);
    expect(after?.status).toBe("active");
    expect(after?.stages.find((stage) => stage.stageId === "s1")?.workflowInvocationId).toBe("inv-1");
    expect(after?.stages.find((stage) => stage.stageId === "s2")?.status).toBe("succeeded");
    expect(after?.stages.find((stage) => stage.stageId === "s3")?.status).toBe("succeeded");
    sweepStore.close();
  });

  test("a duplicate claim after reconcile produces no second dispatch", async () => {
    removeOrchestrationStore(REAL_STORE_DB_PATH);
    const seedStore = openStateStore(REAL_STORE_DB_PATH, { currentIdentity: PRIOR_IDENTITY });
    const pipelineId = seedStore.createPipeline({ definition: approvalDefinition, context: persistedContext });
    const gateRecord = seedStore.loadPipeline(pipelineId)?.stages.find((stage) => stage.stageId === "gate");
    if (!gateRecord) throw new Error("expected gate row");
    seedStages(REAL_STORE_DB_PATH, pipelineId, {
      s1: { status: "succeeded", artifact: { specPath: "spec/s1.md" }, workflowInvocationId: "inv-1" },
      gate: { status: "approved" },
    });
    seedStore.close();

    const sweepStore = openStateStore(REAL_STORE_DB_PATH, {
      currentIdentity: CURRENT_IDENTITY,
      isOwnerAlive: async () => false,
    });
    await sweepStore.reconcilePipelines();

    let claimCalls = 0;
    const originalClaim = sweepStore.claimPipelineContinuation.bind(sweepStore);
    sweepStore.claimPipelineContinuation = (args) => {
      claimCalls += 1;
      if (claimCalls === 1) return originalClaim(args);
      return { kind: "refused", pipelineId, reason: "claim_lost" };
    };

    const dispatchOrder: number[] = [];
    const deps = {
      store: sweepStore,
      dispatch: (async (steps: AnyWorkflowStep[]) => {
        dispatchOrder.push(stageIndexOf(steps));
        return (await dispatchWithRuns(sweepStore)(steps)) as Awaited<ReturnType<PipelineWorkflowDispatch>>;
      }) as PipelineWorkflowDispatch,
      wait: (async () => "completed") as PipelineWorkflowWait,
      resolveStage: resolveStageStub(),
    };

    const first = await recoverContinuablePipelines(sweepStore, deps, async () => false);
    const beforeSecond = sweepStore.loadPipeline(pipelineId)?.stages.map((stage) => ({
      stageId: stage.stageId,
      status: stage.status,
    }));
    const second = await recoverContinuablePipelines(sweepStore, deps, async () => false);

    expect(first.continued).toBe(1);
    expect(second.continued).toBe(0);
    expect(dispatchOrder).toEqual([2]);
    expect(
      sweepStore.loadPipeline(pipelineId)?.stages.map((stage) => ({ stageId: stage.stageId, status: stage.status })),
    ).toEqual(beforeSecond);
    sweepStore.close();
  });
});
