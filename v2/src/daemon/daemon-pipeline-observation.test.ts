import { Database } from "bun:sqlite";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { InvocationResult } from "../../../shared/invocation/execute.ts";
import type { PipelineDefinition } from "../execution/pipeline-definition.ts";
import type { AnyWorkflowStep, WriteWorkflowStep } from "../execution/workflow-runner.ts";
import { openStateStore, type Pipeline, type PipelineStageRecord, type StateStore } from "../persistence/state-store.ts";
import { flushBackgroundRuns } from "../testing/run-control.ts";
import {
  createBindingFactory,
  doneWithArtifactBindingFactory,
  writeStepFixtures,
} from "../testing/workflow-step-fixtures.ts";
import { createFakeWriteLoopExecutor, type FakeWriteLoopExecutor } from "../testing/write-loop-executor.ts";
import { createRunControlHandlers } from "./daemon.ts";
import { derivePipelineState, isPipelineTerminal, type PipelineDerivedState } from "./pipeline-execution.ts";
import {
  derivePipelineBoundary,
  PIPELINE_WAIT_ABORTED,
  PipelineWaitObserver,
  projectPipelineSnapshot,
  waitForPipelineBoundary,
} from "./pipeline-observation.ts";

const { createWriteStep } = writeStepFixtures();

const THREE_STAGE_DEFINITION: PipelineDefinition = {
  name: "sample-pipeline",
  stages: [
    { stageId: "plan", kind: "workflow", workflow: "plan", review: "none" },
    { stageId: "gate", kind: "approval" },
    { stageId: "implement", kind: "workflow", workflow: "implement", review: "light" },
  ],
};

const WORKFLOW_ONLY: PipelineDefinition = {
  name: "workflow-only",
  stages: [
    { stageId: "s1", kind: "workflow", workflow: "intent", review: "none" },
    { stageId: "s2", kind: "workflow", workflow: "plan", review: "none" },
  ],
};

const WITH_APPROVAL: PipelineDefinition = {
  name: "with-approval",
  stages: [
    { stageId: "s1", kind: "workflow", workflow: "intent", review: "none" },
    { stageId: "gate", kind: "approval" },
  ],
};

const SINGLE_WORKFLOW = (name: string): PipelineDefinition => ({
  name,
  stages: [{ stageId: "s1", kind: "workflow", workflow: "intent", review: "none" }],
});

const PIPELINE_CONTEXT = { cwd: "/fake", seed: "seed text" } as const;

function handlers(overrides: Partial<Parameters<typeof createRunControlHandlers>[0]> = {}) {
  return createRunControlHandlers({
    stateStore,
    writeLoopExecutor: fakeExecutor.executor,
    failureReporter: () => {},
    hasMemoryHeadroom: () => true,
    ...overrides,
  });
}

function requestFrame(id: string, method: string, params?: unknown) {
  return { kind: "request" as const, id, method, params };
}

function controllableBindingFactory(): {
  factory: NonNullable<WriteWorkflowStep["createBinding"]>;
  settle: () => void;
} {
  let settleFn: (() => void) | undefined;
  const factory = createBindingFactory(
    ({ cwd }) =>
      new Promise<InvocationResult>((resolve) => {
        settleFn = () => {
          writeFileSync(join(cwd, "proof.txt"), "done\n", "utf8");
          resolve({ kind: "ok", stdout: "done", stderr: "" } as const);
        };
      }),
  );
  return { factory, settle: () => settleFn?.() };
}

async function pipelineWaitDirect(
  h: ReturnType<typeof handlers>,
  id: string,
  pipelineId: string,
  signal = new AbortController().signal,
) {
  return h.pipeline_wait(requestFrame(id, "pipeline_wait", { pipelineId }), signal);
}

async function waitFor(predicate: () => boolean | Promise<boolean>, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate()) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 5));
}

