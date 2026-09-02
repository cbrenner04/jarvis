import { afterEach, beforeEach, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PipelineDefinition } from "../execution/pipeline-definition.ts";
import type { PipelineStageResolutionResult } from "./pipeline-stage-resolve.ts";
import { openStateStore, type StateStore } from "../persistence/state-store.ts";
import { flushBackgroundRuns } from "../testing/run-control.ts";
import { createFakeWriteLoopExecutor, type FakeWriteLoopExecutor } from "../testing/write-loop-executor.ts";
import { createRunControlHandlerContext } from "./daemon-run-control-context.ts";
import { createPipelineHandlers } from "./daemon-pipeline-handlers.ts";
import { createRunLifecycleHandlers } from "./daemon-run-lifecycle-handlers.ts";
import { createWorkflowStartAdmission } from "./daemon-workflow-admission-handlers.ts";
import { derivePipelineState } from "./pipeline-execution.ts";

const ADMISSION_CONTEXT = {
  cwd: "/fake",
  seed: "seed text",
  configPath: "/fake/.jarvis/config.json",
};

const SINGLE_STAGE_DEFINITION: PipelineDefinition = {
  name: "list-projection",
  stages: [{ stageId: "only", kind: "workflow", workflow: "intent", review: "none" }],
};

let stateStore: StateStore;
let fakeExecutor: FakeWriteLoopExecutor;

