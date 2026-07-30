import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PipelineDefinition } from "../execution/pipeline-definition.ts";
import type { AnyWorkflowStep } from "../execution/workflow-runner.ts";
import type { Pipeline, PipelineStageRecord, Run, RunStatus, StateStore } from "../persistence/state-store.ts";
import { openStateStore } from "../persistence/state-store.ts";
import {
  activateDurablePipeline,
  analyzePipelineActivationEligibility,
  continueDurablePipeline,
  derivePipelineState,
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

const CURRENT_IDENTITY = "daemon:2";

function fakeStore(
  definition: PipelineDefinition,
  runs: Record<string, Partial<Run>> = {},
  options: {
    context?: PipelineContext | null;
    pipelineStatus?: "active" | "interrupted";
    ownerIdentity?: string | null;
    stageOverrides?: Record<string, Partial<PipelineStageRecord>>;
  } = {},
): { store: StateStore; stages: () => PipelineStageRecord[] } {
  const context = "context" in options ? options.context : baseContext;
  let pipelineStatus = options.pipelineStatus ?? "active";
  let ownerIdentity = options.ownerIdentity ?? "prior:1";
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
    ...options.stageOverrides?.[stage.stageId],
  }));

  const store = {
    loadPipeline: (id: string) =>
      id === PIPELINE_ID
        ? ({
            id: PIPELINE_ID,
            name: definition.name,
            createdAt: 0,
            ownerIdentity,
            status: pipelineStatus,
            definition,
            context: context ?? null,
            stages: stages.map((s) => ({ ...s })),
          } as Pipeline & {
            context: PipelineContext | null;
            stages: PipelineStageRecord[];
          })
        : null,
    claimPipelineContinuation: (id: string) => {
      if (id !== PIPELINE_ID) return { outcome: "refused" as const, reason: "pipeline-not-found" as const };
      if (context === null || context === undefined) {
        return { outcome: "refused" as const, reason: "missing-context" as const };
      }
      if (pipelineStatus === "active" && ownerIdentity === CURRENT_IDENTITY) {
        return { outcome: "applied" as const };
      }
      if (pipelineStatus !== "interrupted") {
        return { outcome: "refused" as const, reason: "claim-refused" as const };
      }
      pipelineStatus = "active";
      ownerIdentity = CURRENT_IDENTITY;
      return { outcome: "applied" as const };
    },
    updateStage: (args: { pipelineId: string; stageId: string; patch: Record<string, unknown> }) => {
      const record = stages.find((s) => s.stageId === args.stageId);
      if (!record) throw new Error(`unknown stage ${args.stageId}`);
      Object.assign(record, args.patch);
    },
    markApprovalAwaiting: (args: { stageRecordId: string; stageId: string }) => {
      const record = stages.find((s) => s.id === args.stageRecordId);
      if (!record || record.stageId !== args.stageId) {
        return { outcome: "refused" as const, stageRecordId: args.stageRecordId, reason: "stage-not-found" as const };
      }
      if (record.status !== "pending") {
        return {
          outcome: "refused" as const,
          stageRecordId: args.stageRecordId,
          reason: "stage-not-pending" as const,
        };
      }
      record.status = "awaiting";
      return {
        outcome: "applied" as const,
        stageRecordId: args.stageRecordId,
        reason: "marked-awaiting" as const,
        status: "awaiting" as const,
      };
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

  test("a pipeline whose next stage is an approval stage persists awaiting and stops: no dispatch, later stages pending", async () => {
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

  test("blocks at an awaiting approval gate without rewriting it or dispatching the suffix", async () => {
    const definition: PipelineDefinition = {
      name: "p",
      stages: [
        { stageId: "s1", kind: "workflow", workflow: "intent", review: "none" },
        { stageId: "gate", kind: "approval" },
        { stageId: "s3", kind: "workflow", workflow: "plan", review: "none" },
      ],
    };
    const { store, stages } = fakeStore(definition, { "run-0": { specPath: "spec/s1.md" } });
    const gate = stages().find((s) => s.stageId === "gate");
    if (!gate) throw new Error("expected gate");
    gate.status = "awaiting";

    const dispatchOrder: number[] = [];
    const dispatch: PipelineWorkflowDispatch = async (steps) => {
      dispatchOrder.push(stageIndexOf(steps));
      return { ok: true, entryRunId: "run-0", invocationId: "inv-0" };
    };

    await runPipeline(PIPELINE_ID, {
      store,
      dispatch,
      wait: async () => "completed",
      context: baseContext,
      resolveStage: resolveStageStub(),
    });

    expect(dispatchOrder).toEqual([0]);
    expect(stages().find((s) => s.stageId === "gate")?.status).toBe("awaiting");
    expect(stages().find((s) => s.stageId === "s3")?.status).toBe("pending");
  });

  test("continues past an approved gate and dispatches the suffix", async () => {
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
    const gate = stages().find((s) => s.stageId === "gate");
    if (!gate) throw new Error("expected gate");
    gate.status = "approved";

    const dispatchOrder: number[] = [];
    const dispatch: PipelineWorkflowDispatch = async (steps) => {
      const index = stageIndexOf(steps);
      dispatchOrder.push(index);
      return { ok: true, entryRunId: `run-${index}`, invocationId: `inv-${index}` };
    };

    await runPipeline(PIPELINE_ID, {
      store,
      dispatch,
      wait: async () => "completed",
      context: baseContext,
      resolveStage: resolveStageStub(),
    });

    expect(dispatchOrder).toEqual([0, 2]);
    expect(stages().find((s) => s.stageId === "gate")?.status).toBe("approved");
    expect(stages().find((s) => s.stageId === "s3")?.status).toBe("succeeded");
  });

  test("settles deterministically at a rejected gate without dispatching the suffix", async () => {
    const definition: PipelineDefinition = {
      name: "p",
      stages: [
        { stageId: "s1", kind: "workflow", workflow: "intent", review: "none" },
        { stageId: "gate", kind: "approval" },
        { stageId: "s3", kind: "workflow", workflow: "plan", review: "none" },
      ],
    };
    const { store, stages } = fakeStore(definition, { "run-0": { specPath: "spec/s1.md" } });
    const gate = stages().find((s) => s.stageId === "gate");
    if (!gate) throw new Error("expected gate");
    gate.status = "rejected";

    const dispatchOrder: number[] = [];
    const dispatch: PipelineWorkflowDispatch = async (steps) => {
      dispatchOrder.push(stageIndexOf(steps));
      return { ok: true, entryRunId: "run-0", invocationId: "inv-0" };
    };

    await runPipeline(PIPELINE_ID, {
      store,
      dispatch,
      wait: async () => "completed",
      context: baseContext,
      resolveStage: resolveStageStub(),
    });

    expect(dispatchOrder).toEqual([0]);
    expect(stages().find((s) => s.stageId === "gate")?.status).toBe("rejected");
    expect(stages().find((s) => s.stageId === "s3")?.status).toBe("skipped");

    const pipeline = store.loadPipeline(PIPELINE_ID);
    if (!pipeline) throw new Error("expected pipeline");
    expect(derivePipelineState(pipeline)).toBe("failed");
  });

  test("a refused boundary write follows only the reloaded requested row", async () => {
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
    const gate = stages().find((s) => s.stageId === "gate");
    if (!gate) throw new Error("expected gate");

    const dispatchOrder: number[] = [];
    const dispatch: PipelineWorkflowDispatch = async (steps) => {
      const index = stageIndexOf(steps);
      dispatchOrder.push(index);
      return { ok: true, entryRunId: `run-${index}`, invocationId: `inv-${index}` };
    };

    const racingStore = {
      ...store,
      markApprovalAwaiting: (args: { stageRecordId: string; stageId: string }) => {
        gate.status = "approved";
        return { outcome: "refused" as const, stageRecordId: args.stageRecordId, reason: "stage-not-pending" as const };
      },
    } as StateStore;

    await runPipeline(PIPELINE_ID, {
      store: racingStore,
      dispatch,
      wait: async () => "completed",
      context: baseContext,
      resolveStage: resolveStageStub(),
    });

    expect(dispatchOrder).toEqual([0, 2]);
    expect(gate.status).toBe("approved");
    expect(stages().find((s) => s.stageId === "s3")?.status).toBe("succeeded");
  });

  test("a refused boundary write with an unexpected row status skips the suffix without rewriting other stages", async () => {
    const definition: PipelineDefinition = {
      name: "p",
      stages: [
        { stageId: "s1", kind: "workflow", workflow: "intent", review: "none" },
        { stageId: "gate", kind: "approval" },
        { stageId: "s3", kind: "workflow", workflow: "plan", review: "none" },
      ],
    };
    const { store, stages } = fakeStore(definition, { "run-0": { specPath: "spec/s1.md" } });
    const gate = stages().find((s) => s.stageId === "gate");
    if (!gate) throw new Error("expected gate");

    const dispatchOrder: number[] = [];
    const dispatch: PipelineWorkflowDispatch = async (steps) => {
      dispatchOrder.push(stageIndexOf(steps));
      return { ok: true, entryRunId: "run-0", invocationId: "inv-0" };
    };

    const racingStore = {
      ...store,
      markApprovalAwaiting: (args: { stageRecordId: string; stageId: string }) => {
        gate.status = "corrupt";
        return { outcome: "refused" as const, stageRecordId: args.stageRecordId, reason: "stage-not-pending" as const };
      },
    } as StateStore;

    await runPipeline(PIPELINE_ID, {
      store: racingStore,
      dispatch,
      wait: async () => "completed",
      context: baseContext,
      resolveStage: resolveStageStub(),
    });

    expect(dispatchOrder).toEqual([0]);
    expect(gate.status).toBe("corrupt");
    expect(stages().find((s) => s.stageId === "s3")?.status).toBe("skipped");
  });
});

describe("continueDurablePipeline", () => {
  test("after restart dispatches the next stage from persisted context and predecessor artifact without caller context", async () => {
    const definition: PipelineDefinition = {
      name: "p",
      stages: [
        { stageId: "s1", kind: "workflow", workflow: "intent", review: "none" },
        { stageId: "s2", kind: "workflow", workflow: "plan", review: "none" },
      ],
    };
    const { store, stages } = fakeStore(
      definition,
      { "run-1": { specPath: "spec/s2.md" } },
      {
        pipelineStatus: "interrupted",
        stageOverrides: {
          s1: { status: "succeeded", artifact: { specPath: "spec/s1.md" } },
        },
      },
    );

    const dispatchOrder: number[] = [];
    const dispatch: PipelineWorkflowDispatch = async (steps) => {
      dispatchOrder.push(stageIndexOf(steps));
      return { ok: true, entryRunId: "run-1", invocationId: "inv-1" };
    };

    const continuation = continueDurablePipeline(PIPELINE_ID, {
      store,
      dispatch,
      wait: async () => "completed",
      resolveStage: resolveStageStub(),
    });
    expect(continuation.claim).toEqual({ outcome: "applied" });
    await continuation.run;

    expect(dispatchOrder).toEqual([1]);
    expect(stages().find((s) => s.stageId === "s2")?.status).toBe("succeeded");
  });

  test("admits idempotent re-claim on an active pipeline owned by this daemon after the first continuation settles", async () => {
    const definition: PipelineDefinition = {
      name: "p",
      stages: [
        { stageId: "s1", kind: "workflow", workflow: "intent", review: "none" },
        { stageId: "s2", kind: "workflow", workflow: "plan", review: "none" },
      ],
    };
    const { store, stages } = fakeStore(
      definition,
      { "run-1": { specPath: "spec/s2.md" } },
      {
        pipelineStatus: "interrupted",
        stageOverrides: {
          s1: { status: "succeeded", artifact: { specPath: "spec/s1.md" } },
        },
      },
    );

    const dispatchOrder: number[] = [];
    const dispatch: PipelineWorkflowDispatch = async (steps) => {
      dispatchOrder.push(stageIndexOf(steps));
      return { ok: true, entryRunId: "run-1", invocationId: "inv-1" };
    };
    const deps = {
      store,
      dispatch,
      wait: async () => "completed" as RunStatus,
      resolveStage: resolveStageStub(),
    };

    const first = continueDurablePipeline(PIPELINE_ID, deps);
    expect(first.claim).toEqual({ outcome: "applied" });
    await first.run;

    const second = continueDurablePipeline(PIPELINE_ID, deps);
    expect(second.claim).toEqual({ outcome: "applied" });
    await second.run;

    expect(dispatchOrder).toEqual([1]);
    expect(stages().find((s) => s.stageId === "s2")?.status).toBe("succeeded");
  });

  test("refuses continuation when persisted context is absent", async () => {
    const definition: PipelineDefinition = {
      name: "p",
      stages: [{ stageId: "s1", kind: "workflow", workflow: "intent", review: "none" }],
    };
    const { store } = fakeStore(definition, {}, { context: null, pipelineStatus: "interrupted" });

    const dispatchOrder: number[] = [];
    const continuation = continueDurablePipeline(PIPELINE_ID, {
      store,
      dispatch: async (steps) => {
        dispatchOrder.push(stageIndexOf(steps));
        return { ok: true, entryRunId: "run-0", invocationId: "inv-0" };
      },
      wait: async () => "completed",
      resolveStage: resolveStageStub(),
    });

    expect(continuation.claim).toEqual({ outcome: "refused", reason: "missing-context" });
    await continuation.run;
    expect(dispatchOrder).toEqual([]);
  });

  test("refuses continuation when persisted-context load is inverted", async () => {
    const definition: PipelineDefinition = {
      name: "p",
      stages: [
        { stageId: "s1", kind: "workflow", workflow: "intent", review: "none" },
        { stageId: "s2", kind: "workflow", workflow: "plan", review: "none" },
      ],
    };
    const { store } = fakeStore(
      definition,
      {},
      {
        pipelineStatus: "interrupted",
        stageOverrides: { s1: { status: "succeeded", artifact: { specPath: "spec/s1.md" } } },
      },
    );

    const dispatchOrder: number[] = [];
    const continuation = continueDurablePipeline(PIPELINE_ID, {
      store,
      dispatch: async (steps) => {
        dispatchOrder.push(stageIndexOf(steps));
        return { ok: true, entryRunId: "run-1", invocationId: "inv-1" };
      },
      wait: async () => "completed",
      resolveStage: resolveStageStub(),
      loadPersistedContext: false,
    });

    expect(continuation.claim).toEqual({ outcome: "refused", reason: "missing-context" });
    await continuation.run;
    expect(dispatchOrder).toEqual([]);
  });

  test("refuses continuation when the continuation-claim guard is inverted", async () => {
    const definition: PipelineDefinition = {
      name: "p",
      stages: [
        { stageId: "s1", kind: "workflow", workflow: "intent", review: "none" },
        { stageId: "s2", kind: "workflow", workflow: "plan", review: "none" },
      ],
    };
    const { store } = fakeStore(
      definition,
      {},
      {
        pipelineStatus: "interrupted",
        stageOverrides: { s1: { status: "succeeded", artifact: { specPath: "spec/s1.md" } } },
      },
    );

    const dispatchOrder: number[] = [];
    const continuation = continueDurablePipeline(PIPELINE_ID, {
      store,
      dispatch: async (steps) => {
        dispatchOrder.push(stageIndexOf(steps));
        return { ok: true, entryRunId: "run-1", invocationId: "inv-1" };
      },
      wait: async () => "completed",
      resolveStage: resolveStageStub(),
      claimContinuation: false,
    });

    expect(continuation.claim).toEqual({ outcome: "refused", reason: "claim-refused" });
    await continuation.run;
    expect(dispatchOrder).toEqual([]);
  });

  test("survives closing and reopening the store before continuation", async () => {
    const dbPath = join(tmpdir(), `jarvis-pipeline-continuation-${process.pid}-${crypto.randomUUID()}.sqlite`);
    const definition: PipelineDefinition = {
      name: "restart-pipeline",
      stages: [
        { stageId: "s1", kind: "workflow", workflow: "intent", review: "none" },
        { stageId: "s2", kind: "workflow", workflow: "plan", review: "none" },
      ],
    };
    const context: PipelineContext = { cwd: "/repo", seed: "seed text", targetDir: "v2/spec" };

    const admittingStore = openStateStore(dbPath, { currentIdentity: "prior:1" });
    const pipelineId = admittingStore.createPipeline({ definition, context });
    admittingStore.updateStage({
      pipelineId,
      stageId: "s1",
      patch: { status: "succeeded", artifact: { specPath: "spec/s1.md" } },
    });
    const raw = new Database(dbPath);
    raw.prepare("UPDATE pipelines SET status = 'interrupted' WHERE id = ?").run(pipelineId);
    raw.close();
    admittingStore.close();

    const restartedStore = openStateStore(dbPath, { currentIdentity: "daemon:2" });
    const dispatchOrder: number[] = [];
    const continuation = continueDurablePipeline(pipelineId, {
      store: restartedStore,
      dispatch: async (steps) => {
        dispatchOrder.push(stageIndexOf(steps));
        const runId = restartedStore.createRun({
          project: "jarvis",
          specRef: "spec",
          worktreePath: "/repo/.worktree",
          branch: "feature",
          specPath: "spec/s2.md",
          status: "completed",
        });
        return { ok: true, entryRunId: runId, invocationId: "inv-1" };
      },
      wait: async () => "completed",
      resolveStage: resolveStageStub(),
    });

    expect(continuation.claim).toEqual({ outcome: "applied" });
    await continuation.run;

    expect(dispatchOrder).toEqual([1]);
    const pipeline = restartedStore.loadPipeline(pipelineId);
    expect(pipeline?.status).toBe("active");
    expect(pipeline?.ownerIdentity).toBe("daemon:2");
    expect(pipeline?.context).toEqual(context);
    expect(pipeline?.stages.find((stage) => stage.stageId === "s2")?.status).toBe("succeeded");
    restartedStore.close();
  });
});

describe("activateDurablePipeline", () => {
  const approvalGateDefinition: PipelineDefinition = {
    name: "p",
    stages: [
      { stageId: "s1", kind: "workflow", workflow: "intent", review: "none" },
      { stageId: "gate", kind: "approval" },
      { stageId: "s3", kind: "workflow", workflow: "plan", review: "none" },
    ],
  };

  test("after restart reconciliation activates an approved gate and dispatches only its eligible suffix under one owner", async () => {
    const { store, stages } = fakeStore(
      approvalGateDefinition,
      { "run-2": { specPath: "spec/s3.md" } },
      {
        pipelineStatus: "interrupted",
        stageOverrides: {
          s1: { status: "succeeded", artifact: { specPath: "spec/s1.md" } },
          gate: { status: "approved" },
        },
      },
    );

    const dispatchOrder: number[] = [];
    const activation = activateDurablePipeline(PIPELINE_ID, {
      store,
      dispatch: async (steps) => {
        dispatchOrder.push(stageIndexOf(steps));
        return { ok: true, entryRunId: "run-2", invocationId: "inv-2" };
      },
      wait: async () => "completed",
      resolveStage: resolveStageStub(),
    });

    expect(activation.eligibility).toEqual({ eligible: true, reason: "approved-continuation" });
    expect(activation.claim).toEqual({ outcome: "applied" });
    await activation.run;

    expect(dispatchOrder).toEqual([2]);
    expect(stages().find((s) => s.stageId === "gate")?.status).toBe("approved");
    expect(stages().find((s) => s.stageId === "s3")?.status).toBe("succeeded");
    const pipeline = store.loadPipeline(PIPELINE_ID);
    expect(pipeline?.status).toBe("active");
    expect(pipeline?.ownerIdentity).toBe(CURRENT_IDENTITY);
  });

  test("activates an approved gate on an active pipeline owned by this daemon without requiring interrupted status", async () => {
    const { store, stages } = fakeStore(
      approvalGateDefinition,
      { "run-2": { specPath: "spec/s3.md" } },
      {
        pipelineStatus: "active",
        ownerIdentity: CURRENT_IDENTITY,
        stageOverrides: {
          s1: { status: "succeeded", artifact: { specPath: "spec/s1.md" } },
          gate: { status: "approved" },
        },
      },
    );

    const dispatchOrder: number[] = [];
    const activation = activateDurablePipeline(PIPELINE_ID, {
      store,
      dispatch: async (steps) => {
        dispatchOrder.push(stageIndexOf(steps));
        return { ok: true, entryRunId: "run-2", invocationId: "inv-2" };
      },
      wait: async () => "completed",
      resolveStage: resolveStageStub(),
    });

    expect(activation.eligibility).toEqual({ eligible: true, reason: "approved-continuation" });
    expect(activation.claim).toEqual({ outcome: "applied" });
    await activation.run;

    expect(dispatchOrder).toEqual([2]);
    expect(stages().find((s) => s.stageId === "s3")?.status).toBe("succeeded");
    expect(store.loadPipeline(PIPELINE_ID)?.status).toBe("active");
  });

  test("does not activate an awaiting or rejected approval after restart reconciliation", async () => {
    for (const gateStatus of ["awaiting", "rejected"] as const) {
      const { store, stages } = fakeStore(
        approvalGateDefinition,
        { "run-0": { specPath: "spec/s1.md" } },
        {
          pipelineStatus: "interrupted",
          stageOverrides: {
            s1: { status: "succeeded", artifact: { specPath: "spec/s1.md" } },
            gate: { status: gateStatus },
          },
        },
      );
      const before = stages().map((stage) => ({ ...stage }));

      const dispatchOrder: number[] = [];
      const activation = activateDurablePipeline(PIPELINE_ID, {
        store,
        dispatch: async (steps) => {
          dispatchOrder.push(stageIndexOf(steps));
          return { ok: true, entryRunId: "run-0", invocationId: "inv-0" };
        },
        wait: async () => "completed",
        resolveStage: resolveStageStub(),
      });

      expect(activation.eligibility.eligible).toBe(false);
      expect(activation.claim).toEqual({ outcome: "refused", reason: "claim-refused" });
      await activation.run;
      expect(dispatchOrder).toEqual([]);
      expect(stages()).toEqual(before);
      expect(store.loadPipeline(PIPELINE_ID)?.status).toBe("interrupted");
    }
  });

  test("after an applied reopen dispatches only the reopened failed stage and preserves predecessor evidence", async () => {
    const definition: PipelineDefinition = {
      name: "p",
      stages: [
        { stageId: "s1", kind: "workflow", workflow: "intent", review: "none" },
        { stageId: "s2", kind: "workflow", workflow: "plan", review: "none" },
        { stageId: "s3", kind: "workflow", workflow: "implement", review: "light" },
      ],
    };
    const predecessorArtifact = { specPath: "spec/s1.md", invocationId: "inv-0" };
    const { store, stages } = fakeStore(
      definition,
      { "run-1": { specPath: "spec/s2.md" } },
      {
        pipelineStatus: "interrupted",
        stageOverrides: {
          s1: {
            status: "succeeded",
            artifact: predecessorArtifact,
            workflowInvocationId: "inv-0",
          },
          s2: { status: "pending" },
          s3: { status: "pending" },
        },
      },
    );

    const dispatchOrder: number[] = [];
    const activation = activateDurablePipeline(PIPELINE_ID, {
      store,
      dispatch: async (steps) => {
        dispatchOrder.push(stageIndexOf(steps));
        return { ok: true, entryRunId: "run-1", invocationId: "inv-1" };
      },
      wait: async () => "failed" as RunStatus,
      resolveStage: resolveStageStub(),
    });

    expect(activation.eligibility).toEqual({ eligible: true, reason: "reopened-continuation" });
    expect(activation.claim).toEqual({ outcome: "applied" });
    await activation.run;

    expect(dispatchOrder).toEqual([1]);
    const s1 = stages().find((stage) => stage.stageId === "s1");
    expect(s1?.status).toBe("succeeded");
    expect(s1?.artifact).toEqual(predecessorArtifact);
    expect(s1?.workflowInvocationId).toBe("inv-0");
    expect(stages().find((stage) => stage.stageId === "s2")?.status).toBe("failed");
    expect(stages().find((stage) => stage.stageId === "s3")?.status).toBe("skipped");
  });

  test("refuses activation when no eligible continuation remains after the first activation settles", async () => {
    const { store, stages } = fakeStore(
      approvalGateDefinition,
      { "run-2": { specPath: "spec/s3.md" } },
      {
        pipelineStatus: "interrupted",
        stageOverrides: {
          s1: { status: "succeeded", artifact: { specPath: "spec/s1.md" } },
          gate: { status: "approved" },
        },
      },
    );

    const dispatchOrder: number[] = [];
    const dispatch: PipelineWorkflowDispatch = async (steps) => {
      dispatchOrder.push(stageIndexOf(steps));
      return { ok: true, entryRunId: "run-2", invocationId: "inv-2" };
    };
    const deps = {
      store,
      dispatch,
      wait: async () => "completed" as RunStatus,
      resolveStage: resolveStageStub(),
    };

    const first = activateDurablePipeline(PIPELINE_ID, deps);
    expect(first.claim).toEqual({ outcome: "applied" });
    await first.run;

    const second = activateDurablePipeline(PIPELINE_ID, deps);
    expect(second.eligibility).toEqual({ eligible: false, reason: "no-continuation" });
    expect(second.claim).toEqual({ outcome: "refused", reason: "claim-refused" });
    await second.run;

    expect(dispatchOrder).toEqual([2]);
    expect(stages().find((stage) => stage.stageId === "s3")?.status).toBe("succeeded");
  });

  test("inverting activation eligibility lets awaiting pipelines claim without dispatching the suffix", async () => {
    const { store, stages } = fakeStore(
      approvalGateDefinition,
      {},
      {
        pipelineStatus: "interrupted",
        stageOverrides: {
          s1: { status: "succeeded", artifact: { specPath: "spec/s1.md" } },
          gate: { status: "awaiting" },
        },
      },
    );

    const dispatchOrder: number[] = [];
    const guarded = activateDurablePipeline(PIPELINE_ID, {
      store,
      dispatch: async (steps) => {
        dispatchOrder.push(stageIndexOf(steps));
        return { ok: true, entryRunId: "run-2", invocationId: "inv-2" };
      },
      wait: async () => "completed",
      resolveStage: resolveStageStub(),
    });
    expect(guarded.claim).toEqual({ outcome: "refused", reason: "claim-refused" });
    await guarded.run;
    expect(dispatchOrder).toEqual([]);
    expect(store.loadPipeline(PIPELINE_ID)?.status).toBe("interrupted");

    const inverted = activateDurablePipeline(PIPELINE_ID, {
      store,
      dispatch: async (steps) => {
        dispatchOrder.push(stageIndexOf(steps));
        return { ok: true, entryRunId: "run-2", invocationId: "inv-2" };
      },
      wait: async () => "completed",
      resolveStage: resolveStageStub(),
      checkActivationEligibility: false,
    });
    expect(inverted.claim).toEqual({ outcome: "applied" });
    await inverted.run;
    expect(dispatchOrder).toEqual([]);
    expect(stages().find((stage) => stage.stageId === "s3")?.status).toBe("pending");
    expect(store.loadPipeline(PIPELINE_ID)?.status).toBe("active");
  });

  test("inverting the continuation-claim guard refuses activation without dispatch", async () => {
    const { store } = fakeStore(
      approvalGateDefinition,
      { "run-2": { specPath: "spec/s3.md" } },
      {
        pipelineStatus: "interrupted",
        stageOverrides: {
          s1: { status: "succeeded", artifact: { specPath: "spec/s1.md" } },
          gate: { status: "approved" },
        },
      },
    );

    const dispatchOrder: number[] = [];
    const activation = activateDurablePipeline(PIPELINE_ID, {
      store,
      dispatch: async (steps) => {
        dispatchOrder.push(stageIndexOf(steps));
        return { ok: true, entryRunId: "run-2", invocationId: "inv-2" };
      },
      wait: async () => "completed",
      resolveStage: resolveStageStub(),
      claimContinuation: false,
    });

    expect(activation.claim).toEqual({ outcome: "refused", reason: "claim-refused" });
    await activation.run;
    expect(dispatchOrder).toEqual([]);
  });

  test("survives closing and reopening the store before approved activation", async () => {
    const dbPath = join(tmpdir(), `jarvis-pipeline-activation-${process.pid}-${crypto.randomUUID()}.sqlite`);
    const context: PipelineContext = { cwd: "/repo", seed: "seed text", targetDir: "v2/spec" };

    const admittingStore = openStateStore(dbPath, { currentIdentity: "prior:1" });
    const pipelineId = admittingStore.createPipeline({ definition: approvalGateDefinition, context });
    admittingStore.updateStage({
      pipelineId,
      stageId: "s1",
      patch: { status: "succeeded", artifact: { specPath: "spec/s1.md" } },
    });
    admittingStore.updateStage({ pipelineId, stageId: "gate", patch: { status: "approved" } });
    const raw = new Database(dbPath);
    raw.prepare("UPDATE pipelines SET status = 'interrupted' WHERE id = ?").run(pipelineId);
    raw.close();
    admittingStore.close();

    const restartedStore = openStateStore(dbPath, { currentIdentity: "daemon:2" });
    const dispatchOrder: number[] = [];
    const activation = activateDurablePipeline(pipelineId, {
      store: restartedStore,
      dispatch: async (steps) => {
        dispatchOrder.push(stageIndexOf(steps));
        const runId = restartedStore.createRun({
          project: "jarvis",
          specRef: "spec",
          worktreePath: "/repo/.worktree",
          branch: "feature",
          specPath: "spec/s3.md",
          status: "completed",
        });
        return { ok: true, entryRunId: runId, invocationId: "inv-2" };
      },
      wait: async () => "completed",
      resolveStage: resolveStageStub(),
    });

    expect(activation.eligibility).toEqual({ eligible: true, reason: "approved-continuation" });
    expect(activation.claim).toEqual({ outcome: "applied" });
    await activation.run;

    expect(dispatchOrder).toEqual([2]);
    const pipeline = restartedStore.loadPipeline(pipelineId);
    expect(pipeline?.status).toBe("active");
    expect(pipeline?.ownerIdentity).toBe("daemon:2");
    expect(pipeline?.stages.find((stage) => stage.stageId === "s3")?.status).toBe("succeeded");
    restartedStore.close();
  });
});

describe("analyzePipelineActivationEligibility", () => {
  test("reports approved-continuation, awaiting-approval, and rejected-approval from stage rows", () => {
    const definition: PipelineDefinition = {
      name: "p",
      stages: [
        { stageId: "s1", kind: "workflow", workflow: "intent", review: "none" },
        { stageId: "gate", kind: "approval" },
        { stageId: "s3", kind: "workflow", workflow: "plan", review: "none" },
      ],
    };
    const base = {
      id: PIPELINE_ID,
      name: definition.name,
      createdAt: 0,
      ownerIdentity: null,
      status: "interrupted" as const,
      definition,
      context: baseContext,
    };

    expect(
      analyzePipelineActivationEligibility({
        ...base,
        stages: [
          {
            id: "r0",
            pipelineId: PIPELINE_ID,
            stageId: "s1",
            position: 0,
            status: "succeeded",
            workflowInvocationId: null,
            startedAt: null,
            endedAt: null,
            artifact: null,
            failureDetail: null,
          },
          {
            id: "r1",
            pipelineId: PIPELINE_ID,
            stageId: "gate",
            position: 1,
            status: "approved",
            workflowInvocationId: null,
            startedAt: null,
            endedAt: null,
            artifact: null,
            failureDetail: null,
          },
          {
            id: "r2",
            pipelineId: PIPELINE_ID,
            stageId: "s3",
            position: 2,
            status: "pending",
            workflowInvocationId: null,
            startedAt: null,
            endedAt: null,
            artifact: null,
            failureDetail: null,
          },
        ],
      }),
    ).toEqual({ eligible: true, reason: "approved-continuation" });

    expect(
      analyzePipelineActivationEligibility({
        ...base,
        stages: [
          {
            id: "r0",
            pipelineId: PIPELINE_ID,
            stageId: "s1",
            position: 0,
            status: "succeeded",
            workflowInvocationId: null,
            startedAt: null,
            endedAt: null,
            artifact: null,
            failureDetail: null,
          },
          {
            id: "r1",
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
            id: "r2",
            pipelineId: PIPELINE_ID,
            stageId: "s3",
            position: 2,
            status: "pending",
            workflowInvocationId: null,
            startedAt: null,
            endedAt: null,
            artifact: null,
            failureDetail: null,
          },
        ],
      }),
    ).toEqual({ eligible: false, reason: "awaiting-approval" });

    expect(
      analyzePipelineActivationEligibility({
        ...base,
        stages: [
          {
            id: "r0",
            pipelineId: PIPELINE_ID,
            stageId: "s1",
            position: 0,
            status: "succeeded",
            workflowInvocationId: null,
            startedAt: null,
            endedAt: null,
            artifact: null,
            failureDetail: null,
          },
          {
            id: "r1",
            pipelineId: PIPELINE_ID,
            stageId: "gate",
            position: 1,
            status: "rejected",
            workflowInvocationId: null,
            startedAt: null,
            endedAt: null,
            artifact: null,
            failureDetail: null,
          },
          {
            id: "r2",
            pipelineId: PIPELINE_ID,
            stageId: "s3",
            position: 2,
            status: "skipped",
            workflowInvocationId: null,
            startedAt: null,
            endedAt: null,
            artifact: null,
            failureDetail: null,
          },
        ],
      }),
    ).toEqual({ eligible: false, reason: "rejected-approval" });
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

  test("reports awaiting-approval only when the next gate reads awaiting", () => {
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

  test("reports failed when any approval row reads rejected", () => {
    const definition: PipelineDefinition = {
      name: "p",
      stages: [
        { stageId: "s1", kind: "workflow", workflow: "intent", review: "none" },
        { stageId: "gate", kind: "approval" },
        { stageId: "s3", kind: "workflow", workflow: "plan", review: "none" },
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
        status: stage.stageId === "s1" ? "succeeded" : stage.stageId === "gate" ? "rejected" : "skipped",
        workflowInvocationId: null,
        startedAt: null,
        endedAt: null,
        artifact: null,
        failureDetail: null,
      })),
    };
    expect(derivePipelineState(pipeline)).toBe("failed");
  });

  test("reports pending when an approval gate has not yet been reached", () => {
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
    expect(derivePipelineState(pipeline)).toBe("pending");
  });

  test("reports succeeded when every stage including an approved gate has passed", () => {
    const definition: PipelineDefinition = {
      name: "p",
      stages: [
        { stageId: "s1", kind: "workflow", workflow: "intent", review: "none" },
        { stageId: "gate", kind: "approval" },
        { stageId: "s3", kind: "workflow", workflow: "plan", review: "none" },
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
        status: stage.stageId === "gate" ? "approved" : stage.stageId === "s3" ? "succeeded" : "succeeded",
        workflowInvocationId: null,
        startedAt: null,
        endedAt: null,
        artifact: null,
        failureDetail: null,
      })),
    };
    expect(derivePipelineState(pipeline)).toBe("succeeded");
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