function pipelineWithStages(
  definition: PipelineDefinition,
  statuses: Record<string, Partial<PipelineStageRecord>>,
  pipelineOverrides: Partial<Pipeline> = {},
): Pipeline & { stages: PipelineStageRecord[] } {
  const pipelineId = pipelineOverrides.id ?? "pipeline-1";
  return {
    id: pipelineId,
    name: definition.name,
    createdAt: 0,
    ownerIdentity: null,
    status: pipelineOverrides.status ?? "active",
    definition,
    ...pipelineOverrides,
    stages: definition.stages.map((stage, index) => ({
      id: `row-${index}`,
      pipelineId,
      stageId: stage.stageId,
      position: index,
      status: statuses[stage.stageId]?.status ?? "pending",
      workflowInvocationId: statuses[stage.stageId]?.workflowInvocationId ?? null,
      startedAt: statuses[stage.stageId]?.startedAt ?? null,
      endedAt: statuses[stage.stageId]?.endedAt ?? null,
      artifact: statuses[stage.stageId]?.artifact ?? null,
      failureDetail: statuses[stage.stageId]?.failureDetail ?? null,
    })),
  };
}

let stateStore: StateStore;
let fakeExecutor: FakeWriteLoopExecutor;

beforeEach(() => {
  stateStore = openStateStore(join(tmpdir(), `jarvis-pipeline-obs-${process.pid}-${Date.now()}-${Math.random()}.db`));
  fakeExecutor = createFakeWriteLoopExecutor();
});

afterEach(async () => {
  fakeExecutor.abortAll();
  await flushBackgroundRuns();
  try {
    stateStore.close();
  } catch {
    // already closed
  }
});

test("pipeline_list returns an empty pipelines array for an empty store", async () => {
  const response = await handlers().pipeline_list(requestFrame("l0", "pipeline_list"), new AbortController().signal);
  expect(response.kind).toBe("response");
  expect((response as { result: { pipelines: unknown[] } }).result.pipelines).toEqual([]);
});

test("pipeline_list reports every admitted pipeline with identity, derived state, and ordered stage projection", async () => {
  const pipelineId = stateStore.createPipeline({ definition: THREE_STAGE_DEFINITION });
  stateStore.updateStage({
    pipelineId,
    stageId: "plan",
    patch: { status: "succeeded", workflowInvocationId: "inv-plan" },
  });
  stateStore.updateStage({ pipelineId, stageId: "gate", patch: { status: "awaiting" } });

  const response = await handlers().pipeline_list(requestFrame("l1", "pipeline_list"), new AbortController().signal);
  expect(response.kind).toBe("response");
  const pipelines = (response as { result: { pipelines: Array<Record<string, unknown>> } }).result.pipelines;
  expect(pipelines).toHaveLength(1);
  expect(pipelines[0]).toEqual({
    pipelineId,
    name: "sample-pipeline",
    state: "awaiting-approval",
    stages: [
      { stageId: "plan", status: "succeeded", workflowInvocationId: "inv-plan" },
      { stageId: "gate", status: "awaiting", workflowInvocationId: null },
      { stageId: "implement", status: "pending", workflowInvocationId: null },
    ],
  });
});