beforeEach(() => {
  stateStore = openStateStore(join(tmpdir(), `jarvis-pipeline-handlers-${process.pid}-${Date.now()}.db`));
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

function requestFrame(id: string, method: string, params?: unknown) {
  return { kind: "request" as const, id, method, params };
}

function pipelineHandlers(
  resolveStage: (
    definition: PipelineDefinition,
    stageIndex: number,
  ) => Promise<PipelineStageResolutionResult> = async () => ({
    ok: true,
    steps: [],
  }),
) {
  const ctx = createRunControlHandlerContext({
    stateStore,
    writeLoopExecutor: fakeExecutor.executor,
    failureReporter: () => {},
    hasMemoryHeadroom: () => true,
    resolveStage,
  });
  const workflowStart = createWorkflowStartAdmission(ctx);
  const lifecycle = createRunLifecycleHandlers(ctx, {
    handleWorkflowStart: workflowStart.handleWorkflowStart,
  });
  return createPipelineHandlers(ctx, {
    pipelineDispatch: lifecycle.pipelineDispatch,
    pipelineWait: lifecycle.pipelineWait,
    admitWorkflowStart: workflowStart.admitWorkflowStart,
    resolveStage,
  });
}

test("pipeline_start refuses context missing configPath without creating pipeline rows", async () => {
  const handlers = pipelineHandlers();

  const response = await handlers.pipeline_start(
    requestFrame("no-config", "pipeline_start", {
      definition: SINGLE_STAGE_DEFINITION,
      context: { cwd: "/fake", seed: "seed text" },
    }),
    new AbortController().signal,
  );

  expect(response).toEqual({
    kind: "error",
    code: "invalid_params",
    message: "missing required field: configPath",
  });
  expect(stateStore.listPipelines()).toEqual([]);
});

test("pipeline_list projects admitted pipelines with derived state", async () => {
  const handlers = pipelineHandlers();
  const pipelineId = stateStore.createPipeline({
    definition: SINGLE_STAGE_DEFINITION,
    context: ADMISSION_CONTEXT,
  });

  const response = await handlers.pipeline_list(requestFrame("l1", "pipeline_list"), new AbortController().signal);
  expect(response.kind).toBe("response");
  const pipelines = (response as { result: { pipelines: Array<{ pipelineId: string; state: string }> } }).result
    .pipelines;
  expect(pipelines).toHaveLength(1);
  expect(pipelines[0]?.pipelineId).toBe(pipelineId);
  const loaded = stateStore.loadPipeline(pipelineId);
  if (!loaded) throw new Error("expected pipeline");
  expect(pipelines[0]?.state).toBe(derivePipelineState(loaded));
});

test("pipeline_list omits dismissed pipelines unless includeDismissed is true", async () => {
  const handlers = pipelineHandlers();
  const pipelineId = stateStore.createPipeline({
    definition: SINGLE_STAGE_DEFINITION,
    context: ADMISSION_CONTEXT,
  });
  stateStore.dismissPipeline({ pipelineId });

  const defaultList = await handlers.pipeline_list(requestFrame("l2", "pipeline_list"), new AbortController().signal);
  expect((defaultList as { result: { pipelines: unknown[] } }).result.pipelines).toEqual([]);

  const includeDismissed = await handlers.pipeline_list(
    requestFrame("l3", "pipeline_list", { includeDismissed: true }),
    new AbortController().signal,
  );
  expect((includeDismissed as { result: { pipelines: Array<{ pipelineId: string }> } }).result.pipelines).toHaveLength(
    1,
  );
});

test("pipelineExecutionDeps omits loadLogRecords without logReader", () => {
  const handlers = pipelineHandlers();
  expect(handlers.pipelineExecutionDeps()).not.toHaveProperty("loadLogRecords");
});

test("pipelineExecutionDeps omits executeTerminalPublication without injectable dep", () => {
  const handlers = pipelineHandlers();
  expect(handlers.pipelineExecutionDeps()).not.toHaveProperty("executeTerminalPublication");
});

test("pipelineExecutionDeps wires executeTerminalPublication from deps", () => {
  const executeTerminalPublication = async () => ({ prNumber: 1 });
  const ctx = createRunControlHandlerContext({
    stateStore,
    writeLoopExecutor: fakeExecutor.executor,
    failureReporter: () => {},
    hasMemoryHeadroom: () => true,
  });
  const workflowStart = createWorkflowStartAdmission(ctx);
  const lifecycle = createRunLifecycleHandlers(ctx, {
    handleWorkflowStart: workflowStart.handleWorkflowStart,
  });
  const handlers = createPipelineHandlers(ctx, {
    pipelineDispatch: lifecycle.pipelineDispatch,
    pipelineWait: lifecycle.pipelineWait,
    admitWorkflowStart: workflowStart.admitWorkflowStart,
    executeTerminalPublication,
  });
  expect(handlers.pipelineExecutionDeps().executeTerminalPublication).toBe(executeTerminalPublication);
});

test("pipelineExecutionDeps wires loadLogRecords from logReader", () => {
  const tailCalls: string[] = [];
  const mockLogReader = {
    tail: (runId: string) => {
      tailCalls.push(runId);
      return [];
    },
    async *follow() {},
  };
  const ctx = createRunControlHandlerContext({
    stateStore,
    writeLoopExecutor: fakeExecutor.executor,
    failureReporter: () => {},
    hasMemoryHeadroom: () => true,
    logReader: mockLogReader,
  });
  const workflowStart = createWorkflowStartAdmission(ctx);
  const lifecycle = createRunLifecycleHandlers(ctx, {
    handleWorkflowStart: workflowStart.handleWorkflowStart,
  });
  const handlers = createPipelineHandlers(ctx, {
    pipelineDispatch: lifecycle.pipelineDispatch,
    pipelineWait: lifecycle.pipelineWait,
    admitWorkflowStart: workflowStart.admitWorkflowStart,
  });
  const deps = handlers.pipelineExecutionDeps();
  expect(deps.loadLogRecords).toBeDefined();
  deps.loadLogRecords?.("run-42");
  expect(tailCalls).toEqual(["run-42"]);
});

test("pipeline_recover refuses resolution for an unknown pipeline", async () => {
  const handlers = pipelineHandlers();

  const response = await handlers.pipeline_recover(
    requestFrame("r1", "pipeline_recover", { pipelineId: "unknown-pipeline", branchKey: "branch-a" }),
    new AbortController().signal,
  );

  expect(response).toEqual({
    kind: "response",
    result: {
      kind: "resolution_refused",
      pipelineId: "unknown-pipeline",
      branchKey: "branch-a",
      reason: "pipeline_not_found",
      message: "pipeline unknown-pipeline not found",
    },
  });
});
