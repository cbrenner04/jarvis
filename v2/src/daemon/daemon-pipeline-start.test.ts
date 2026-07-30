import { afterEach, beforeEach, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { InvocationResult } from "../../../shared/invocation/execute.ts";
import type { PipelineDefinition } from "../execution/pipeline-definition.ts";
import type { AnyWorkflowStep, WriteWorkflowStep } from "../execution/workflow-runner.ts";
import { openStateStore, type StateStore } from "../persistence/state-store.ts";
import { flushBackgroundRuns } from "../testing/run-control.ts";
import {
  createBindingFactory,
  doneWithArtifactBindingFactory,
  writeStepFixtures,
} from "../testing/workflow-step-fixtures.ts";
import { createFakeWriteLoopExecutor, type FakeWriteLoopExecutor } from "../testing/write-loop-executor.ts";
import { createRunControlHandlers, setInvertAdmissionContextHandoffForTest } from "./daemon.ts";
import { derivePipelineState } from "./pipeline-execution.ts";
import type { PipelineStageResolutionResult } from "./pipeline-stage-resolve.ts";

const { createWriteStep } = writeStepFixtures();

/** Stays pending until `settle()` is called, then resolves with an artifact file written. */
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

/** Polls until `predicate` holds, so a slow step fails on its own assertion rather than on a sleep. */
async function waitFor(predicate: () => boolean | Promise<boolean>, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate()) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 5));
}

function requestFrame(id: string, method: string, params?: unknown) {
  return { kind: "request" as const, id, method, params };
}

const ADMISSION_CONTEXT = {
  cwd: "/fake",
  seed: "seed text",
  configPath: "/fake/.jarvis/config.json",
};

const SINGLE_STAGE_DEFINITION: PipelineDefinition = {
  name: "context-admission",
  stages: [{ stageId: "only", kind: "workflow", workflow: "intent", review: "none" }],
};

function createPipelineStartHandlers(
  resolveStage: (
    definition: PipelineDefinition,
    stageIndex: number,
  ) => Promise<PipelineStageResolutionResult>,
) {
  return createRunControlHandlers({
    stateStore,
    writeLoopExecutor: fakeExecutor.executor,
    failureReporter: () => {},
    hasMemoryHeadroom: () => true,
    resolveStage,
  });
}

let stateStore: StateStore;
let fakeExecutor: FakeWriteLoopExecutor;

beforeEach(() => {
  stateStore = openStateStore(join(tmpdir(), `jarvis-pipeline-start-${process.pid}-${Date.now()}-${Math.random()}.db`));
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

test("pipeline_start admits a pipeline, keeps running after the client disconnects, and progresses in order to succeeded", async () => {
  const stage1 = controllableBindingFactory();
  const stage1Step: AnyWorkflowStep = createWriteStep("stage-1", "pipeline-branch", stage1.factory, {
    suppressShrink: true,
  });
  const stage2Step: AnyWorkflowStep = createWriteStep("stage-2", "pipeline-branch", doneWithArtifactBindingFactory, {
    suppressShrink: true,
  });

  const resolveStage = async (
    _definition: PipelineDefinition,
    stageIndex: number,
  ): Promise<PipelineStageResolutionResult> => ({ ok: true, steps: [stageIndex === 0 ? stage1Step : stage2Step] });

  const handlers = createRunControlHandlers({
    stateStore,
    writeLoopExecutor: fakeExecutor.executor,
    failureReporter: () => {},
    hasMemoryHeadroom: () => true,
    resolveStage,
  });

  const definition: PipelineDefinition = {
    name: "sample",
    stages: [
      { stageId: "s1", kind: "workflow", workflow: "intent", review: "none" },
      { stageId: "s2", kind: "workflow", workflow: "plan", review: "none" },
    ],
  };

  // The handler resolves once the pipeline's rows are durably created — proving the daemon does
  // not hold the client connection open for the pipeline's full run.
  const response = await handlers.pipeline_start(
    requestFrame("p1", "pipeline_start", { definition, context: { cwd: "/fake", seed: "seed text" } }),
    new AbortController().signal,
  );
  expect(response.kind).toBe("response");
  const pipelineId = (response as { result: { pipelineId: string } }).result.pipelineId;
  expect(pipelineId).toBeTruthy();

  // "Disconnect": nothing further is awaited on the client's behalf; observe solely through a
  // fresh `loadPipeline` read, proving the loop is daemon-owned and keeps running unattended.
  await waitFor(
    () => stateStore.loadPipeline(pipelineId)?.stages.find((s) => s.stageId === "s1")?.status === "running",
  );

  const midFlight = stateStore.loadPipeline(pipelineId);
  if (!midFlight) throw new Error("expected pipeline to exist");
  expect(midFlight.stages.find((s) => s.stageId === "s2")?.status).toBe("pending");
  expect(derivePipelineState(midFlight)).toBe("running");

  stage1.settle();

  await waitFor(
    () => stateStore.loadPipeline(pipelineId)?.stages.find((s) => s.stageId === "s2")?.status === "succeeded",
  );
  await flushBackgroundRuns();

  const finalPipeline = stateStore.loadPipeline(pipelineId);
  if (!finalPipeline) throw new Error("expected pipeline to exist");
  expect(finalPipeline.stages.map((s) => s.status)).toEqual(["succeeded", "succeeded"]);
  expect(derivePipelineState(finalPipeline)).toBe("succeeded");
});

test("pipeline_start persists supplied context before returning pipelineId", async () => {
  const handlers = createPipelineStartHandlers(async () => ({ ok: true, steps: [] }));

  const response = await handlers.pipeline_start(
    requestFrame("ctx", "pipeline_start", { definition: SINGLE_STAGE_DEFINITION, context: ADMISSION_CONTEXT }),
    new AbortController().signal,
  );
  expect(response.kind).toBe("response");
  const pipelineId = (response as { result: { pipelineId: string } }).result.pipelineId;

  const admitted = stateStore.loadPipeline(pipelineId);
  if (!admitted) throw new Error("expected pipeline to exist");
  expect(admitted.context).toEqual(ADMISSION_CONTEXT);
});

test("inverting admission-context handoff fails persistence regression", async () => {
  setInvertAdmissionContextHandoffForTest(true);
  try {
    const handlers = createPipelineStartHandlers(async () => ({ ok: true, steps: [] }));

    const response = await handlers.pipeline_start(
      requestFrame("ctx-inv", "pipeline_start", { definition: SINGLE_STAGE_DEFINITION, context: ADMISSION_CONTEXT }),
      new AbortController().signal,
    );
    expect(response).toEqual({
      kind: "error",
      code: "admission_failed",
      message: "pipeline context was not durably persisted",
    });
  } finally {
    setInvertAdmissionContextHandoffForTest(false);
  }
});
