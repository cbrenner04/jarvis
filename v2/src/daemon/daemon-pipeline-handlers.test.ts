import { Database } from "bun:sqlite";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { InvocationResult } from "../../../shared/invocation/execute.ts";
import type { PipelineDefinition } from "../execution/pipeline-definition.ts";
import type { WriteWorkflowStep } from "../execution/workflow-runner.ts";
import { openStateStore, type StateStore } from "../persistence/state-store.ts";
import { flushBackgroundRuns } from "../testing/run-control.ts";
import { createBindingFactory, writeStepFixtures } from "../testing/workflow-step-fixtures.ts";
import { createFakeWriteLoopExecutor, type FakeWriteLoopExecutor } from "../testing/write-loop-executor.ts";
import { createRunControlHandlers } from "./daemon.ts";
import type { PipelineStageResolutionResult } from "./pipeline-stage-resolve.ts";

const { createWriteStep } = writeStepFixtures();

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

async function waitFor(predicate: () => boolean | Promise<boolean>, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate()) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 5));
}

function interruptPipeline(pipelineId: string): void {
  const raw = new Database(dbPath);
  try {
    raw.prepare("UPDATE pipelines SET status = 'interrupted' WHERE id = ?").run(pipelineId);
  } finally {
    raw.close();
  }
}

function requestFrame(id: string, method: string, params?: unknown) {
  return { kind: "request" as const, id, method, params };
}

const approvalGateDefinition: PipelineDefinition = {
  name: "approval-gate",
  stages: [
    { stageId: "s1", kind: "workflow", workflow: "intent", review: "none" },
    { stageId: "gate", kind: "approval" },
    { stageId: "s3", kind: "workflow", workflow: "plan", review: "none" },
  ],
};

const twoStageDefinition: PipelineDefinition = {
  name: "two-stage",
  stages: [
    { stageId: "s1", kind: "workflow", workflow: "intent", review: "none" },
    { stageId: "s2", kind: "workflow", workflow: "plan", review: "none" },
  ],
};

let stateStore: StateStore;
let fakeExecutor: FakeWriteLoopExecutor;
let dbPath: string;