test("pipeline_list distinguishes all derived states and classifies only terminal states as terminal", () => {
  const cases: Array<{ pipeline: Pipeline & { stages: PipelineStageRecord[] }; state: PipelineDerivedState }> = [
    { pipeline: pipelineWithStages(WORKFLOW_ONLY, {}), state: "pending" },
    {
      pipeline: pipelineWithStages(WORKFLOW_ONLY, { s1: { status: "succeeded" }, s2: { status: "running" } }),
      state: "running",
    },
    {
      pipeline: pipelineWithStages(WORKFLOW_ONLY, { s1: { status: "succeeded" }, s2: { status: "succeeded" } }),
      state: "succeeded",
    },
    {
      pipeline: pipelineWithStages(WORKFLOW_ONLY, { s1: { status: "succeeded" }, s2: { status: "failed" } }),
      state: "failed",
    },
    {
      pipeline: pipelineWithStages(WITH_APPROVAL, { s1: { status: "succeeded" }, gate: { status: "awaiting" } }),
      state: "awaiting-approval",
    },
    {
      pipeline: pipelineWithStages(WITH_APPROVAL, { s1: { status: "succeeded" }, gate: { status: "rejected" } }),
      state: "rejected",
    },
    {
      pipeline: pipelineWithStages(
        WORKFLOW_ONLY,
        { s1: { status: "interrupted" } },
        { status: "active" },
      ),
      state: "interrupted",
    },
    {
      pipeline: pipelineWithStages(WORKFLOW_ONLY, {}, { status: "interrupted" }),
      state: "interrupted",
    },
  ];

  const observed = new Set<PipelineDerivedState>();
  for (const { pipeline, state } of cases) {
    expect(derivePipelineState(pipeline)).toBe(state);
    expect(projectPipelineSnapshot(pipeline).state).toBe(state);
    observed.add(state);
    expect(isPipelineTerminal(state)).toBe(
      state === "succeeded" || state === "failed" || state === "rejected" || state === "interrupted",
    );
  }

  expect(observed).toEqual(
    new Set<PipelineDerivedState>([
      "pending",
      "running",
      "awaiting-approval",
      "succeeded",
      "failed",
      "rejected",
      "interrupted",
    ]),
  );
});

test("pipeline_list preserves authored stage order from durable position, not insertion order", () => {
  const pipelineId = stateStore.createPipeline({ definition: THREE_STAGE_DEFINITION });
  const dbPath = (stateStore as unknown as { db: Database }).db.filename as string;
  const raw = new Database(dbPath);
  try {
    raw.prepare("UPDATE pipeline_stages SET position = 99 WHERE pipeline_id = ? AND stage_id = 'plan'").run(pipelineId);
    raw
      .prepare("UPDATE pipeline_stages SET position = -1 WHERE pipeline_id = ? AND stage_id = 'implement'")
      .run(pipelineId);
  } finally {
    raw.close();
  }

  const pipeline = stateStore.loadPipeline(pipelineId);
  if (!pipeline) throw new Error("expected pipeline");
  expect(projectPipelineSnapshot(pipeline).stages.map((stage) => stage.stageId)).toEqual([
    "implement",
    "gate",
    "plan",
  ]);
});

test("derivePipelineState walks durable position order, not definition array index", () => {
  const pipelineId = stateStore.createPipeline({ definition: THREE_STAGE_DEFINITION });
  stateStore.updateStage({
    pipelineId,
    stageId: "plan",
    patch: { status: "succeeded", workflowInvocationId: "inv-plan" },
  });
  stateStore.updateStage({ pipelineId, stageId: "gate", patch: { status: "awaiting" } });

  const dbPath = (stateStore as unknown as { db: Database }).db.filename as string;
  const raw = new Database(dbPath);
  try {
    raw.prepare("UPDATE pipeline_stages SET position = position + 100 WHERE pipeline_id = ?").run(pipelineId);
    raw
      .prepare(
        `UPDATE pipeline_stages SET position = CASE stage_id
          WHEN 'implement' THEN 0
          WHEN 'gate' THEN 1
          WHEN 'plan' THEN 2
          ELSE position END
        WHERE pipeline_id = ?`,
      )
      .run(pipelineId);
  } finally {
    raw.close();
  }

  const pipeline = stateStore.loadPipeline(pipelineId);
  if (!pipeline) throw new Error("expected pipeline");
  expect(derivePipelineState(pipeline)).toBe("pending");
  expect(derivePipelineBoundary(pipeline)).toBeNull();
});

