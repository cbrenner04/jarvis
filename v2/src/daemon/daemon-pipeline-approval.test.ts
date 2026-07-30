import { afterEach, beforeEach, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { InvocationResult } from "../../../shared/invocation/execute.ts";
import type { PipelineDefinition } from "../execution/pipeline-definition.ts";
import type { AnyWorkflowStep, WriteWorkflowStep } from "../execution/workflow-runner.ts";
import { openStateStore, type StateStore } from "../persistence/state-store.ts";
import { flushBackgroundRuns } from "../testing/run-control.ts";
import { createBindingFactory, writeStepFixtures } from "../testing/workflow-step-fixtures.ts";
import { createFakeWriteLoopExecutor, type FakeWriteLoopExecutor } from "../testing/write-loop-executor.ts";
import { createRunControlHandlers } from "./daemon.ts";
import type { PipelineStageResolutionResult } from "./pipeline-stage-resolve.ts";

const { createWriteStep } = writeStepFixtures();

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

async function waitFor(predicate: () => boolean | Promise<boolean>, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate()) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 5));
}

const ADMISSION_CONTEXT = {
  cwd: "/fake",
  seed: "seed text",
  configPath: "/fake/.jarvis/config.json",
};

const APPROVAL_DEFINITION: PipelineDefinition = {
  name: "approval",
  stages: [
    { stageId: "s1", kind: "workflow", workflow: "intent", review: "none" },
    { stageId: "gate", kind: "approval" },
    { stageId: "s3", kind: "workflow", workflow: "plan", review: "none" },
  ],
};

let stateStore: StateStore;
let fakeExecutor: FakeWriteLoopExecutor;
let handlers: ReturnType<typeof createRunControlHandlers>;

