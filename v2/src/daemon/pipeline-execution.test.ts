import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PipelineDefinition, PipelineTerminalAction } from "../execution/pipeline-definition.ts";
import { TerminalPublicationError } from "../execution/terminal-publication.ts";
import type { AnyWorkflowStep } from "../execution/workflow-runner.ts";
import type { Pipeline, PipelineStageRecord, Run, RunStatus, StateStore } from "../persistence/state-store.ts";
import { analyzeFailedPipelineReopenShape, openStateStore } from "../persistence/state-store.ts";
import { removeOrchestrationStore } from "../persistence/state-store-on-disk.ts";
import { flushBackgroundRuns } from "../testing/run-control.ts";
import { doneWithArtifactBindingFactory, writeStepFixtures } from "../testing/workflow-step-fixtures.ts";
import { createFakeWriteLoopExecutor } from "../testing/write-loop-executor.ts";
import { createRunControlHandlers } from "./daemon.ts";
import {
  applyPipelineApprovalDecision,
  approvalGateBlocksProgress,
  approvalGatePermitsProgress,
  approvalGateSettlesRejected,
  approvalOutcomeBlocksActivation,
  approvalOutcomePermitsActivation,
  commitPipelineApprovalDecision,
  continuePipeline,
  derivePipelineState,
  hasPipelineTerminalPublicationFailure,
  isPipelineContinuable,
  isReopenedFailedContinuation,
  type PipelineExecutionDeps,
  persistedContextLoadPermitsContinuation,
  recoverContinuablePipelines,
  reopenedFailurePermitsActivation,
  resumeAwaitingClaimsOnly,
  resumeDeferredRefusalApplies,
  resumeFailedRequiresReopen,
  resumePipeline,
  resumeReopenedPendingContinuation,
  resumeTerminalRefusalReason,
  runPipeline,
  setInvertPipelineTerminalPublicationFailureGuardForTest,
} from "./pipeline-execution.ts";
import type {
  PipelineStageArtifact,
  PipelineWorkflowDispatch,
  PipelineWorkflowWait,
} from "./pipeline-stage-dispatch.ts";
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
const { createWriteStep } = writeStepFixtures();

const APPROVAL_GATE_DEFINITION: PipelineDefinition = {
  name: "p",
  stages: [
    { stageId: "s1", kind: "workflow", workflow: "intent", review: "none" },
    { stageId: "gate", kind: "approval" },
    { stageId: "s3", kind: "workflow", workflow: "plan", review: "none" },
  ],
};