test("live pipeline_list completes within its bound while a pipeline remains non-terminal and reports the durable running state", async () => {
  const stage1 = controllableBindingFactory();
  const stage1Step: AnyWorkflowStep = createWriteStep("stage-1", "pipeline-branch", stage1.factory, {
    suppressShrink: true,
  });
  const stage2Step: AnyWorkflowStep = createWriteStep("stage-2", "pipeline-branch", doneWithArtifactBindingFactory, {
    suppressShrink: true,
  });

  const h = handlers({
    resolveStage: async (_definition, stageIndex) => ({
      ok: true,
      steps: [stageIndex === 0 ? stage1Step : stage2Step],
    }),
  });

  const startResponse = await h.pipeline_start(
    requestFrame("p1", "pipeline_start", { definition: WORKFLOW_ONLY, context: PIPELINE_CONTEXT }),
    new AbortController().signal,
  );
  const pipelineId = (startResponse as { result: { pipelineId: string } }).result.pipelineId;

  await waitFor(
    () => stateStore.loadPipeline(pipelineId)?.stages.find((stage) => stage.stageId === "s1")?.status === "running",
  );

  const startedAt = Date.now();
  const listResponse = await h.pipeline_list(requestFrame("l2", "pipeline_list"), new AbortController().signal);
  expect(Date.now() - startedAt).toBeLessThan(500);
  expect(listResponse.kind).toBe("response");

  const snapshot = (listResponse as { result: { pipelines: Array<{ pipelineId: string; state: string }> } }).result
    .pipelines.find((pipeline) => pipeline.pipelineId === pipelineId);
  expect(snapshot?.state).toBe("running");

  stage1.settle();
  await waitFor(
    () => stateStore.loadPipeline(pipelineId)?.stages.find((stage) => stage.stageId === "s2")?.status === "succeeded",
  );
  await flushBackgroundRuns();
});

test("live snapshot non-follow guard: a running pipeline is not reported as succeeded before settlement", async () => {
  const stage1 = controllableBindingFactory();
  const stage1Step: AnyWorkflowStep = createWriteStep("stage-1", "pipeline-branch", stage1.factory, {
    suppressShrink: true,
  });

  const h = handlers({ resolveStage: async () => ({ ok: true, steps: [stage1Step] }) });

  const startResponse = await h.pipeline_start(
    requestFrame("p2", "pipeline_start", { definition: SINGLE_WORKFLOW("non-follow"), context: PIPELINE_CONTEXT }),
    new AbortController().signal,
  );
  const pipelineId = (startResponse as { result: { pipelineId: string } }).result.pipelineId;
  await waitFor(
    () => stateStore.loadPipeline(pipelineId)?.stages.find((stage) => stage.stageId === "s1")?.status === "running",
  );

  const listResponse = await h.pipeline_list(requestFrame("l3", "pipeline_list"), new AbortController().signal);
  const snapshot = (listResponse as { result: { pipelines: Array<{ state: string }> } }).result.pipelines[0];
  expect(snapshot?.state).toBe("running");
});

test("recovered interruption resumes normal derivation when pipeline row is active and no stage reads interrupted", () => {
  expect(
    derivePipelineState(pipelineWithStages(SINGLE_WORKFLOW("recovered"), { s1: { status: "succeeded" } })),
  ).toBe("succeeded");
});