beforeEach(() => {
  stateStore = openStateStore(join(tmpdir(), `jarvis-pipeline-approval-${process.pid}-${Date.now()}-${Math.random()}.db`));
  fakeExecutor = createFakeWriteLoopExecutor();
  handlers = createRunControlHandlers({
    stateStore,
    writeLoopExecutor: fakeExecutor.executor,
    failureReporter: () => {},
    hasMemoryHeadroom: () => true,
    resolveStage: async () => ({ ok: true, steps: [] }),
  });
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

test("missing or empty pipelineId or stageId returns invalid_params", async () => {
  for (const params of [
    {},
    { pipelineId: "p1" },
    { stageId: "gate" },
    { pipelineId: "", stageId: "gate" },
    { pipelineId: "p1", stageId: "" },
  ]) {
    const approve = await handlers.pipeline_approve(requestFrame("a", "pipeline_approve", params), new AbortController().signal);
    expect(approve).toEqual({ kind: "error", code: "invalid_params", message: "pipelineId and stageId required" });

    const reject = await handlers.pipeline_reject(requestFrame("r", "pipeline_reject", params), new AbortController().signal);
    expect(reject).toEqual({ kind: "error", code: "invalid_params", message: "pipelineId and stageId required" });
  }
});

test("setRetiring rejects approve and reject with daemon_superseded", async () => {
  handlers.setRetiring();

  const approve = await handlers.pipeline_approve(
    requestFrame("a", "pipeline_approve", { pipelineId: "p1", stageId: "gate" }),
    new AbortController().signal,
  );
  expect(approve).toEqual({
    kind: "error",
    code: "daemon_superseded",
    message: "Daemon is retiring and not accepting new work",
  });

  const reject = await handlers.pipeline_reject(
    requestFrame("r", "pipeline_reject", { pipelineId: "p1", stageId: "gate" }),
    new AbortController().signal,
  );
  expect(reject).toEqual({
    kind: "error",
    code: "daemon_superseded",
    message: "Daemon is retiring and not accepting new work",
  });
});

test("pipeline_approve returns after the durable write before async continuation runs", async () => {
  const stage1 = controllableBindingFactory();
  const stage3 = controllableBindingFactory();
  const stage1Step: AnyWorkflowStep = createWriteStep("stage-1", "pipeline-branch", stage1.factory, {
    suppressShrink: true,
  });
  const stage3Step: AnyWorkflowStep = createWriteStep("stage-3", "pipeline-branch", stage3.factory, {
    suppressShrink: true,
  });

  const resolveStage = async (
    _definition: PipelineDefinition,
    stageIndex: number,
  ): Promise<PipelineStageResolutionResult> => ({
    ok: true,
    steps: [stageIndex === 0 ? stage1Step : stage3Step],
  });

  const approvalHandlers = createRunControlHandlers({
    stateStore,
    writeLoopExecutor: fakeExecutor.executor,
    failureReporter: () => {},
    hasMemoryHeadroom: () => true,
    resolveStage,
  });

  const startResponse = await approvalHandlers.pipeline_start(
    requestFrame("start", "pipeline_start", { definition: APPROVAL_DEFINITION, context: ADMISSION_CONTEXT }),
    new AbortController().signal,
  );
  expect(startResponse.kind).toBe("response");
  const pipelineId = (startResponse as { result: { pipelineId: string } }).result.pipelineId;

  await waitFor(() => stateStore.loadPipeline(pipelineId)?.stages.find((s) => s.stageId === "s1")?.status === "running");
  stage1.settle();
  await waitFor(() => stateStore.loadPipeline(pipelineId)?.stages.find((s) => s.stageId === "gate")?.status === "awaiting");

  const approveResponse = await approvalHandlers.pipeline_approve(
    requestFrame("approve", "pipeline_approve", { pipelineId, stageId: "gate" }),
    new AbortController().signal,
  );
  expect(approveResponse).toEqual({
    kind: "response",
    result: { kind: "applied", pipelineId, stageId: "gate", decision: "approved" },
  });
  expect(stateStore.loadPipeline(pipelineId)?.stages.find((s) => s.stageId === "gate")?.status).toBe("approved");
  expect(stateStore.loadPipeline(pipelineId)?.stages.find((s) => s.stageId === "s3")?.status).toBe("pending");

  await waitFor(() => stateStore.loadPipeline(pipelineId)?.stages.find((s) => s.stageId === "s3")?.status === "running");
  stage3.settle();
  await waitFor(() => stateStore.loadPipeline(pipelineId)?.stages.find((s) => s.stageId === "s3")?.status === "succeeded");
  await flushBackgroundRuns();
  expect(stateStore.loadPipeline(pipelineId)?.stages.find((s) => s.stageId === "s3")?.status).toBe("succeeded");
});

test("pipeline_approve returns refused envelope for unknown pipeline", async () => {
  const response = await handlers.pipeline_approve(
    requestFrame("approve", "pipeline_approve", { pipelineId: "missing", stageId: "gate" }),
    new AbortController().signal,
  );
  expect(response).toEqual({
    kind: "response",
    result: { kind: "refused", pipelineId: "missing", stageId: "gate", reason: "pipeline_not_found" },
  });
});

test("pipeline_reject returns refused envelope for non-awaiting gate", async () => {
  const stage1 = controllableBindingFactory();
  const stage1Step: AnyWorkflowStep = createWriteStep("stage-1", "pipeline-branch", stage1.factory, {
    suppressShrink: true,
  });
  const approvalHandlers = createRunControlHandlers({
    stateStore,
    writeLoopExecutor: fakeExecutor.executor,
    failureReporter: () => {},
    hasMemoryHeadroom: () => true,
    resolveStage: async () => ({ ok: true, steps: [stage1Step] }),
  });

  const startResponse = await approvalHandlers.pipeline_start(
    requestFrame("start", "pipeline_start", { definition: APPROVAL_DEFINITION, context: ADMISSION_CONTEXT }),
    new AbortController().signal,
  );
  expect(startResponse.kind).toBe("response");
  const pipelineId = (startResponse as { result: { pipelineId: string } }).result.pipelineId;

  await waitFor(() => stateStore.loadPipeline(pipelineId)?.stages.find((s) => s.stageId === "s1")?.status === "running");
  stage1.settle();
  await waitFor(() => stateStore.loadPipeline(pipelineId)?.stages.find((s) => s.stageId === "gate")?.status === "awaiting");

  const approveResponse = await approvalHandlers.pipeline_approve(
    requestFrame("approve", "pipeline_approve", { pipelineId, stageId: "gate" }),
    new AbortController().signal,
  );
  expect(approveResponse.kind).toBe("response");
  await flushBackgroundRuns();

  const rejectResponse = await approvalHandlers.pipeline_reject(
    requestFrame("reject", "pipeline_reject", { pipelineId, stageId: "gate" }),
    new AbortController().signal,
  );
  expect(rejectResponse).toEqual({
    kind: "response",
    result: { kind: "refused", pipelineId, stageId: "gate", reason: "status_not_awaiting" },
  });
});