beforeEach(() => {
  dbPath = join(tmpdir(), `jarvis-pipeline-handlers-${process.pid}-${Date.now()}-${Math.random()}.db`);
  stateStore = openStateStore(dbPath);
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

function makeHandlers(
  resolveStage: (definition: PipelineDefinition, stageIndex: number) => Promise<PipelineStageResolutionResult>,
) {
  return createRunControlHandlers({
    stateStore,
    writeLoopExecutor: fakeExecutor.executor,
    failureReporter: () => {},
    hasMemoryHeadroom: () => true,
    resolveStage,
  });
}

test("pipeline_decide_approval chains approved decisions into activation on an active pipeline", async () => {
  const stage1 = controllableBindingFactory();
  const stage3 = controllableBindingFactory();
  const stage1Step = createWriteStep("stage-1", "pipeline-branch", stage1.factory, { suppressShrink: true });
  const stage3Step = createWriteStep("stage-3", "pipeline-branch", stage3.factory, { suppressShrink: true });

  const resolveStage = async (
    _definition: PipelineDefinition,
    stageIndex: number,
  ): Promise<PipelineStageResolutionResult> => ({
    ok: true,
    steps: [stageIndex === 0 ? stage1Step : stage3Step],
  });

  const handlers = makeHandlers(resolveStage);
  const context = { cwd: "/repo", seed: "seed text" };

  const startResponse = await handlers.pipeline_start(
    requestFrame("start", "pipeline_start", { definition: approvalGateDefinition, context }),
    new AbortController().signal,
  );
  const pipelineId = (startResponse as { result: { pipelineId: string } }).result.pipelineId;

  await waitFor(
    () => stateStore.loadPipeline(pipelineId)?.stages.find((s) => s.stageId === "s1")?.status === "running",
  );
  stage1.settle();
  await waitFor(
    () => stateStore.loadPipeline(pipelineId)?.stages.find((s) => s.stageId === "gate")?.status === "awaiting",
  );
  const gate = stateStore.loadPipeline(pipelineId)?.stages.find((s) => s.stageId === "gate");
  if (!gate) throw new Error("expected gate");

  const decideResponse = await handlers.pipeline_decide_approval(
    requestFrame("decide", "pipeline_decide_approval", {
      pipelineId,
      stageRecordId: gate.id,
      stageId: gate.stageId,
      decision: "approved",
    }),
    new AbortController().signal,
  );

  expect(decideResponse).toEqual({
    kind: "response",
    result: {
      decision: { outcome: "applied", stageRecordId: gate.id, reason: "decision-recorded", status: "approved" },
      activation: { outcome: "applied" },
      eligibility: { eligible: true, reason: "approved-continuation" },
    },
  });

  await waitFor(
    () => stateStore.loadPipeline(pipelineId)?.stages.find((s) => s.stageId === "s3")?.status === "running",
  );
  stage3.settle();
  await waitFor(
    () => stateStore.loadPipeline(pipelineId)?.stages.find((s) => s.stageId === "s3")?.status === "succeeded",
  );
  await flushBackgroundRuns();
});

test("pipeline_decide_approval refuses a stage row that does not belong to the supplied pipelineId", async () => {
  const context = { cwd: "/repo", seed: "seed text" };
  const pipelineA = stateStore.createPipeline({
    definition: { name: "a", stages: [{ stageId: "gate", kind: "approval" }] },
    context,
  });
  const pipelineB = stateStore.createPipeline({
    definition: { name: "b", stages: [{ stageId: "gate", kind: "approval" }] },
    context,
  });
  stateStore.updateStage({ pipelineId: pipelineA, stageId: "gate", patch: { status: "awaiting" } });
  const gateA = stateStore.loadPipeline(pipelineA)?.stages.find((s) => s.stageId === "gate");
  if (!gateA) throw new Error("expected gate on pipeline A");

  const handlers = makeHandlers(async () => ({ ok: true, steps: [] }));
  const response = await handlers.pipeline_decide_approval(
    requestFrame("decide", "pipeline_decide_approval", {
      pipelineId: pipelineB,
      stageRecordId: gateA.id,
      stageId: gateA.stageId,
      decision: "approved",
    }),
    new AbortController().signal,
  );

  expect(response).toEqual({
    kind: "response",
    result: {
      decision: { outcome: "refused", stageRecordId: gateA.id, reason: "pipeline-id-mismatch" },
    },
  });
  expect(stateStore.loadPipeline(pipelineA)?.stages.find((s) => s.stageId === "gate")?.status).toBe("awaiting");
  expect(stateStore.loadPipeline(pipelineB)?.stages.find((s) => s.stageId === "gate")?.status).toBe("pending");
});

test("pipeline_reopen_failed chains reopen into activation on an active pipeline", async () => {
  const stage2 = controllableBindingFactory();
  const stage2Step = createWriteStep("stage-2", "pipeline-branch", stage2.factory, { suppressShrink: true });
  const handlers = makeHandlers(async (_definition, stageIndex) => ({
    ok: true,
    steps: stageIndex === 1 ? [stage2Step] : [],
  }));

  const context = { cwd: "/repo", seed: "seed text" };
  const pipelineId = stateStore.createPipeline({ definition: twoStageDefinition, context });
  stateStore.updateStage({
    pipelineId,
    stageId: "s1",
    patch: { status: "succeeded", artifact: { specPath: "spec/s1.md" } },
  });
  stateStore.updateStage({
    pipelineId,
    stageId: "s2",
    patch: { status: "failed", endedAt: Date.now(), failureDetail: { message: "failed" } },
  });

  const failedStageId = stateStore.loadPipeline(pipelineId)?.stages.find((s) => s.stageId === "s2")?.id;
  const reopenResponse = await handlers.pipeline_reopen_failed(
    requestFrame("reopen", "pipeline_reopen_failed", { pipelineId }),
    new AbortController().signal,
  );

  expect(reopenResponse).toEqual({
    kind: "response",
    result: {
      reopen: { outcome: "applied", stageRecordId: failedStageId },
      activation: { outcome: "applied" },
      eligibility: { eligible: true, reason: "reopened-continuation" },
    },
  });

  await waitFor(
    () => stateStore.loadPipeline(pipelineId)?.stages.find((s) => s.stageId === "s2")?.status === "running",
  );
  stage2.settle();
  await waitFor(
    () => stateStore.loadPipeline(pipelineId)?.stages.find((s) => s.stageId === "s2")?.status === "succeeded",
  );
  await flushBackgroundRuns();
});

test("pipeline_continue resumes an interrupted pipeline through the handler seam", async () => {
  const stage2 = controllableBindingFactory();
  const stage2Step = createWriteStep("stage-2", "pipeline-branch", stage2.factory, { suppressShrink: true });
  const handlers = makeHandlers(async (_definition, stageIndex) => ({
    ok: true,
    steps: stageIndex === 1 ? [stage2Step] : [],
  }));

  const context = { cwd: "/repo", seed: "seed text" };
  const pipelineId = stateStore.createPipeline({ definition: twoStageDefinition, context });
  stateStore.updateStage({
    pipelineId,
    stageId: "s1",
    patch: { status: "succeeded", artifact: { specPath: "spec/s1.md" } },
  });
  interruptPipeline(pipelineId);

  const response = await handlers.pipeline_continue(
    requestFrame("continue", "pipeline_continue", { pipelineId }),
    new AbortController().signal,
  );

  expect(response).toEqual({ kind: "response", result: { outcome: "applied" } });
  await waitFor(
    () => stateStore.loadPipeline(pipelineId)?.stages.find((s) => s.stageId === "s2")?.status === "running",
  );
  stage2.settle();
  await waitFor(
    () => stateStore.loadPipeline(pipelineId)?.stages.find((s) => s.stageId === "s2")?.status === "succeeded",
  );
  await flushBackgroundRuns();
});

test("pipeline_activate resumes an interrupted approved gate through the handler seam", async () => {
  const stage3 = controllableBindingFactory();
  const stage3Step = createWriteStep("stage-3", "pipeline-branch", stage3.factory, { suppressShrink: true });
  const handlers = makeHandlers(async (_definition, stageIndex) => ({
    ok: true,
    steps: stageIndex === 2 ? [stage3Step] : [],
  }));

  const context = { cwd: "/repo", seed: "seed text" };
  const pipelineId = stateStore.createPipeline({ definition: approvalGateDefinition, context });
  stateStore.updateStage({
    pipelineId,
    stageId: "s1",
    patch: { status: "succeeded", artifact: { specPath: "spec/s1.md" } },
  });
  stateStore.updateStage({ pipelineId, stageId: "gate", patch: { status: "approved" } });
  interruptPipeline(pipelineId);

  const response = await handlers.pipeline_activate(
    requestFrame("activate", "pipeline_activate", { pipelineId }),
    new AbortController().signal,
  );

  expect(response).toEqual({
    kind: "response",
    result: { outcome: "applied", eligibility: { eligible: true, reason: "approved-continuation" } },
  });
  await waitFor(
    () => stateStore.loadPipeline(pipelineId)?.stages.find((s) => s.stageId === "s3")?.status === "running",
  );
  stage3.settle();
  await waitFor(
    () => stateStore.loadPipeline(pipelineId)?.stages.find((s) => s.stageId === "s3")?.status === "succeeded",
  );
  await flushBackgroundRuns();
});

test("pipeline_activate refuses a second activation while the pipeline loop is already running", async () => {
  const stage3 = controllableBindingFactory();
  const stage3Step = createWriteStep("stage-3", "pipeline-branch", stage3.factory, { suppressShrink: true });
  const handlers = makeHandlers(async (_definition, stageIndex) => ({
    ok: true,
    steps: stageIndex === 2 ? [stage3Step] : [],
  }));

  const context = { cwd: "/repo", seed: "seed text" };
  const pipelineId = stateStore.createPipeline({ definition: approvalGateDefinition, context });
  stateStore.updateStage({
    pipelineId,
    stageId: "s1",
    patch: { status: "succeeded", artifact: { specPath: "spec/s1.md" } },
  });
  stateStore.updateStage({ pipelineId, stageId: "gate", patch: { status: "approved" } });
  interruptPipeline(pipelineId);

  const first = await handlers.pipeline_activate(
    requestFrame("activate-1", "pipeline_activate", { pipelineId }),
    new AbortController().signal,
  );
  expect(first).toEqual({
    kind: "response",
    result: { outcome: "applied", eligibility: { eligible: true, reason: "approved-continuation" } },
  });

  const second = await handlers.pipeline_activate(
    requestFrame("activate-2", "pipeline_activate", { pipelineId }),
    new AbortController().signal,
  );
  expect(second).toEqual({ kind: "response", result: { outcome: "refused", reason: "claim-refused" } });

  stage3.settle();
  await waitFor(
    () => stateStore.loadPipeline(pipelineId)?.stages.find((s) => s.stageId === "s3")?.status === "succeeded",
  );
  await flushBackgroundRuns();
});