test("pipeline_wait returns terminal and awaiting-approval boundaries for durable row seeds", async () => {
  const h = handlers();
  const terminalCases: Array<{ definition: PipelineDefinition; statuses: Record<string, Partial<PipelineStageRecord>>; state: PipelineDerivedState; overrides?: Partial<Pipeline> }> = [
    {
      definition: WORKFLOW_ONLY,
      statuses: { s1: { status: "succeeded" }, s2: { status: "succeeded" } },
      state: "succeeded",
    },
    {
      definition: WORKFLOW_ONLY,
      statuses: { s1: { status: "succeeded" }, s2: { status: "failed" } },
      state: "failed",
    },
    {
      definition: WITH_APPROVAL,
      statuses: { s1: { status: "succeeded" }, gate: { status: "rejected" } },
      state: "rejected",
    },
    {
      definition: WORKFLOW_ONLY,
      statuses: { s1: { status: "interrupted" } },
      state: "interrupted",
      overrides: { status: "active" },
    },
    {
      definition: WORKFLOW_ONLY,
      statuses: {},
      state: "interrupted",
      overrides: { status: "interrupted" },
    },
  ];

  for (const [index, { definition, statuses, state, overrides }] of terminalCases.entries()) {
    const pipelineId = stateStore.createPipeline({ definition });
    for (const [stageId, patch] of Object.entries(statuses)) {
      stateStore.updateStage({ pipelineId, stageId, patch });
    }
    if (overrides?.status) {
      const dbPath = (stateStore as unknown as { db: Database }).db.filename as string;
      const raw = new Database(dbPath);
      try {
        raw.prepare("UPDATE pipelines SET status = ? WHERE id = ?").run(overrides.status, pipelineId);
      } finally {
        raw.close();
      }
    }

    const response = await pipelineWaitDirect(h, `w-terminal-${index}`, pipelineId);
    expect(response.kind).toBe("response");
    expect((response as { result: unknown }).result).toEqual({ kind: "terminal", state });
  }

  const approvalPipelineId = stateStore.createPipeline({ definition: WITH_APPROVAL });
  stateStore.updateStage({ pipelineId: approvalPipelineId, stageId: "s1", patch: { status: "succeeded" } });
  stateStore.updateStage({ pipelineId: approvalPipelineId, stageId: "gate", patch: { status: "awaiting" } });

  const approvalResponse = await pipelineWaitDirect(h, "w-approval", approvalPipelineId);
  expect(approvalResponse.kind).toBe("response");
  expect((approvalResponse as { result: unknown }).result).toEqual({
    kind: "awaiting-approval",
    stageId: "gate",
  });
});

test("pipeline_wait returns promptly when the pipeline is already at a boundary", async () => {
  const pipelineId = stateStore.createPipeline({ definition: THREE_STAGE_DEFINITION });
  stateStore.updateStage({ pipelineId, stageId: "plan", patch: { status: "succeeded" } });
  stateStore.updateStage({ pipelineId, stageId: "gate", patch: { status: "awaiting" } });

  const startedAt = Date.now();
  const response = await pipelineWaitDirect(handlers(), "w-immediate", pipelineId);
  expect(Date.now() - startedAt).toBeLessThan(500);
  expect(response.kind).toBe("response");
  expect((response as { result: unknown }).result).toEqual({ kind: "awaiting-approval", stageId: "gate" });
});

test("live pipeline_wait remains pending through pending and running then resolves at the first boundary", async () => {
  const stage1 = controllableBindingFactory();
  const stage1Step: AnyWorkflowStep = createWriteStep("stage-1", "pipeline-branch", stage1.factory, {
    suppressShrink: true,
  });
  const stage2Step: AnyWorkflowStep = createWriteStep("stage-2", "pipeline-branch", doneWithArtifactBindingFactory, {
    suppressShrink: true,
  });

  const h = handlers({
    resolveStage: async (_definition, stageIndex) => ({
      ok: true,
      steps: [stageIndex === 0 ? stage1Step : stage2Step],
    }),
  });

  const startResponse = await h.pipeline_start(
    requestFrame("p-wait", "pipeline_start", { definition: WORKFLOW_ONLY, context: PIPELINE_CONTEXT }),
    new AbortController().signal,
  );
  const pipelineId = (startResponse as { result: { pipelineId: string } }).result.pipelineId;

  const pendingWait = pipelineWaitDirect(h, "w-live", pipelineId);
  let settled = false;
  void pendingWait.then(() => {
    settled = true;
  });

  await waitFor(() => derivePipelineState(stateStore.loadPipeline(pipelineId)!) === "pending");
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(settled).toBe(false);

  await waitFor(
    () => stateStore.loadPipeline(pipelineId)?.stages.find((stage) => stage.stageId === "s1")?.status === "running",
  );
  expect(settled).toBe(false);
  expect(derivePipelineState(stateStore.loadPipeline(pipelineId)!)).toBe("running");

  stage1.settle();
  const response = await pendingWait;
  expect(response.kind).toBe("response");
  expect((response as { result: unknown }).result).toEqual({ kind: "terminal", state: "succeeded" });
  await flushBackgroundRuns();
});

