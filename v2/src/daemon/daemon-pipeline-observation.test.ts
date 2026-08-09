import { Database } from "bun:sqlite";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { InvocationResult } from "../../../shared/invocation/execute.ts";
import type { PipelineDefinition } from "../execution/pipeline-definition.ts";
import type { AnyWorkflowStep, WriteWorkflowStep } from "../execution/workflow-runner.ts";
import {
  openStateStore,
  type Pipeline,
  type PipelineStageRecord,
  type StateStore,
} from "../persistence/state-store.ts";
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
  bindPipelineWaitObserver,
  derivePipelineBoundary,
  PIPELINE_WAIT_ABORTED,
  type PipelineSnapshot,
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

const APPROVAL_ONLY: PipelineDefinition = {
  name: "approval-only",
  stages: [{ stageId: "gate", kind: "approval" }],
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

function projectedStage(
  row: Pick<PipelineSnapshot["stages"][number], "stageId" | "branchKey" | "status" | "workflowInvocationId"> &
    Partial<Pick<PipelineSnapshot["stages"][number], "startedAt" | "endedAt">>,
) {
  return expect.objectContaining({ startedAt: null, endedAt: null, decidedAt: null, ...row });
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
    context: pipelineOverrides.context ?? null,
    terminalPublicationFailure: pipelineOverrides.terminalPublicationFailure ?? null,
    terminalPublicationSucceededAt: pipelineOverrides.terminalPublicationSucceededAt ?? null,
    ...pipelineOverrides,
    stages: definition.stages.map((stage, index) => ({
      id: `row-${index}`,
      pipelineId,
      stageId: stage.stageId,
      branchKey: "default",
      position: index,
      status: statuses[stage.stageId]?.status ?? "pending",
      workflowInvocationId: statuses[stage.stageId]?.workflowInvocationId ?? null,
      startedAt: statuses[stage.stageId]?.startedAt ?? null,
      endedAt: statuses[stage.stageId]?.endedAt ?? null,
      artifact: statuses[stage.stageId]?.artifact ?? null,
      failureDetail: statuses[stage.stageId]?.failureDetail ?? null,
      decidedAt: statuses[stage.stageId]?.decidedAt ?? null,
    })),
  };
}

function createApprovalPipelines(): [string, string] {
  return [
    stateStore.createPipeline({ definition: APPROVAL_ONLY }),
    stateStore.createPipeline({ definition: APPROVAL_ONLY }),
  ];
}