function pipelineTestDeps(store: StateStore, dispatchOrder: number[]) {
  return {
    store,
    dispatch: (async (steps: AnyWorkflowStep[]) => {
      dispatchOrder.push(stageIndexOf(steps));
      return {
        ok: true as const,
        entryRunId: `run-${stageIndexOf(steps)}`,
        invocationId: `inv-${stageIndexOf(steps)}`,
      };
    }) as PipelineWorkflowDispatch,
    wait: (async () => "completed") as PipelineWorkflowWait,
    resolveStage: resolveStageStub(),
  };
}

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
    terminalPublicationFailure?: Pipeline["terminalPublicationFailure"];
    terminalPublicationSucceededAt?: Pipeline["terminalPublicationSucceededAt"];
  } = {},
): { store: StateStore; stages: () => PipelineStageRecord[] } {
  const stages: PipelineStageRecord[] = definition.stages.map((stage, index) => ({
    id: `row-${index}`,
    pipelineId: PIPELINE_ID,
    stageId: stage.stageId,
    branchKey: "default",
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
  let terminalPublicationFailure = options.terminalPublicationFailure ?? null;
  let terminalPublicationSucceededAt = options.terminalPublicationSucceededAt ?? null;

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
            terminalPublicationFailure,
            terminalPublicationSucceededAt,
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
    commitApprovalDecision: (args: { stageRecordId: string; decision: "approved" | "rejected" }) => {
      if (args.decision !== "approved" && args.decision !== "rejected") {
        return { kind: "refused" as const, stageRecordId: args.stageRecordId, reason: "invalid_decision" as const };
      }
      const record = stages.find((s) => s.id === args.stageRecordId);
      if (!record) {
        return { kind: "refused" as const, stageRecordId: args.stageRecordId, reason: "stage_not_found" as const };
      }
      const authored = definition.stages[record.position];
      if (authored?.kind !== "approval") {
        return { kind: "refused" as const, stageRecordId: args.stageRecordId, reason: "not_approval_stage" as const };
      }
      if (record.status !== "awaiting") {
        return { kind: "refused" as const, stageRecordId: args.stageRecordId, reason: "status_not_awaiting" as const };
      }
      record.status = args.decision;
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
    reopenFailedPipeline: (args: { pipelineId: string }) => {
      if (args.pipelineId !== PIPELINE_ID) {
        return { kind: "refused" as const, pipelineId: args.pipelineId, reason: "pipeline_not_found" as const };
      }
      const shape = analyzeFailedPipelineReopenShape(stages);
      if (shape.kind === "invalid") {
        return { kind: "refused" as const, pipelineId: args.pipelineId, reason: shape.reason };
      }
      const failedRecord = stages.find((stage) => stage.id === shape.failedStageRecordId);
      if (!failedRecord || failedRecord.status !== "failed") {
        return { kind: "refused" as const, pipelineId: args.pipelineId, reason: "reopen_lost" as const };
      }
      Object.assign(failedRecord, {
        status: "pending",
        workflowInvocationId: null,
        startedAt: null,
        endedAt: null,
        artifact: null,
        failureDetail: null,
      });
      for (const suffixId of shape.suffixStageRecordIds) {
        const suffix = stages.find((stage) => stage.id === suffixId);
        if (!suffix || suffix.status !== "skipped") {
          return { kind: "refused" as const, pipelineId: args.pipelineId, reason: "reopen_lost" as const };
        }
        Object.assign(suffix, {
          status: "pending",
          workflowInvocationId: null,
          startedAt: null,
          endedAt: null,
          artifact: null,
          failureDetail: null,
        });
      }
      return { kind: "applied" as const, stageRecordId: shape.failedStageRecordId };
    },
    commitTerminalPublicationFailure: (args: {
      pipelineId: string;
      terminalAction: PipelineTerminalAction;
      failure: { operation: string; message: string };
      prNumber?: number;
      prUrl?: string;
    }) => {
      if (
        args.pipelineId !== PIPELINE_ID ||
        terminalPublicationFailure !== null ||
        terminalPublicationSucceededAt !== null
      ) {
        return;
      }
      terminalPublicationFailure = {
        terminalAction: args.terminalAction,
        failure: args.failure,
        ...(args.prNumber !== undefined ? { prNumber: args.prNumber } : {}),
        ...(args.prUrl !== undefined ? { prUrl: args.prUrl } : {}),
      };
    },
    commitTerminalPublicationSuccess: (args: { pipelineId: string }) => {
      if (
        args.pipelineId !== PIPELINE_ID ||
        terminalPublicationFailure !== null ||
        terminalPublicationSucceededAt !== null
      ) {
        return;
      }
      terminalPublicationSucceededAt = Date.now();
    },
  } as unknown as StateStore;

  return { store, stages: () => stages };
}

function resolveStageStub(): (
  definition: PipelineDefinition,
  stageIndex: number,
  context: PipelineContext,
  stageArtifacts: ReadonlyMap<string, PipelineStageArtifact>,
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
      APPROVAL_GATE_DEFINITION,
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

  test("an approval stage immediately before the pending workflow stage blocks reopened continuation", () => {
    const { store } = fakeStore(definition, {}, { context: baseContext });
    store.updateStage({ pipelineId: PIPELINE_ID, stageId: "s1", patch: { status: "succeeded" } });
    store.updateStage({ pipelineId: PIPELINE_ID, stageId: "gate", patch: { status: "approved" } });
    store.updateStage({ pipelineId: PIPELINE_ID, stageId: "s3", patch: { status: "pending" } });
    const gated = store.loadPipeline(PIPELINE_ID);
    if (!gated) throw new Error("expected pipeline");
    expect(isReopenedFailedContinuation(gated)).toBe(false);

    const ungatedDefinition: PipelineDefinition = {
      name: "p",
      stages: [
        { stageId: "s1", kind: "workflow", workflow: "intent", review: "none" },
        { stageId: "s3", kind: "workflow", workflow: "plan", review: "none" },
      ],
    };
    const ungated = fakeStore(ungatedDefinition, {}, { context: baseContext });
    ungated.store.updateStage({ pipelineId: PIPELINE_ID, stageId: "s1", patch: { status: "succeeded" } });
    ungated.store.updateStage({ pipelineId: PIPELINE_ID, stageId: "s3", patch: { status: "pending" } });
    const reopened = ungated.store.loadPipeline(PIPELINE_ID);
    if (!reopened) throw new Error("expected pipeline");
    expect(isReopenedFailedContinuation(reopened)).toBe(true);
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

describe("pipeline approval decisions", () => {
  test("blocks at awaiting until pipeline_approve applies a matching decision", async () => {
    const { store, stages } = fakeStore(APPROVAL_GATE_DEFINITION, {
      "run-0": { specPath: "spec/s1.md" },
      "run-2": { specPath: "spec/s3.md" },
    });
    const dispatchOrder: number[] = [];
    const deps = pipelineTestDeps(store, dispatchOrder);

    await runPipeline(PIPELINE_ID, { ...deps, context: baseContext });
    expect(dispatchOrder).toEqual([0]);
    expect(stages().find((s) => s.stageId === "gate")?.status).toBe("awaiting");
    expect(stages().find((s) => s.stageId === "s3")?.status).toBe("pending");

    const approveOutcome = applyPipelineApprovalDecision(PIPELINE_ID, "gate", "approved", deps);
    expect(approveOutcome).toEqual({ kind: "applied", pipelineId: PIPELINE_ID, stageId: "gate", decision: "approved" });
    await flushBackgroundRuns();

    expect(dispatchOrder).toEqual([0, 2]);
    expect(stages().find((s) => s.stageId === "s3")?.status).toBe("succeeded");
  });

  test("pipeline_approve advances to the next workflow stage and pipeline_reject settles rejected", async () => {
    const { store } = fakeStore(APPROVAL_GATE_DEFINITION, {
      "run-0": { specPath: "spec/s1.md" },
      "run-2": { specPath: "spec/s3.md" },
    });
    const approveOrder: number[] = [];
    const approveDeps = pipelineTestDeps(store, approveOrder);
    await runPipeline(PIPELINE_ID, { ...approveDeps, context: baseContext });
    const approveOutcome = applyPipelineApprovalDecision(PIPELINE_ID, "gate", "approved", approveDeps);
    expect(approveOutcome.kind).toBe("applied");
    await flushBackgroundRuns();
    expect(approveOrder).toEqual([0, 2]);
    const approvedPipeline = store.loadPipeline(PIPELINE_ID);
    if (!approvedPipeline) throw new Error("expected pipeline");
    expect(derivePipelineState(approvedPipeline)).toBe("succeeded");

    const rejectStore = fakeStore(APPROVAL_GATE_DEFINITION, { "run-0": { specPath: "spec/s1.md" } });
    const rejectOrder: number[] = [];
    const rejectDeps = pipelineTestDeps(rejectStore.store, rejectOrder);
    await runPipeline(PIPELINE_ID, { ...rejectDeps, context: baseContext });
    const rejectOutcome = applyPipelineApprovalDecision(PIPELINE_ID, "gate", "rejected", rejectDeps);
    expect(rejectOutcome).toEqual({ kind: "applied", pipelineId: PIPELINE_ID, stageId: "gate", decision: "rejected" });
    await flushBackgroundRuns();
    expect(rejectOrder).toEqual([0]);
    expect(rejectStore.stages().find((s) => s.stageId === "s3")?.status).toBe("pending");
    const rejectedPipeline = rejectStore.store.loadPipeline(PIPELINE_ID);
    if (!rejectedPipeline) throw new Error("expected pipeline");
    expect(derivePipelineState(rejectedPipeline)).toBe("rejected");
  });

  test("refuses wrong stageId, non-approval target, non-awaiting row, and duplicate decisions without dispatch", async () => {
    const { store, stages } = fakeStore(APPROVAL_GATE_DEFINITION, { "run-0": { specPath: "spec/s1.md" } });
    const dispatchOrder: number[] = [];
    const deps = pipelineTestDeps(store, dispatchOrder);
    await runPipeline(PIPELINE_ID, { ...deps, context: baseContext });

    const wrongStage = commitPipelineApprovalDecision({
      store,
      pipelineId: PIPELINE_ID,
      stageId: "missing",
      decision: "approved",
    });
    expect(wrongStage).toEqual({
      kind: "refused",
      pipelineId: PIPELINE_ID,
      stageId: "missing",
      reason: "stage_not_found",
    });

    const nonApproval = commitPipelineApprovalDecision({
      store,
      pipelineId: PIPELINE_ID,
      stageId: "s1",
      decision: "approved",
    });
    expect(nonApproval).toEqual({
      kind: "refused",
      pipelineId: PIPELINE_ID,
      stageId: "s1",
      reason: "not_approval_stage",
    });

    store.updateStage({ pipelineId: PIPELINE_ID, stageId: "gate", patch: { status: "approved" } });
    const nonAwaiting = commitPipelineApprovalDecision({
      store,
      pipelineId: PIPELINE_ID,
      stageId: "gate",
      decision: "approved",
    });
    expect(nonAwaiting).toEqual({
      kind: "refused",
      pipelineId: PIPELINE_ID,
      stageId: "gate",
      reason: "status_not_awaiting",
    });

    store.updateStage({ pipelineId: PIPELINE_ID, stageId: "gate", patch: { status: "awaiting" } });
    const first = applyPipelineApprovalDecision(PIPELINE_ID, "gate", "approved", deps);
    expect(first.kind).toBe("applied");
    await flushBackgroundRuns();

    const duplicate = commitPipelineApprovalDecision({
      store,
      pipelineId: PIPELINE_ID,
      stageId: "gate",
      decision: "rejected",
    });
    expect(duplicate).toEqual({
      kind: "refused",
      pipelineId: PIPELINE_ID,
      stageId: "gate",
      reason: "status_not_awaiting",
    });
    expect(dispatchOrder).toEqual([0, 2]);
    expect(stages().find((s) => s.stageId === "gate")?.status).toBe("approved");
  });

  test("after store close/reopen, awaiting stays until RPC reject", async () => {
    const dbPath = join(tmpdir(), `jarvis-approval-reject-rpc-${process.pid}-${Date.now()}.db`);
    const seedStore = openStateStore(dbPath, { currentIdentity: PRIOR_OWNER });
    const pipelineId = seedStore.createPipeline({ definition: APPROVAL_GATE_DEFINITION, context: persistedContext });
    seedStore.updateStage({
      pipelineId,
      stageId: "s1",
      patch: { status: "succeeded", artifact: { specPath: "spec/s1.md" }, workflowInvocationId: "inv-1" },
    });
    seedStore.updateStage({ pipelineId, stageId: "gate", patch: { status: "awaiting" } });
    seedStore.close();

    const reopenedStore = openStateStore(dbPath, {
      currentIdentity: CURRENT_OWNER,
      isOwnerAlive: async () => false,
    });
    await reopenedStore.reconcilePipelines();
    const rejectReopenedPipeline = reopenedStore.loadPipeline(pipelineId);
    if (!rejectReopenedPipeline) throw new Error("expected pipeline");
    expect(derivePipelineState(rejectReopenedPipeline)).toBe("awaiting-approval");

    const fakeExecutor = createFakeWriteLoopExecutor();
    const handlers = createRunControlHandlers({
      stateStore: reopenedStore,
      writeLoopExecutor: fakeExecutor.executor,
      failureReporter: () => {},
      hasMemoryHeadroom: () => true,
      resolveStage: async (_definition, stageIndex) => ({ ok: true, steps: [taggedStep(stageIndex)] }),
    });
    const rejectResponse = await handlers.pipeline_reject(
      { kind: "request", id: "reject", method: "pipeline_reject", params: { pipelineId, stageId: "gate" } },
      new AbortController().signal,
    );
    expect(rejectResponse).toEqual({
      kind: "response",
      result: { kind: "applied", pipelineId, stageId: "gate", decision: "rejected" },
    });
    expect(reopenedStore.loadPipeline(pipelineId)?.stages.find((stage) => stage.stageId === "s3")?.status).toBe(
      "pending",
    );
    reopenedStore.close();
  });

  test("after store close/reopen, RPC approve continues from persisted context", async () => {
    const dbPath = join(tmpdir(), `jarvis-approval-approve-rpc-${process.pid}-${Date.now()}.db`);
    const seedStore = openStateStore(dbPath, { currentIdentity: PRIOR_OWNER });
    const pipelineId = seedStore.createPipeline({ definition: APPROVAL_GATE_DEFINITION, context: persistedContext });
    seedStore.updateStage({
      pipelineId,
      stageId: "s1",
      patch: { status: "succeeded", artifact: { specPath: "spec/s1.md" }, workflowInvocationId: "inv-1" },
    });
    seedStore.updateStage({ pipelineId, stageId: "gate", patch: { status: "awaiting" } });
    seedStore.close();

    const reopenedStore = openStateStore(dbPath, {
      currentIdentity: CURRENT_OWNER,
      isOwnerAlive: async () => false,
    });
    await reopenedStore.reconcilePipelines();
    const approveReopenedPipeline = reopenedStore.loadPipeline(pipelineId);
    if (!approveReopenedPipeline) throw new Error("expected pipeline");
    expect(derivePipelineState(approveReopenedPipeline)).toBe("awaiting-approval");

    const fakeExecutor = createFakeWriteLoopExecutor();
    const stage3Step: AnyWorkflowStep = createWriteStep("stage-3", "pipeline-branch", doneWithArtifactBindingFactory, {
      suppressShrink: true,
    });
    const handlers = createRunControlHandlers({
      stateStore: reopenedStore,
      writeLoopExecutor: fakeExecutor.executor,
      failureReporter: () => {},
      hasMemoryHeadroom: () => true,
      resolveStage: async (_definition, stageIndex) => ({
        ok: true,
        steps: stageIndex === 2 ? [stage3Step] : [taggedStep(stageIndex)],
      }),
    });
    const approveResponse = await handlers.pipeline_approve(
      { kind: "request", id: "approve", method: "pipeline_approve", params: { pipelineId, stageId: "gate" } },
      new AbortController().signal,
    );
    expect(approveResponse).toEqual({
      kind: "response",
      result: { kind: "applied", pipelineId, stageId: "gate", decision: "approved" },
    });

    fakeExecutor.settleAll();
    const deadline = Date.now() + 5000;
    while (
      reopenedStore.loadPipeline(pipelineId)?.stages.find((stage) => stage.stageId === "s3")?.status !== "succeeded" &&
      Date.now() < deadline
    ) {
      await flushBackgroundRuns();
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    await flushBackgroundRuns();
    const after = reopenedStore.loadPipeline(pipelineId);
    expect(after?.stages.find((stage) => stage.stageId === "s3")?.status).toBe("succeeded");
    expect(after?.context).toEqual(persistedContext);
    reopenedStore.close();
  });

  test("inverting first-writer and refused-decision guards fails duplicate and refused regression", async () => {
    const { store } = fakeStore(APPROVAL_GATE_DEFINITION, { "run-0": { specPath: "spec/s1.md" } });
    const dispatchOrder: number[] = [];
    const deps = pipelineTestDeps(store, dispatchOrder);
    await runPipeline(PIPELINE_ID, { ...deps, context: baseContext });

    const refused = commitPipelineApprovalDecision({
      store,
      pipelineId: PIPELINE_ID,
      stageId: "s1",
      decision: "approved",
    });
    expect(refused.kind).toBe("refused");
    expect(dispatchOrder).toEqual([0]);

    applyPipelineApprovalDecision(PIPELINE_ID, "gate", "approved", deps);
    await flushBackgroundRuns();
    const duplicate = commitPipelineApprovalDecision({
      store,
      pipelineId: PIPELINE_ID,
      stageId: "gate",
      decision: "rejected",
    });
    expect(duplicate.kind).toBe("refused");
    expect(dispatchOrder).toEqual([0, 2]);
    expect(!approvalGateBlocksProgress("awaiting")).toBe(false);
    expect(!approvalGatePermitsProgress("approved")).toBe(false);
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
      terminalPublicationFailure: null,
      terminalPublicationSucceededAt: null,
      stages: definition.stages.map((stage, index) => ({
        id: `row-${index}`,
        pipelineId: PIPELINE_ID,
        stageId: stage.stageId,
        branchKey: "default",
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
      terminalPublicationFailure: null,
      terminalPublicationSucceededAt: null,
      stages: definition.stages.map((stage, index) => ({
        id: `row-${index}`,
        pipelineId: PIPELINE_ID,
        stageId: stage.stageId,
        branchKey: "default",
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
      terminalPublicationFailure: null,
      terminalPublicationSucceededAt: null,
      stages: definition.stages.map((stage, index) => ({
        id: `row-${index}`,
        pipelineId: PIPELINE_ID,
        stageId: stage.stageId,
        branchKey: "default",
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
      terminalPublicationFailure: null,
      terminalPublicationSucceededAt: null,
      stages: definition.stages.map((stage, index) => ({
        id: `row-${index}`,
        pipelineId: PIPELINE_ID,
        stageId: stage.stageId,
        branchKey: "default",
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
      terminalPublicationFailure: null,
      terminalPublicationSucceededAt: null,
      stages: definition.stages.map((stage, index) => ({
        id: `row-${index}`,
        pipelineId: PIPELINE_ID,
        stageId: stage.stageId,
        branchKey: "default",
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
      terminalPublicationFailure: null,
      terminalPublicationSucceededAt: null,
      stages: [
        {
          id: "row-implement",
          pipelineId: PIPELINE_ID,
          stageId: "implement",
          branchKey: "default",
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
          branchKey: "default",
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
          branchKey: "default",
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
      terminalPublicationFailure: null,
      terminalPublicationSucceededAt: null,
      stages: definition.stages.map((stage, index) => ({
        id: `row-${index}`,
        pipelineId: PIPELINE_ID,
        stageId: stage.stageId,
        branchKey: "default",
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
      terminalPublicationFailure: null,
      terminalPublicationSucceededAt: null,
      stages: [
        {
          id: "row-0",
          pipelineId: PIPELINE_ID,
          stageId: "s1",
          branchKey: "default",
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

describe("resumePipeline", () => {
  const reopenDefinition: PipelineDefinition = {
    name: "p",
    stages: [
      { stageId: "s1", kind: "workflow", workflow: "intent", review: "none" },
      { stageId: "s2", kind: "workflow", workflow: "plan", review: "none" },
      { stageId: "s3", kind: "workflow", workflow: "implement", review: "light" },
    ],
  };

  function failedPipeline(options: { reopened?: boolean } = {}) {
    const { store, stages } = fakeStore(
      reopenDefinition,
      { "run-1": { specPath: "spec/s2.md" }, "run-2": { specPath: "spec/s3.md" } },
      { context: persistedContext, ownerIdentity: PRIOR_OWNER },
    );
    store.updateStage({
      pipelineId: PIPELINE_ID,
      stageId: "s1",
      patch: { status: "succeeded", artifact: { specPath: "spec/s1.md" }, workflowInvocationId: "inv-1" },
    });
    if (options.reopened) {
      store.updateStage({
        pipelineId: PIPELINE_ID,
        stageId: "s2",
        patch: { status: "pending", workflowInvocationId: null, endedAt: null, failureDetail: null, artifact: null },
      });
      store.updateStage({ pipelineId: PIPELINE_ID, stageId: "s3", patch: { status: "pending" } });
    } else {
      store.updateStage({ pipelineId: PIPELINE_ID, stageId: "s2", patch: { status: "failed" } });
      store.updateStage({ pipelineId: PIPELINE_ID, stageId: "s3", patch: { status: "skipped" } });
    }
    return { store, stages };
  }

  test("re-dispatches only the failed continuation stage and preserves predecessor invocation IDs", async () => {
    for (const reopened of [false, true] as const) {
      const { store, stages } = failedPipeline({ reopened });
      const dispatchOrder: number[] = [];
      const stage1Wait = deferred<RunStatus>();
      let stage1WaitCalled = false;
      const resume = resumePipeline(PIPELINE_ID, {
        ...pipelineTestDeps(store, dispatchOrder),
        wait: async (entryRunId) => {
          if (entryRunId === "run-1") {
            stage1WaitCalled = true;
            return stage1Wait.promise;
          }
          return "completed";
        },
      });
      while (!stage1WaitCalled) {
        await Promise.resolve();
      }
      expect(dispatchOrder).toEqual([1]);
      expect(stages().find((s) => s.stageId === "s1")?.workflowInvocationId).toBe("inv-1");
      stage1Wait.resolve("completed");
      const outcome = await resume;
      expect(outcome).toEqual({ kind: "resumed", pipelineId: PIPELINE_ID });
      expect(stages().find((s) => s.stageId === "s2")?.status).toBe("succeeded");
    }
  });

  test("on awaiting-approval preserves awaiting on the gate and dispatches no later workflow stage", async () => {
    const { store, stages } = fakeStore(
      APPROVAL_GATE_DEFINITION,
      { "run-2": { specPath: "spec/s3.md" } },
      { context: persistedContext, ownerIdentity: PRIOR_OWNER },
    );
    store.updateStage({
      pipelineId: PIPELINE_ID,
      stageId: "s1",
      patch: { status: "succeeded", artifact: { specPath: "spec/s1.md" }, workflowInvocationId: "inv-1" },
    });
    store.updateStage({ pipelineId: PIPELINE_ID, stageId: "gate", patch: { status: "awaiting" } });

    const pipeline = store.loadPipeline(PIPELINE_ID);
    if (!pipeline) throw new Error("expected pipeline");
    expect(isPipelineContinuable(pipeline)).toBe(false);

    const dispatchOrder: number[] = [];
    const outcome = await resumePipeline(PIPELINE_ID, pipelineTestDeps(store, dispatchOrder));
    expect(outcome).toEqual({ kind: "resumed", pipelineId: PIPELINE_ID });
    expect(dispatchOrder).toEqual([]);
    expect(stages().find((s) => s.stageId === "gate")?.status).toBe("awaiting");
    expect(stages().find((s) => s.stageId === "s3")?.status).toBe("pending");

    const { continued } = await recoverContinuablePipelines(
      store,
      pipelineTestDeps(store, dispatchOrder),
      async () => false,
    );
    expect(continued).toBe(0);
    expect(dispatchOrder).toEqual([]);
  });

  test("refuses terminal succeeded and rejected pipelines without stage dispatch", async () => {
    const succeeded = fakeStore(reopenDefinition, {}, { context: persistedContext });
    succeeded.store.updateStage({ pipelineId: PIPELINE_ID, stageId: "s1", patch: { status: "succeeded" } });
    succeeded.store.updateStage({ pipelineId: PIPELINE_ID, stageId: "s2", patch: { status: "succeeded" } });
    succeeded.store.updateStage({ pipelineId: PIPELINE_ID, stageId: "s3", patch: { status: "succeeded" } });

    const rejected = fakeStore(APPROVAL_GATE_DEFINITION, {}, { context: persistedContext });
    rejected.store.updateStage({ pipelineId: PIPELINE_ID, stageId: "s1", patch: { status: "succeeded" } });
    rejected.store.updateStage({ pipelineId: PIPELINE_ID, stageId: "gate", patch: { status: "rejected" } });

    for (const [store, reason] of [
      [succeeded.store, "pipeline_terminal_succeeded"],
      [rejected.store, "pipeline_terminal_rejected"],
    ] as const) {
      const dispatchOrder: number[] = [];
      const before = store.loadPipeline(PIPELINE_ID)?.stages.map((stage) => ({
        stageId: stage.stageId,
        status: stage.status,
      }));
      const outcome = await resumePipeline(PIPELINE_ID, pipelineTestDeps(store, dispatchOrder));
      expect(outcome).toEqual({ kind: "refused", pipelineId: PIPELINE_ID, reason });
      expect(dispatchOrder).toEqual([]);
      expect(
        store.loadPipeline(PIPELINE_ID)?.stages.map((stage) => ({ stageId: stage.stageId, status: stage.status })),
      ).toEqual(before);
    }
  });

  test("returns reopen refusal for ineligible failed shapes without stage dispatch", async () => {
    const { store, stages } = fakeStore(
      reopenDefinition,
      {},
      { context: persistedContext, ownerIdentity: PRIOR_OWNER },
    );
    store.updateStage({ pipelineId: PIPELINE_ID, stageId: "s1", patch: { status: "succeeded" } });
    store.updateStage({ pipelineId: PIPELINE_ID, stageId: "s2", patch: { status: "failed" } });
    store.updateStage({ pipelineId: PIPELINE_ID, stageId: "s3", patch: { status: "failed" } });

    const dispatchOrder: number[] = [];
    const before = stages().map((stage) => ({ stageId: stage.stageId, status: stage.status }));
    const outcome = await resumePipeline(PIPELINE_ID, pipelineTestDeps(store, dispatchOrder));
    expect(outcome).toEqual({ kind: "refused", pipelineId: PIPELINE_ID, reason: "multiple_failed_stages" });
    expect(dispatchOrder).toEqual([]);
    expect(stages().map((stage) => ({ stageId: stage.stageId, status: stage.status }))).toEqual(before);
  });

  test("refuses derived running, pending, and interrupted pipelines without stage dispatch", async () => {
    const running = fakeStore(reopenDefinition, {}, { context: persistedContext });
    running.store.updateStage({ pipelineId: PIPELINE_ID, stageId: "s1", patch: { status: "running" } });

    const pending = fakeStore(reopenDefinition, {}, { context: persistedContext });
    const pendingPipeline = pending.store.loadPipeline(PIPELINE_ID);
    if (!pendingPipeline) throw new Error("expected pipeline");
    expect(derivePipelineState(pendingPipeline)).toBe("pending");

    const interrupted = fakeStore(reopenDefinition, {}, { context: persistedContext });
    interrupted.store.updateStage({ pipelineId: PIPELINE_ID, stageId: "s1", patch: { status: "interrupted" } });

    for (const store of [running.store, pending.store, interrupted.store]) {
      const dispatchOrder: number[] = [];
      const before = store.loadPipeline(PIPELINE_ID)?.stages.map((stage) => ({
        stageId: stage.stageId,
        status: stage.status,
      }));
      const outcome = await resumePipeline(PIPELINE_ID, pipelineTestDeps(store, dispatchOrder));
      expect(outcome).toEqual({ kind: "refused", pipelineId: PIPELINE_ID, reason: "pipeline_not_resumable" });
      expect(dispatchOrder).toEqual([]);
      expect(
        store.loadPipeline(PIPELINE_ID)?.stages.map((stage) => ({ stageId: stage.stageId, status: stage.status })),
      ).toEqual(before);
    }
  });

  test("on awaiting-approval returns missing_context and claim_refused without stage dispatch", async () => {
    const missingContext = fakeStore(APPROVAL_GATE_DEFINITION, {}, { context: null, ownerIdentity: PRIOR_OWNER });
    missingContext.store.updateStage({
      pipelineId: PIPELINE_ID,
      stageId: "s1",
      patch: { status: "succeeded", workflowInvocationId: "inv-1" },
    });
    missingContext.store.updateStage({ pipelineId: PIPELINE_ID, stageId: "gate", patch: { status: "awaiting" } });
    const missingDispatch: number[] = [];
    const missingOutcome = await resumePipeline(PIPELINE_ID, pipelineTestDeps(missingContext.store, missingDispatch));
    expect(missingOutcome).toEqual({ kind: "refused", pipelineId: PIPELINE_ID, reason: "missing_context" });
    expect(missingDispatch).toEqual([]);

    const claimRefused = fakeStore(
      APPROVAL_GATE_DEFINITION,
      {},
      { context: persistedContext, ownerIdentity: PRIOR_OWNER },
    );
    claimRefused.store.updateStage({
      pipelineId: PIPELINE_ID,
      stageId: "s1",
      patch: { status: "succeeded", workflowInvocationId: "inv-1" },
    });
    claimRefused.store.updateStage({ pipelineId: PIPELINE_ID, stageId: "gate", patch: { status: "awaiting" } });
    claimRefused.store.claimPipelineContinuation = () => ({
      kind: "refused",
      pipelineId: PIPELINE_ID,
      reason: "claim_lost",
    });
    const claimDispatch: number[] = [];
    const claimOutcome = await resumePipeline(PIPELINE_ID, pipelineTestDeps(claimRefused.store, claimDispatch));
    expect(claimOutcome).toEqual({ kind: "refused", pipelineId: PIPELINE_ID, reason: "claim_refused" });
    expect(claimDispatch).toEqual([]);
  });

  test("inverting resume guards fails regression coverage", () => {
    const { store } = failedPipeline({ reopened: true });
    const pipeline = store.loadPipeline(PIPELINE_ID);
    if (!pipeline) throw new Error("expected pipeline");
    const derivedState = derivePipelineState(pipeline);

    expect(resumeTerminalRefusalReason("succeeded")).toBe("pipeline_terminal_succeeded");
    expect(!resumeTerminalRefusalReason("succeeded")).toBe(false);
    expect(resumeTerminalRefusalReason("rejected")).toBe("pipeline_terminal_rejected");
    expect(!resumeTerminalRefusalReason("rejected")).toBe(false);

    expect(resumeAwaitingClaimsOnly("awaiting-approval")).toBe(true);
    expect(!resumeAwaitingClaimsOnly("awaiting-approval")).toBe(false);

    expect(resumeFailedRequiresReopen("failed")).toBe(true);
    expect(!resumeFailedRequiresReopen("failed")).toBe(false);

    expect(resumeDeferredRefusalApplies("running", pipeline)).toBe(true);
    expect(!resumeDeferredRefusalApplies("running", pipeline)).toBe(false);
    expect(resumeDeferredRefusalApplies("pending", pipeline)).toBe(false);
    expect(resumeReopenedPendingContinuation(derivedState, pipeline)).toBe(true);
    expect(!resumeReopenedPendingContinuation(derivedState, pipeline)).toBe(false);
  });

  test("after store close/reopen continues failed and awaiting pipelines from persisted context", async () => {
    const dbPath = join(tmpdir(), `jarvis-pipeline-resume-${process.pid}-${Date.now()}.db`);

    removeOrchestrationStore(dbPath);
    const failedSeed = openStateStore(dbPath, { currentIdentity: PRIOR_OWNER });
    const failedPipelineId = failedSeed.createPipeline({ definition: reopenDefinition, context: persistedContext });
    failedSeed.updateStage({
      pipelineId: failedPipelineId,
      stageId: "s1",
      patch: { status: "succeeded", artifact: { specPath: "spec/s1.md" }, workflowInvocationId: "inv-1" },
    });
    failedSeed.updateStage({ pipelineId: failedPipelineId, stageId: "s2", patch: { status: "failed" } });
    failedSeed.updateStage({ pipelineId: failedPipelineId, stageId: "s3", patch: { status: "skipped" } });
    failedSeed.close();

    const failedStore = openStateStore(dbPath, { currentIdentity: CURRENT_OWNER, isOwnerAlive: async () => false });
    await failedStore.reconcilePipelines();
    const failedDispatch: number[] = [];
    const failedStageWait = deferred<RunStatus>();
    let failedStageEntryRunId: string | undefined;
    let failedStageWaitCalled = false;
    const failedResume = resumePipeline(failedPipelineId, {
      store: failedStore,
      dispatch: async (steps) => {
        const index = stageIndexOf(steps);
        failedDispatch.push(index);
        const entryRunId = failedStore.createRun({
          project: "pipeline-project",
          specRef: "main",
          worktreePath: "/tmp/worktree",
          branch: `branch-${failedDispatch.length}`,
          specPath: `spec/s${index}.md`,
        });
        if (index === 1) failedStageEntryRunId = entryRunId;
        return { ok: true, entryRunId, invocationId: `inv-${index}` };
      },
      wait: async (entryRunId) => {
        if (entryRunId === failedStageEntryRunId) {
          failedStageWaitCalled = true;
          return failedStageWait.promise;
        }
        return "completed";
      },
      resolveStage: resolveStageStub(),
    });
    while (!failedStageWaitCalled) {
      await Promise.resolve();
    }
    expect(failedDispatch).toEqual([1]);
    expect(
      failedStore.loadPipeline(failedPipelineId)?.stages.find((stage) => stage.stageId === "s1")?.workflowInvocationId,
    ).toBe("inv-1");
    failedStageWait.resolve("completed");
    const failedOutcome = await failedResume;
    expect(failedOutcome).toEqual({ kind: "resumed", pipelineId: failedPipelineId });
    failedStore.close();

    removeOrchestrationStore(dbPath);
    const awaitingSeed = openStateStore(dbPath, { currentIdentity: PRIOR_OWNER });
    const awaitingPipelineId = awaitingSeed.createPipeline({
      definition: APPROVAL_GATE_DEFINITION,
      context: persistedContext,
    });
    awaitingSeed.updateStage({
      pipelineId: awaitingPipelineId,
      stageId: "s1",
      patch: { status: "succeeded", artifact: { specPath: "spec/s1.md" }, workflowInvocationId: "inv-1" },
    });
    awaitingSeed.updateStage({ pipelineId: awaitingPipelineId, stageId: "gate", patch: { status: "awaiting" } });
    awaitingSeed.close();

    const awaitingStore = openStateStore(dbPath, { currentIdentity: CURRENT_OWNER, isOwnerAlive: async () => false });
    await awaitingStore.reconcilePipelines();
    const awaitingDispatch: number[] = [];
    const awaitingOutcome = await resumePipeline(awaitingPipelineId, {
      store: awaitingStore,
      dispatch: async (steps) => {
        awaitingDispatch.push(stageIndexOf(steps));
        return { ok: true, entryRunId: "run-x", invocationId: "inv-x" };
      },
      wait: async () => "completed",
      resolveStage: resolveStageStub(),
    });
    expect(awaitingOutcome).toEqual({ kind: "resumed", pipelineId: awaitingPipelineId });
    expect(awaitingDispatch).toEqual([]);
    expect(
      awaitingStore.loadPipeline(awaitingPipelineId)?.stages.find((stage) => stage.stageId === "gate")?.status,
    ).toBe("awaiting");
    expect(awaitingStore.loadPipeline(awaitingPipelineId)?.ownerIdentity).toBe(CURRENT_OWNER);
    awaitingStore.close();
  });
});

const REAL_STORE_DB_PATH = join(tmpdir(), `jarvis-pipeline-activation-${process.pid}.sqlite`);

describe("post-reconcile activation on real store", () => {
  const PRIOR_IDENTITY = "11111:1000000";
  const CURRENT_IDENTITY = "22222:2000000";

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
    const pipelineId = seedStore.createPipeline({ definition: APPROVAL_GATE_DEFINITION, context: persistedContext });
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
    const pipelineId = seedStore.createPipeline({ definition: APPROVAL_GATE_DEFINITION, context: persistedContext });
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

const TERMINAL_PIPELINE_DEFINITION: PipelineDefinition = {
  name: "terminal-p",
  terminalAction: "ready",
  stages: [{ stageId: "implement", kind: "workflow", workflow: "implement", review: "light" }],
};

const TERMINAL_PR = { prNumber: 42, prUrl: "https://github.com/org/repo/pull/42" } as const;

function terminalImplementArtifact(entryRunId = "run-implement"): PipelineStageArtifact {
  return { entryRunId, specPath: "spec/implement.md", ...TERMINAL_PR };
}

function terminalImplementRun(): Partial<Run> {
  return {
    specRef: "main",
    worktreePath: "/repo/worktree",
    branch: "feature-branch",
    specPath: "spec/implement.md",
    ...TERMINAL_PR,
  };
}

function terminalPipelineDefinition(action: PipelineTerminalAction): PipelineDefinition {
  return { ...TERMINAL_PIPELINE_DEFINITION, terminalAction: action };
}

function terminalRunDeps(
  store: StateStore,
  executeTerminalPublication: NonNullable<PipelineExecutionDeps["executeTerminalPublication"]>,
): PipelineExecutionDeps {
  return {
    store,
    dispatch: async () => ({ ok: true, entryRunId: "run-implement", invocationId: "inv-implement" }),
    wait: async () => "completed",
    context: baseContext,
    resolveStage: resolveStageStub(),
    executeTerminalPublication,
  };
}

describe("pipeline terminal publication settlement", () => {
  test("settles each configured terminal action end to end", async () => {
    for (const terminalAction of ["leave-draft", "ready", "merge"] as const satisfies PipelineTerminalAction[]) {
      const definition = terminalPipelineDefinition(terminalAction);
      const { store, stages } = fakeStore(definition, { "run-implement": terminalImplementRun() });
      const settlement = deferred<void>();
      const capturedInputs: unknown[] = [];
      const executeTerminalPublication = async (input: unknown) => {
        capturedInputs.push(input);
        await settlement.promise;
        return TERMINAL_PR;
      };

      const runPromise = runPipeline(PIPELINE_ID, terminalRunDeps(store, executeTerminalPublication));

      while (stages().find((s) => s.stageId === "implement")?.status !== "succeeded") {
        await Promise.resolve();
      }

      const midPipeline = store.loadPipeline(PIPELINE_ID);
      if (!midPipeline) throw new Error("expected pipeline");
      expect(derivePipelineState(midPipeline)).toBe("running");

      settlement.resolve();
      await runPromise;

      expect(capturedInputs).toEqual([
        {
          terminalAction,
          worktreePath: "/repo/worktree",
          branch: "feature-branch",
          baseRef: "main",
          ...TERMINAL_PR,
        },
      ]);
      const settled = store.loadPipeline(PIPELINE_ID);
      if (!settled) throw new Error("expected pipeline");
      expect(settled.terminalPublicationSucceededAt).not.toBeNull();
      expect(derivePipelineState(settled)).toBe("succeeded");
    }
  });

  test("continues pending terminal publication after restart", async () => {
    const definition = terminalPipelineDefinition("ready");
    const { store, stages } = fakeStore(
      definition,
      { "run-implement": terminalImplementRun() },
      { context: persistedContext, ownerIdentity: PRIOR_OWNER },
    );
    store.updateStage({
      pipelineId: PIPELINE_ID,
      stageId: "implement",
      patch: { status: "succeeded", artifact: terminalImplementArtifact() },
    });

    const dispatchOrder: number[] = [];
    const executeTerminalPublication = async () => TERMINAL_PR;

    const outcome = await continuePipeline(PIPELINE_ID, {
      store,
      dispatch: async (steps) => {
        dispatchOrder.push(stageIndexOf(steps));
        return { ok: true, entryRunId: "run-implement", invocationId: "inv-implement" };
      },
      wait: async () => "completed",
      resolveStage: resolveStageStub(),
      executeTerminalPublication,
    });

    expect(outcome).toEqual({ kind: "continued", pipelineId: PIPELINE_ID });
    expect(dispatchOrder).toEqual([]);
    const settled = store.loadPipeline(PIPELINE_ID);
    if (!settled) throw new Error("expected pipeline");
    expect(settled.terminalPublicationSucceededAt).not.toBeNull();
    expect(derivePipelineState(settled)).toBe("succeeded");
    expect(stages().find((s) => s.stageId === "implement")?.status).toBe("succeeded");
  });

  test("does not invoke terminal publication when the stage walk stops early", async () => {
    const definition: PipelineDefinition = {
      name: "p",
      terminalAction: "merge",
      stages: [
        { stageId: "s1", kind: "workflow", workflow: "intent", review: "none" },
        { stageId: "gate", kind: "approval" },
        { stageId: "implement", kind: "workflow", workflow: "implement", review: "light" },
      ],
    };

    let terminalCalls = 0;
    const executeTerminalPublication = async () => {
      terminalCalls += 1;
      return {};
    };
    const dispatch: PipelineWorkflowDispatch = async (steps) => ({
      ok: true,
      entryRunId: `run-${stageIndexOf(steps)}`,
      invocationId: `inv-${stageIndexOf(steps)}`,
    });
    const wait: PipelineWorkflowWait = async () => "completed";
    const deps = {
      store: fakeStore(definition, { "run-0": { specPath: "spec/s1.md" } }).store,
      dispatch,
      wait,
      context: baseContext,
      resolveStage: resolveStageStub(),
      executeTerminalPublication,
    };

    await runPipeline(PIPELINE_ID, deps);
    expect(terminalCalls).toBe(0);

    const awaiting = fakeStore(definition, { "run-0": { specPath: "spec/s1.md" } });
    await runPipeline(PIPELINE_ID, { ...deps, store: awaiting.store });
    expect(terminalCalls).toBe(0);

    const rejected = fakeStore(definition, { "run-0": { specPath: "spec/s1.md" } });
    rejected.store.updateStage({ pipelineId: PIPELINE_ID, stageId: "gate", patch: { status: "rejected" } });
    await runPipeline(PIPELINE_ID, { ...deps, store: rejected.store });
    expect(terminalCalls).toBe(0);

    const failed = fakeStore(definition, { "run-0": { specPath: "spec/s1.md" } });
    const failingDispatch: PipelineWorkflowDispatch = async (steps) => {
      const index = stageIndexOf(steps);
      if (index === 0) return { ok: false, code: "worktree_claimed", message: "claimed" };
      return { ok: true, entryRunId: `run-${index}`, invocationId: `inv-${index}` };
    };
    await runPipeline(PIPELINE_ID, {
      ...deps,
      store: failed.store,
      dispatch: failingDispatch,
    });
    expect(terminalCalls).toBe(0);
  });

  test("fails a pipeline when its terminal action fails", async () => {
    const definition = terminalPipelineDefinition("ready");
    const { store, stages } = fakeStore(definition, { "run-implement": terminalImplementRun() });
    const failure = { operation: "gh pr ready", message: "ready flip failed", exitCode: 1 };
    const executeTerminalPublication = async () => {
      throw new TerminalPublicationError("ready", failure, TERMINAL_PR.prNumber, TERMINAL_PR.prUrl);
    };

    await runPipeline(PIPELINE_ID, terminalRunDeps(store, executeTerminalPublication));

    const pipeline = store.loadPipeline(PIPELINE_ID);
    if (!pipeline) throw new Error("expected pipeline");
    expect(pipeline.terminalPublicationFailure).toEqual({
      terminalAction: "ready",
      failure,
      ...TERMINAL_PR,
    });
    expect(stages().every((stage) => stage.status === "succeeded")).toBe(true);
    expect(derivePipelineState(pipeline)).toBe("failed");
    expect(hasPipelineTerminalPublicationFailure(pipeline)).toBe(true);
    setInvertPipelineTerminalPublicationFailureGuardForTest(true);
    expect(hasPipelineTerminalPublicationFailure(pipeline)).toBe(false);
    setInvertPipelineTerminalPublicationFailureGuardForTest(false);
  });

  test("does not merge a pipeline after a red ready gate", async () => {
    const definition = terminalPipelineDefinition("merge");
    const { store, stages } = fakeStore(definition, { "run-implement": terminalImplementRun() });
    let mergeCalls = 0;
    const executeTerminalPublication = async () => {
      mergeCalls += 1;
      throw new TerminalPublicationError(
        "merge",
        { operation: "ready-gate", message: "gateFailureKind=failed_checks", exitCode: 1 },
        TERMINAL_PR.prNumber,
        TERMINAL_PR.prUrl,
      );
    };

    await runPipeline(PIPELINE_ID, terminalRunDeps(store, executeTerminalPublication));

    expect(mergeCalls).toBe(1);
    const pipeline = store.loadPipeline(PIPELINE_ID);
    if (!pipeline) throw new Error("expected pipeline");
    expect(pipeline.terminalPublicationFailure?.terminalAction).toBe("merge");
    expect(derivePipelineState(pipeline)).toBe("failed");
    expect(stages().every((stage) => stage.status === "succeeded")).toBe(true);
  });

  test("records terminal publication failure when success commit throws", async () => {
    const definition = terminalPipelineDefinition("ready");
    const { store: inner, stages } = fakeStore(definition, { "run-implement": terminalImplementRun() });
    const store = {
      ...inner,
      commitTerminalPublicationSuccess: () => {
        throw new Error("success commit failed");
      },
    } as StateStore;

    await runPipeline(
      PIPELINE_ID,
      terminalRunDeps(store, async () => TERMINAL_PR),
    );

    const pipeline = store.loadPipeline(PIPELINE_ID);
    if (!pipeline) throw new Error("expected pipeline");
    expect(pipeline.terminalPublicationFailure).not.toBeNull();
    expect(pipeline.terminalPublicationSucceededAt).toBeNull();
    expect(stages().every((stage) => stage.status === "succeeded")).toBe(true);
    expect(derivePipelineState(pipeline)).toBe("failed");
  });
});