test("pipeline_wait rejects missing and unknown pipeline IDs before observing", async () => {
  const missing = await pipelineWaitDirect(handlers(), "w-missing", "");
  expect(missing).toEqual({ kind: "error", code: "invalid_params", message: "Missing pipelineId" });

  const unknown = await pipelineWaitDirect(handlers(), "w-unknown", "missing-pipeline");
  expect(unknown).toEqual({
    kind: "error",
    code: "unknown_pipeline",
    message: "Pipeline missing-pipeline not found",
  });
});

test("aborting a live pipeline_wait ends without a boundary result", async () => {
  const stage1 = controllableBindingFactory();
  const stage1Step: AnyWorkflowStep = createWriteStep("stage-1", "pipeline-branch", stage1.factory, {
    suppressShrink: true,
  });

  const h = handlers({ resolveStage: async () => ({ ok: true, steps: [stage1Step] }) });

  const startResponse = await h.pipeline_start(
    requestFrame("p-abort", "pipeline_start", { definition: SINGLE_WORKFLOW("abort-wait"), context: PIPELINE_CONTEXT }),
    new AbortController().signal,
  );
  const pipelineId = (startResponse as { result: { pipelineId: string } }).result.pipelineId;
  await waitFor(
    () => stateStore.loadPipeline(pipelineId)?.stages.find((stage) => stage.stageId === "s1")?.status === "running",
  );

  const controller = new AbortController();
  const pending = pipelineWaitDirect(h, "w-abort", pipelineId, controller.signal);
  controller.abort();
  await expect(pending).rejects.toThrow(PIPELINE_WAIT_ABORTED);
});

test("pipeline_wait propagates non-abort failures without masking as aborted", async () => {
  const pipelineId = stateStore.createPipeline({ definition: SINGLE_WORKFLOW("vanish") });
  let loads = 0;
  const vanishingStore = new Proxy(stateStore, {
    get(target, prop, receiver) {
      if (prop === "loadPipeline") {
        return (id: string) => {
          loads += 1;
          if (loads > 2) return null;
          return Reflect.apply(Reflect.get(target, prop, receiver) as (id: string) => unknown, target, [id]);
        };
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });

  const h = handlers({ stateStore: vanishingStore });
  await expect(pipelineWaitDirect(h, "w-vanish", pipelineId)).rejects.toThrow(
    `Pipeline ${pipelineId} not found`,
  );
});

test("waitForPipelineBoundary propagates store errors other than abort", async () => {
  const pipeline = pipelineWithStages(SINGLE_WORKFLOW("wait-error"), { s1: { status: "running" } });
  let loads = 0;
  const store = {
    loadPipeline: () => {
      loads += 1;
      if (loads > 1) return null;
      return pipeline;
    },
  } as unknown as StateStore;
  const observer = new PipelineWaitObserver();

  await expect(
    waitForPipelineBoundary(store, pipeline.id, new AbortController().signal, observer, 10),
  ).rejects.toThrow(`Pipeline ${pipeline.id} not found`);
});

test("awaiting-approval boundary names the first unsatisfied approval stage in position order", () => {
  const pipeline = pipelineWithStages(
    {
      ...WITH_APPROVAL,
      stages: [...WITH_APPROVAL.stages, { stageId: "later", kind: "approval" }],
    },
    { s1: { status: "succeeded" }, gate: { status: "awaiting" }, later: { status: "pending" } },
  );

  expect(derivePipelineBoundary(pipeline)).toEqual({ kind: "awaiting-approval", stageId: "gate" });
});

test("pending and running durable rows yield no wait boundary", () => {
  const pending = pipelineWithStages(SINGLE_WORKFLOW("pending"), {});
  const running = pipelineWithStages(SINGLE_WORKFLOW("running"), { s1: { status: "running" } });

  expect(derivePipelineBoundary(pending)).toBeNull();
  expect(derivePipelineBoundary(running)).toBeNull();
});