function openApprovalGates(pipelineIds: readonly string[]): void {
  for (const pipelineId of pipelineIds) {
    const gate = stateStore.loadPipeline(pipelineId)?.stages[0];
    if (!gate) throw new Error("expected durable gate");
    stateStore.commitApprovalBoundary({ stageRecordId: gate.id });
  }
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

test("pipeline_list preserves the failed-before-start stage from a pre-admission throw", async () => {
  const step = createWriteStep("pre-admission", "pipeline-branch", doneWithArtifactBindingFactory, {
    suppressShrink: true,
  });
  const h = handlers({
    resolveStage: async () => ({ ok: true, steps: [step] }),
    pipelineDispatch: async () => {
      throw new Error("dispatch failed before admission");
    },
    pipelineWait: async () => {
      throw new Error("wait must not run without an admitted entry run");
    },
  });

  const startResponse = await h.pipeline_start(
    requestFrame("p-failed-before-start", "pipeline_start", {
      definition: SINGLE_WORKFLOW("failed-before-start"),
      context: PIPELINE_CONTEXT,
    }),
    new AbortController().signal,
  );
  expect(startResponse.kind).toBe("response");
  const pipelineId = (startResponse as { result: { pipelineId: string } }).result.pipelineId;
  await waitFor(() => stateStore.loadPipeline(pipelineId)?.stages[0]?.status === "failed");

  const stored = stateStore.loadPipeline(pipelineId)?.stages[0];
  if (!stored) throw new Error("expected durable stage");
  const listResponse = await h.pipeline_list(
    requestFrame("l-failed-before-start", "pipeline_list"),
    new AbortController().signal,
  );
  const wire = (
    listResponse as { result: { pipelines: Array<{ pipelineId: string; stages: PipelineSnapshot["stages"] }> } }
  ).result.pipelines.find((pipeline) => pipeline.pipelineId === pipelineId)?.stages[0];
  if (!wire) throw new Error("expected projected stage");

  // @mutate v2/src/daemon/pipeline-stage-dispatch.ts "settleUnexpectedThrow(store, stageTarget, error);" -> "store.updateStage({ ...stageTarget, patch: { status: \"failed\", startedAt: Date.now() } });"
  // @mutate v2/src/daemon/pipeline-observation.ts "endedAt: stage.endedAt," -> "endedAt: null,"
  const storedShape = {
    status: stored.status,
    startedAt: stored.startedAt,
    endedAt: stored.endedAt,
    workflowInvocationId: stored.workflowInvocationId,
  };
  expect(storedShape).toEqual({
    status: "failed",
    startedAt: null,
    endedAt: expect.any(Number),
    workflowInvocationId: null,
  });
  expect({
    status: wire.status,
    startedAt: wire.startedAt,
    endedAt: wire.endedAt,
    workflowInvocationId: wire.workflowInvocationId,
  }).toEqual(storedShape);
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
  const loaded = stateStore.loadPipeline(pipelineId);
  if (!loaded) throw new Error("expected pipeline");
  expect(pipelines[0]).toMatchObject({
    pipelineId,
    name: "sample-pipeline",
    state: "awaiting-approval",
    createdAt: loaded.createdAt,
    finishedAtMs: null,
    boundary: { kind: "awaiting-approval", stageId: "gate", branchKey: "default" },
    stages: [
      projectedStage({
        stageId: "plan",
        branchKey: "default",
        status: "succeeded",
        workflowInvocationId: "inv-plan",
        endedAt: expect.any(Number),
      }),
      projectedStage({ stageId: "gate", branchKey: "default", status: "awaiting", workflowInvocationId: null }),
      projectedStage({ stageId: "implement", branchKey: "default", status: "pending", workflowInvocationId: null }),
    ],
  });
});

test("pipeline_list projects decidedAt for approved and rejected gates", async () => {
  // @mutate v2/src/daemon/pipeline-observation.ts "decidedAt: stage.decidedAt," -> "decidedAt: null,"
  const [approvedPipelineId, rejectedPipelineId] = createApprovalPipelines();
  openApprovalGates([approvedPipelineId, rejectedPipelineId]);

  const h = handlers();
  const approve = await h.pipeline_approve(
    requestFrame("approve-projection", "pipeline_approve", { pipelineId: approvedPipelineId, stageId: "gate" }),
    new AbortController().signal,
  );
  const reject = await h.pipeline_reject(
    requestFrame("reject-projection", "pipeline_reject", { pipelineId: rejectedPipelineId, stageId: "gate" }),
    new AbortController().signal,
  );
  expect(approve.kind).toBe("response");
  expect(reject.kind).toBe("response");

  const approvedGate = stateStore.loadPipeline(approvedPipelineId)?.stages[0];
  const rejectedGate = stateStore.loadPipeline(rejectedPipelineId)?.stages[0];
  if (approvedGate?.decidedAt === null || approvedGate?.decidedAt === undefined) {
    throw new Error("expected approved decision timestamp");
  }
  if (rejectedGate?.decidedAt === null || rejectedGate?.decidedAt === undefined) {
    throw new Error("expected rejected decision timestamp");
  }

  const response = await h.pipeline_list(requestFrame("list-decisions", "pipeline_list"), new AbortController().signal);
  const pipelines = (response as { result: { pipelines: PipelineSnapshot[] } }).result.pipelines;
  const approvedWire = pipelines.find((pipeline) => pipeline.pipelineId === approvedPipelineId)?.stages[0];
  const rejectedWire = pipelines.find((pipeline) => pipeline.pipelineId === rejectedPipelineId)?.stages[0];
  expect(approvedWire?.decidedAt).toBe(approvedGate.decidedAt);
  expect(rejectedWire?.decidedAt).toBe(rejectedGate.decidedAt);
});

test("projectPipelineSnapshot projects stored terminal and admission diagnostics with JSON omission semantics", () => {
  const successId = stateStore.createPipeline({
    definition: { ...WORKFLOW_ONLY, terminalAction: "ready" },
    context: { cwd: "/admission/repo", seedPath: "seeds/intent.md" },
  });
  stateStore.commitTerminalPublicationSuccess({ pipelineId: successId });
  const failureId = stateStore.createPipeline({
    definition: { ...WORKFLOW_ONLY, terminalAction: "merge" },
    context: { cwd: "/admission/repo" },
  });
  stateStore.commitTerminalPublicationFailure({
    pipelineId: failureId,
    terminalAction: "merge",
    failure: { operation: "gh pr merge", message: "merge failed", exitCode: 1 },
  });
  const absentId = stateStore.createPipeline({
    definition: WORKFLOW_ONLY,
    context: { cwd: "/admission/repo" },
  });

  const success = stateStore.loadPipeline(successId);
  const failure = stateStore.loadPipeline(failureId);
  const absent = stateStore.loadPipeline(absentId);
  if (!success || !failure || !absent) throw new Error("expected stored pipelines");

  const successSnapshot = projectPipelineSnapshot(success);
  const failureSnapshot = projectPipelineSnapshot(failure);
  // @mutate v2/src/daemon/pipeline-observation.ts "terminalAction: pipeline.definition.terminalAction," -> "terminalAction: undefined,"
  expect(successSnapshot).toMatchObject({
    terminalAction: "ready",
    seedPath: "seeds/intent.md",
    terminalPublicationSucceededAt: success.terminalPublicationSucceededAt,
    terminalPublicationFailure: null,
  });
  expect(success.terminalPublicationSucceededAt).toBeNumber();
  expect(failureSnapshot).toMatchObject({
    terminalAction: "merge",
    terminalPublicationSucceededAt: null,
    terminalPublicationFailure: {
      terminalAction: "merge",
      failure: { operation: "gh pr merge", message: "merge failed", exitCode: 1 },
    },
  });

  const successWire = JSON.parse(JSON.stringify(successSnapshot)) as Record<string, unknown>;
  const failureWire = JSON.parse(JSON.stringify(failureSnapshot)) as Record<string, unknown>;
  const absentWire = JSON.parse(JSON.stringify(projectPipelineSnapshot(absent))) as Record<string, unknown>;
  expect(successWire).not.toHaveProperty("cwd");
  expect(failureWire).not.toHaveProperty("seedPath");
  expect(absentWire).not.toHaveProperty("terminalAction");
  expect(absentWire).not.toHaveProperty("seedPath");
});

test("projectPipelineSnapshot projects stored stage identity, position, and falsy JSON diagnostics", () => {
  const pipelineId = stateStore.createPipeline({ definition: THREE_STAGE_DEFINITION });
  stateStore.updateStage({ pipelineId, stageId: "plan", patch: { artifact: false, failureDetail: 0 } });
  stateStore.updateStage({ pipelineId, stageId: "gate", patch: { artifact: "", failureDetail: null } });
  stateStore.updateStage({ pipelineId, stageId: "implement", patch: { artifact: null, failureDetail: "" } });
  const pipeline = stateStore.loadPipeline(pipelineId);
  if (!pipeline) throw new Error("expected stored pipeline");
  const [plan, gate, implement] = pipeline.stages;
  if (!plan || !gate || !implement) throw new Error("expected stored stages");

  // @mutate v2/src/daemon/pipeline-observation.ts "artifact: stage.artifact," -> "artifact: null,"
  expect(projectPipelineSnapshot(pipeline).stages).toEqual([
    {
      id: plan.id,
      stageId: "plan",
      branchKey: "default",
      position: 0,
      status: "pending",
      workflowInvocationId: null,
      startedAt: null,
      endedAt: null,
      decidedAt: null,
      artifact: false,
      failureDetail: 0,
    },
    {
      id: gate.id,
      stageId: "gate",
      branchKey: "default",
      position: 1,
      status: "pending",
      workflowInvocationId: null,
      startedAt: null,
      endedAt: null,
      decidedAt: null,
      artifact: "",
      failureDetail: null,
    },
    {
      id: implement.id,
      stageId: "implement",
      branchKey: "default",
      position: 2,
      status: "pending",
      workflowInvocationId: null,
      startedAt: null,
      endedAt: null,
      decidedAt: null,
      artifact: null,
      failureDetail: "",
    },
  ]);
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
      pipeline: pipelineWithStages(WORKFLOW_ONLY, { s1: { status: "interrupted" } }, { status: "active" }),
      state: "interrupted",
    },
    {
      pipeline: pipelineWithStages(WORKFLOW_ONLY, {}, { status: "interrupted" }),
      state: "pending",
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
  expect(projectPipelineSnapshot(pipeline).stages.map(({ stageId, position }) => ({ stageId, position }))).toEqual([
    { stageId: "implement", position: -1 },
    { stageId: "gate", position: 1 },
    { stageId: "plan", position: 99 },
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

  const snapshot = (
    listResponse as { result: { pipelines: Array<{ pipelineId: string; state: string }> } }
  ).result.pipelines.find((pipeline) => pipeline.pipelineId === pipelineId);
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
  expect(derivePipelineState(pipelineWithStages(SINGLE_WORKFLOW("recovered"), { s1: { status: "succeeded" } }))).toBe(
    "succeeded",
  );
});

test("pipeline_wait returns terminal and awaiting-approval boundaries for durable row seeds", async () => {
  const h = handlers();
  const terminalCases: Array<{
    definition: PipelineDefinition;
    statuses: Record<string, Partial<PipelineStageRecord>>;
    state: PipelineDerivedState;
    overrides?: Partial<Pipeline>;
  }> = [
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
    branchKey: "default",
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
  expect((response as { result: unknown }).result).toEqual({
    kind: "awaiting-approval",
    stageId: "gate",
    branchKey: "default",
  });
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

  await waitFor(() => {
    const pipeline = stateStore.loadPipeline(pipelineId);
    return pipeline !== null && derivePipelineState(pipeline) === "pending";
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(settled).toBe(false);

  await waitFor(
    () => stateStore.loadPipeline(pipelineId)?.stages.find((stage) => stage.stageId === "s1")?.status === "running",
  );
  expect(settled).toBe(false);
  const runningPipeline = stateStore.loadPipeline(pipelineId);
  if (!runningPipeline) throw new Error("expected pipeline");
  expect(derivePipelineState(runningPipeline)).toBe("running");

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
  await expect(pipelineWaitDirect(h, "w-vanish", pipelineId)).rejects.toThrow(`Pipeline ${pipelineId} not found`);
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

  await expect(waitForPipelineBoundary(store, pipeline.id, new AbortController().signal, observer, 10)).rejects.toThrow(
    `Pipeline ${pipeline.id} not found`,
  );
});

test("awaiting-approval boundary names the first unsatisfied approval stage in position order", () => {
  const pipeline = pipelineWithStages(
    {
      ...WITH_APPROVAL,
      stages: [...WITH_APPROVAL.stages, { stageId: "later", kind: "approval" }],
    },
    { s1: { status: "succeeded" }, gate: { status: "awaiting" }, later: { status: "pending" } },
  );

  expect(derivePipelineBoundary(pipeline)).toEqual({
    kind: "awaiting-approval",
    stageId: "gate",
    branchKey: "default",
  });
});

test("pending and running durable rows yield no wait boundary", () => {
  const pending = pipelineWithStages(SINGLE_WORKFLOW("pending"), {});
  const running = pipelineWithStages(SINGLE_WORKFLOW("running"), { s1: { status: "running" } });

  expect(derivePipelineBoundary(pending)).toBeNull();
  expect(derivePipelineBoundary(running)).toBeNull();
});

const FAN_OUT_OBS_DEFINITION: PipelineDefinition = {
  name: "fan-out-obs",
  stages: [
    { stageId: "intent", kind: "workflow", workflow: "intent", review: "none" },
    { stageId: "gate", kind: "approval" },
    { stageId: "plan", kind: "workflow", workflow: "plan", review: "none" },
    { stageId: "implement", kind: "workflow", workflow: "implement", review: "light" },
  ],
};

const FAN_OUT_OBS_DOWNSTREAM = ["ready-intents/alpha.md", "ready-intents/beta.md"] as const;

function fanOutObservationPipeline(
  rowStatuses: Record<string, Partial<PipelineStageRecord>>,
): Pipeline & { stages: PipelineStageRecord[] } {
  const pipelineId = "pipeline-fan-out";
  const stages: PipelineStageRecord[] = [
    {
      id: "r-intent",
      pipelineId,
      stageId: "intent",
      branchKey: "default",
      position: 0,
      status: "succeeded",
      workflowInvocationId: "inv-intent",
      startedAt: null,
      endedAt: null,
      artifact: {
        entryRunId: "run-intent",
        specPath: "ready-intents",
        downstreamInputs: [...FAN_OUT_OBS_DOWNSTREAM],
      },
      failureDetail: null,
      decidedAt: null,
    },
  ];

  for (const [stageId, position] of [
    ["gate", 1],
    ["plan", 2],
    ["implement", 3],
  ] as const) {
    for (const branchKey of ["default", "alpha", "beta"] as const) {
      const patch =
        branchKey === "default" ? { status: "skipped" as const } : (rowStatuses[`${stageId}/${branchKey}`] ?? {});
      stages.push({
        id: `r-${stageId}-${branchKey}`,
        pipelineId,
        stageId,
        branchKey,
        position,
        status: patch.status ?? "pending",
        workflowInvocationId: patch.workflowInvocationId ?? null,
        startedAt: patch.startedAt ?? null,
        endedAt: patch.endedAt ?? null,
        artifact: patch.artifact ?? null,
        failureDetail: patch.failureDetail ?? null,
        decidedAt: patch.decidedAt ?? null,
      });
    }
  }

  return {
    id: pipelineId,
    name: FAN_OUT_OBS_DEFINITION.name,
    createdAt: 0,
    ownerIdentity: null,
    status: "active",
    definition: FAN_OUT_OBS_DEFINITION,
    context: null,
    terminalPublicationFailure: null,
    terminalPublicationSucceededAt: null,
    stages,
  };
}

function admitFanOutObservationPipeline(): string {
  const pipelineId = stateStore.createPipeline({ definition: FAN_OUT_OBS_DEFINITION });
  stateStore.updateStage({
    pipelineId,
    stageId: "intent",
    patch: {
      status: "succeeded",
      artifact: {
        entryRunId: "run-intent",
        specPath: "ready-intents",
        downstreamInputs: [...FAN_OUT_OBS_DOWNSTREAM],
      },
    },
  });
  for (const branchKey of ["alpha", "beta"]) {
    for (const stageId of ["gate", "plan", "implement"]) {
      stateStore.createPipelineStageBranch({ pipelineId, stageId, branchKey });
    }
  }
  for (const stageId of ["gate", "plan", "implement"]) {
    stateStore.updateStage({ pipelineId, stageId, branchKey: "default", patch: { status: "skipped" } });
  }
  return pipelineId;
}

test("two-branch pipeline_list projection includes branchKey per durable row", async () => {
  const pipelineId = admitFanOutObservationPipeline();
  stateStore.updateStage({ pipelineId, stageId: "gate", branchKey: "alpha", patch: { status: "awaiting" } });
  stateStore.updateStage({ pipelineId, stageId: "gate", branchKey: "beta", patch: { status: "approved" } });
  stateStore.updateStage({ pipelineId, stageId: "plan", branchKey: "beta", patch: { status: "running" } });

  const response = await handlers().pipeline_list(
    requestFrame("l-fan-out", "pipeline_list"),
    new AbortController().signal,
  );
  const pipelines = (response as { result: { pipelines: Array<Record<string, unknown>> } }).result.pipelines;
  const snapshot = pipelines.find((pipeline) => pipeline.pipelineId === pipelineId) as Pick<
    PipelineSnapshot,
    "boundary" | "stages"
  >;
  expect(snapshot).toBeDefined();
  const stages = snapshot.stages;
  // Mutation checkpoint: omitting branchKey from projectPipelineSnapshot stage projection must turn this test RED.
  // @mutate v2/src/daemon/pipeline-observation.ts "boundary: derivePipelineBoundary(pipeline)," -> "boundary: null,"
  expect(snapshot.boundary).toEqual({ kind: "awaiting-approval", stageId: "gate", branchKey: "alpha" });
  expect(stages.every((row) => typeof row.branchKey === "string" && row.branchKey.length > 0)).toBe(true);
  expect(stages.filter((row) => row.stageId === "gate")).toHaveLength(3);
  expect(stages.filter((row) => row.stageId === "gate" && row.branchKey === "alpha")).toEqual([
    projectedStage({ stageId: "gate", branchKey: "alpha", status: "awaiting", workflowInvocationId: null }),
  ]);
  expect(stages.filter((row) => row.stageId === "gate" && row.branchKey === "beta")).toEqual([
    projectedStage({ stageId: "gate", branchKey: "beta", status: "approved", workflowInvocationId: null }),
  ]);
  expect(stages.filter((row) => row.stageId === "plan" && row.branchKey === "beta")).toEqual([
    projectedStage({ stageId: "plan", branchKey: "beta", status: "running", workflowInvocationId: null }),
  ]);
  expect(new Set(stages.map((row) => row.branchKey)).size).toBeGreaterThan(1);
});

test("projectPipelineSnapshot includes stage startedAt and endedAt from durable records", () => {
  const planStarted = 1_700_000_001_000;
  const planEnded = 1_700_000_002_000;
  const implementStarted = 1_700_000_003_000;
  const pipeline = pipelineWithStages(THREE_STAGE_DEFINITION, {
    plan: { status: "succeeded", startedAt: planStarted, endedAt: planEnded },
    gate: { status: "awaiting" },
    implement: { status: "running", startedAt: implementStarted },
  });

  // Mutation checkpoint: omitting startedAt from stage projection must turn this test RED.
  // Mutation checkpoint: omitting endedAt from stage projection must turn this test RED.
  expect(projectPipelineSnapshot(pipeline).stages).toEqual([
    projectedStage({
      stageId: "plan",
      branchKey: "default",
      status: "succeeded",
      workflowInvocationId: null,
      startedAt: planStarted,
      endedAt: planEnded,
    }),
    projectedStage({ stageId: "gate", branchKey: "default", status: "awaiting", workflowInvocationId: null }),
    projectedStage({
      stageId: "implement",
      branchKey: "default",
      status: "running",
      workflowInvocationId: null,
      startedAt: implementStarted,
    }),
  ]);
});

test("projectPipelineSnapshot includes createdAt and null finishedAtMs while derived state is non-terminal", () => {
  const createdAt = 1_700_000_000_000;
  const pipeline = pipelineWithStages(
    WORKFLOW_ONLY,
    { s1: { status: "succeeded" }, s2: { status: "running" } },
    { createdAt },
  );

  // Mutation checkpoint: omitting createdAt from projectPipelineSnapshot must turn this test RED.
  expect(projectPipelineSnapshot(pipeline)).toMatchObject({
    createdAt,
    finishedAtMs: null,
    state: "running",
  });
});

test("projectPipelineSnapshot uses terminalPublicationSucceededAt as finishedAtMs when set", () => {
  const publicationAt = 1_700_000_010_000;
  const pipeline = pipelineWithStages(
    WORKFLOW_ONLY,
    { s1: { status: "succeeded" }, s2: { status: "succeeded", endedAt: 1_700_000_005_000 } },
    { terminalPublicationSucceededAt: publicationAt },
  );

  expect(projectPipelineSnapshot(pipeline).finishedAtMs).toBe(publicationAt);
});

test("projectPipelineSnapshot derives finishedAtMs from max stage endedAt without publication success", () => {
  const createdAt = 1_700_000_000_000;
  const pipeline = pipelineWithStages(
    WORKFLOW_ONLY,
    {
      s1: { status: "succeeded", endedAt: 1_700_000_003_000 },
      s2: { status: "failed", endedAt: 1_700_000_007_000 },
    },
    { createdAt },
  );

  // Mutation checkpoint: returning pipeline.createdAt instead of max stage endedAt must turn this test RED.
  expect(projectPipelineSnapshot(pipeline).finishedAtMs).toBe(1_700_000_007_000);
});

test("pipeline finish uses approval decidedAt for rejected and approved-final gates", async () => {
  // @mutate v2/src/daemon/pipeline-observation.ts "const candidateFinishAts = pipeline.stages.flatMap((stage) => [stage.endedAt, stage.decidedAt]);" -> "const candidateFinishAts = pipeline.stages.flatMap((stage) => [stage.endedAt]);"
  const [approvedPipelineId, rejectedPipelineId] = createApprovalPipelines();
  const approvedBefore = stateStore.loadPipeline(approvedPipelineId);
  const rejectedBefore = stateStore.loadPipeline(rejectedPipelineId);
  if (!approvedBefore || !rejectedBefore) {
    throw new Error("expected durable approval pipelines");
  }
  await waitFor(() => Date.now() > Math.max(approvedBefore.createdAt, rejectedBefore.createdAt));
  openApprovalGates([approvedPipelineId, rejectedPipelineId]);

  const h = handlers();
  await h.pipeline_approve(
    requestFrame("approve-finish", "pipeline_approve", { pipelineId: approvedPipelineId, stageId: "gate" }),
    new AbortController().signal,
  );
  await h.pipeline_reject(
    requestFrame("reject-finish", "pipeline_reject", { pipelineId: rejectedPipelineId, stageId: "gate" }),
    new AbortController().signal,
  );

  const approved = stateStore.loadPipeline(approvedPipelineId);
  const rejected = stateStore.loadPipeline(rejectedPipelineId);
  const approvedGate = approved?.stages[0];
  const rejectedGate = rejected?.stages[0];
  if (!approved || !rejected || approvedGate?.decidedAt === null || approvedGate?.decidedAt === undefined) {
    throw new Error("expected durable approved decision");
  }
  if (rejectedGate?.decidedAt === null || rejectedGate?.decidedAt === undefined) {
    throw new Error("expected durable rejected decision");
  }
  expect(approvedGate.endedAt).toBeNull();
  expect(rejectedGate.endedAt).toBeNull();
  expect(projectPipelineSnapshot(approved).finishedAtMs).toBe(approvedGate.decidedAt);
  expect(projectPipelineSnapshot(rejected).finishedAtMs).toBe(rejectedGate.decidedAt);
});

test("two-branch derivePipelineBoundary names awaiting branchKey while sibling branch runs", () => {
  const pipeline = fanOutObservationPipeline({
    "gate/alpha": { status: "awaiting" },
    "gate/beta": { status: "approved" },
    "plan/beta": { status: "running" },
  });

  // Mutation checkpoint: omitting branchKey from derivePipelineBoundary awaiting-approval envelope must turn this test RED.
  expect(derivePipelineBoundary(pipeline)).toEqual({
    kind: "awaiting-approval",
    stageId: "gate",
    branchKey: "alpha",
  });
  expect(derivePipelineState(pipeline)).toBe("running");
});

test("failed branch plus undecided sibling gate remains non-terminal and exposes approval boundary", () => {
  const pipeline = fanOutObservationPipeline({
    "plan/alpha": { status: "failed", endedAt: 1 },
    "gate/beta": { status: "awaiting" },
    "plan/beta": { status: "succeeded", endedAt: 2 },
  });

  // @mutate v2/src/daemon/pipeline-execution.ts "if (aggregation.anyActionableAwaiting) return \"awaiting-approval\";" -> "if (false) return \"awaiting-approval\";"
  // @mutate v2/src/daemon/pipeline-execution.ts "if (!branchSuffixPredecessorsSatisfied(pipeline, record, split)) break;" -> "if (false) break;"
  // @mutate v2/src/daemon/pipeline-observation.ts "if (split !== null && fanOutBranchSuffixTerminallySettled(pipeline, split, record.branchKey)) continue;" -> "if (false) continue;"
  expect(isPipelineTerminal(derivePipelineState(pipeline))).toBe(false);
  expect(derivePipelineBoundary(pipeline)).toEqual({
    kind: "awaiting-approval",
    stageId: "gate",
    branchKey: "beta",
  });
});

test("pipeline_wait holds open for failed-plus-running fan-out rows then returns terminal failed after sibling settles", async () => {
  const observer = new PipelineWaitObserver();
  const pipelineId = admitFanOutObservationPipeline();
  stateStore.updateStage({
    pipelineId,
    stageId: "gate",
    branchKey: "beta",
    patch: { status: "approved" },
  });
  stateStore.updateStage({
    pipelineId,
    stageId: "plan",
    branchKey: "alpha",
    patch: { status: "failed", endedAt: 1 },
  });
  stateStore.updateStage({
    pipelineId,
    stageId: "plan",
    branchKey: "beta",
    patch: { status: "running", workflowInvocationId: "run-beta-plan" },
  });

  const observedStore = bindPipelineWaitObserver(stateStore, observer);
  const controller = new AbortController();
  const waitPromise = waitForPipelineBoundary(observedStore, pipelineId, controller.signal, observer, 50);

  let settled = false;
  void waitPromise.then(() => {
    settled = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(settled).toBe(false);
  expect(derivePipelineState(stateStore.loadPipeline(pipelineId)!)).toBe("running");

  observedStore.updateStage({
    pipelineId,
    stageId: "plan",
    branchKey: "beta",
    patch: { status: "failed", endedAt: 2 },
  });

  const boundary = await waitPromise;
  // @mutate v2/src/daemon/pipeline-execution.ts "if (aggregation.anyRunning) return \"running\";" -> "if (false) return \"running\";"
  expect(boundary).toEqual({ kind: "terminal", state: "failed" });
});
