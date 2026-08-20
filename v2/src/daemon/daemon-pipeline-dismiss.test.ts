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
import { type PipelineSnapshot, projectPipelineSnapshot } from "./pipeline-observation.ts";

const { createWriteStep } = writeStepFixtures();

const ADMISSION_CONTEXT = { cwd: "/fake", seed: "seed text" } as const;

const SINGLE_WORKFLOW = (name: string): PipelineDefinition => ({
  name,
  stages: [{ stageId: "s1", kind: "workflow", workflow: "intent", review: "none" }],
});

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

let stateStore: StateStore;
let fakeExecutor: FakeWriteLoopExecutor;
let handlers: ReturnType<typeof createRunControlHandlers>;

beforeEach(() => {
  stateStore = openStateStore(
    join(tmpdir(), `jarvis-pipeline-dismiss-${process.pid}-${Date.now()}-${Math.random()}.db`),
  );
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

test("dismissed pipelines drop out of the default pipeline_list", async () => {
  const pipelineA = stateStore.createPipeline({ definition: SINGLE_WORKFLOW("dismiss-a") });
  const pipelineB = stateStore.createPipeline({ definition: SINGLE_WORKFLOW("dismiss-b") });
  await handlers.pipeline_dismiss(
    requestFrame("d", "pipeline_dismiss", { pipelineId: pipelineA }),
    new AbortController().signal,
  );

  // @mutate v2/src/daemon/daemon.ts "includeDismissed || pipeline.dismissedAt === null" -> "true"
  const response = await handlers.pipeline_list(requestFrame("l", "pipeline_list"), new AbortController().signal);
  const ids = (response as { result: { pipelines: PipelineSnapshot[] } }).result.pipelines.map((p) => p.pipelineId);
  expect(ids).toContain(pipelineB);
  expect(ids).not.toContain(pipelineA);
  expect(ids).toHaveLength(1);
});

test("includeDismissed returns dismissed pipelines with dismissedAt set", async () => {
  const pipelineA = stateStore.createPipeline({ definition: SINGLE_WORKFLOW("dismiss-a") });
  const pipelineB = stateStore.createPipeline({ definition: SINGLE_WORKFLOW("dismiss-b") });
  await handlers.pipeline_dismiss(
    requestFrame("d", "pipeline_dismiss", { pipelineId: pipelineA }),
    new AbortController().signal,
  );

  // @mutate v2/src/daemon/daemon.ts "params?.includeDismissed === true" -> "false"
  const response = await handlers.pipeline_list(
    requestFrame("l", "pipeline_list", { includeDismissed: true }),
    new AbortController().signal,
  );
  const pipelines = (response as { result: { pipelines: PipelineSnapshot[] } }).result.pipelines;
  const a = pipelines.find((p) => p.pipelineId === pipelineA);
  const b = pipelines.find((p) => p.pipelineId === pipelineB);
  if (!a || !b) throw new Error("expected both pipelines in the includeDismissed listing");
  expect(a.dismissedAt).toEqual(expect.any(Number));
  expect(b.dismissedAt).toBeNull();
  expect(a).toEqual(projectPipelineSnapshot(stateStore.loadPipeline(pipelineA)!));
  expect(b).toEqual(projectPipelineSnapshot(stateStore.loadPipeline(pipelineB)!));
});

test("includeDismissed reads strict === true, a truthy non-boolean value does not opt in", async () => {
  const pipelineA = stateStore.createPipeline({ definition: SINGLE_WORKFLOW("dismiss-a") });
  await handlers.pipeline_dismiss(
    requestFrame("d", "pipeline_dismiss", { pipelineId: pipelineA }),
    new AbortController().signal,
  );

  const response = await handlers.pipeline_list(
    requestFrame("l", "pipeline_list", { includeDismissed: "true" }),
    new AbortController().signal,
  );
  const ids = (response as { result: { pipelines: PipelineSnapshot[] } }).result.pipelines.map((p) => p.pipelineId);
  expect(ids).not.toContain(pipelineA);
});

test("pipeline_undismiss returns applied with state and restores the default listing", async () => {
  const pipelineId = stateStore.createPipeline({ definition: SINGLE_WORKFLOW("undismiss") });
  await handlers.pipeline_dismiss(requestFrame("d", "pipeline_dismiss", { pipelineId }), new AbortController().signal);

  const response = await handlers.pipeline_undismiss(
    requestFrame("u", "pipeline_undismiss", { pipelineId }),
    new AbortController().signal,
  );
  expect(response).toEqual({ kind: "response", result: { kind: "applied", pipelineId, state: "pending" } });

  const listResponse = await handlers.pipeline_list(requestFrame("l", "pipeline_list"), new AbortController().signal);
  const pipelines = (listResponse as { result: { pipelines: PipelineSnapshot[] } }).result.pipelines;
  const restored = pipelines.find((p) => p.pipelineId === pipelineId);
  if (!restored) throw new Error("expected the undismissed pipeline back in the default listing");
  expect(restored.dismissedAt).toBeNull();
});

test("a repeat dismiss stays applied and leaves the original dismissedAt unchanged", async () => {
  const pipelineId = stateStore.createPipeline({ definition: SINGLE_WORKFLOW("repeat-dismiss") });

  const first = await handlers.pipeline_dismiss(
    requestFrame("d1", "pipeline_dismiss", { pipelineId }),
    new AbortController().signal,
  );
  expect(first).toEqual({ kind: "response", result: { kind: "applied", pipelineId, state: "pending" } });
  const firstDismissedAt = stateStore.loadPipeline(pipelineId)?.dismissedAt;

  const second = await handlers.pipeline_dismiss(
    requestFrame("d2", "pipeline_dismiss", { pipelineId }),
    new AbortController().signal,
  );
  expect(second).toEqual({ kind: "response", result: { kind: "applied", pipelineId, state: "pending" } });

  const listResponse = await handlers.pipeline_list(
    requestFrame("l", "pipeline_list", { includeDismissed: true }),
    new AbortController().signal,
  );
  const pipelines = (listResponse as { result: { pipelines: PipelineSnapshot[] } }).result.pipelines;
  const found = pipelines.find((p) => p.pipelineId === pipelineId);
  expect(found?.dismissedAt).toBe(firstDismissedAt);
});

test("an unknown pipeline id is refused on dismiss and undismiss", async () => {
  const realPipelineId = stateStore.createPipeline({ definition: SINGLE_WORKFLOW("real") });

  // @mutate v2/src/daemon/daemon.ts "if (outcome.kind === \"refused\") {" -> "if (false) {"
  const dismissResponse = await handlers.pipeline_dismiss(
    requestFrame("d", "pipeline_dismiss", { pipelineId: "no-such-pipeline" }),
    new AbortController().signal,
  );
  expect(dismissResponse).toEqual({
    kind: "response",
    result: { kind: "refused", pipelineId: "no-such-pipeline", reason: "pipeline_not_found" },
  });

  const undismissResponse = await handlers.pipeline_undismiss(
    requestFrame("u", "pipeline_undismiss", { pipelineId: "no-such-pipeline" }),
    new AbortController().signal,
  );
  expect(undismissResponse).toEqual({
    kind: "response",
    result: { kind: "refused", pipelineId: "no-such-pipeline", reason: "pipeline_not_found" },
  });

  const listResponse = await handlers.pipeline_list(requestFrame("l", "pipeline_list"), new AbortController().signal);
  const ids = (listResponse as { result: { pipelines: PipelineSnapshot[] } }).result.pipelines.map((p) => p.pipelineId);
  expect(ids).toContain(realPipelineId);
});

test("a missing pipelineId is refused invalid_params on dismiss and undismiss", async () => {
  // @mutate v2/src/daemon/daemon.ts "if (pipelineId.length === 0) {" -> "if (false) {"
  const dismissResponse = await handlers.pipeline_dismiss(
    requestFrame("d", "pipeline_dismiss", {}),
    new AbortController().signal,
  );
  expect(dismissResponse).toEqual({ kind: "error", code: "invalid_params", message: "pipelineId required" });

  const undismissResponse = await handlers.pipeline_undismiss(
    requestFrame("u", "pipeline_undismiss", {}),
    new AbortController().signal,
  );
  expect(undismissResponse).toEqual({ kind: "error", code: "invalid_params", message: "pipelineId required" });
});

test("dismissing a mid-flight pipeline changes only dismissed_at and lets it settle to terminal", async () => {
  const stage1 = controllableBindingFactory();
  const stage1Step: AnyWorkflowStep = createWriteStep("stage-1", "pipeline-branch", stage1.factory, {
    suppressShrink: true,
  });
  const midFlightHandlers = createRunControlHandlers({
    stateStore,
    writeLoopExecutor: fakeExecutor.executor,
    failureReporter: () => {},
    hasMemoryHeadroom: () => true,
    resolveStage: async () => ({ ok: true, steps: [stage1Step] }),
  });

  const startResponse = await midFlightHandlers.pipeline_start(
    requestFrame("start", "pipeline_start", { definition: SINGLE_WORKFLOW("mid-flight"), context: ADMISSION_CONTEXT }),
    new AbortController().signal,
  );
  expect(startResponse.kind).toBe("response");
  const pipelineId = (startResponse as { result: { pipelineId: string } }).result.pipelineId;

  await waitFor(() => stateStore.loadPipeline(pipelineId)?.stages[0]?.status === "running");
  const midFlightPipeline = stateStore.loadPipeline(pipelineId);
  if (!midFlightPipeline) throw new Error("expected durable pipeline mid-flight");
  const midFlightStages = midFlightPipeline.stages.map((stage) => ({
    id: stage.id,
    stageId: stage.stageId,
    branchKey: stage.branchKey,
    position: stage.position,
    status: stage.status,
    workflowInvocationId: stage.workflowInvocationId,
    startedAt: stage.startedAt,
    endedAt: stage.endedAt,
    decidedAt: stage.decidedAt,
    artifact: stage.artifact,
    failureDetail: stage.failureDetail,
  }));

  const dismissResponse = await midFlightHandlers.pipeline_dismiss(
    requestFrame("d", "pipeline_dismiss", { pipelineId }),
    new AbortController().signal,
  );
  expect(dismissResponse).toEqual({ kind: "response", result: { kind: "applied", pipelineId, state: "running" } });

  const listResponse = await midFlightHandlers.pipeline_list(
    requestFrame("l", "pipeline_list", { includeDismissed: true }),
    new AbortController().signal,
  );
  const listed = (listResponse as { result: { pipelines: PipelineSnapshot[] } }).result.pipelines.find(
    (p) => p.pipelineId === pipelineId,
  );
  if (!listed) throw new Error("expected the dismissed pipeline in the includeDismissed listing");
  expect(listed.stages).toEqual(midFlightStages);
  expect(listed.state).toBe("running");

  stage1.settle();
  await waitFor(() => stateStore.loadPipeline(pipelineId)?.stages[0]?.status === "succeeded");
  await flushBackgroundRuns();
  expect(stateStore.loadPipeline(pipelineId)?.dismissedAt).toEqual(expect.any(Number));
});
