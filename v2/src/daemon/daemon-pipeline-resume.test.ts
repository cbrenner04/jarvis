import { Database } from "bun:sqlite";
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
import { createFakeWriteLoopExecutor } from "../testing/write-loop-executor.ts";
import { createRunControlHandlers } from "./daemon.ts";
import type { PipelineStageResolutionResult } from "./pipeline-stage-resolve.ts";

const APPROVAL_DEFINITION: PipelineDefinition = {
  name: "approval",
  stages: [
    { stageId: "s1", kind: "workflow", workflow: "intent", review: "none" },
    { stageId: "gate", kind: "approval" },
    { stageId: "s3", kind: "workflow", workflow: "plan", review: "none" },
  ],
};

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

const REOPEN_DEFINITION: PipelineDefinition = {
  name: "reopen",
  stages: [
    { stageId: "s1", kind: "workflow", workflow: "intent", review: "none" },
    { stageId: "s2", kind: "workflow", workflow: "plan", review: "none" },
  ],
};

let stateStore: StateStore;
let dbPath: string;
let handlers: ReturnType<typeof createRunControlHandlers>;

beforeEach(() => {
  dbPath = join(tmpdir(), `jarvis-pipeline-resume-${process.pid}-${Date.now()}-${Math.random()}.db`);
  stateStore = openStateStore(dbPath);
  handlers = createRunControlHandlers({
    stateStore,
    writeLoopExecutor: createFakeWriteLoopExecutor().executor,
    failureReporter: () => {},
    hasMemoryHeadroom: () => true,
    resolveStage: async (_definition, stageIndex) => ({
      ok: true,
      steps: [{ behavior: "write", stageIndex }] as never,
    }),
  });
});

afterEach(async () => {
  await flushBackgroundRuns();
  try {
    stateStore.close();
  } catch {
    // already closed
  }
});

test("missing or empty pipelineId returns invalid_params", async () => {
  for (const params of [{}, { pipelineId: "" }]) {
    const response = await handlers.pipeline_resume(
      requestFrame("r", "pipeline_resume", params),
      new AbortController().signal,
    );
    expect(response).toEqual({ kind: "error", code: "invalid_params", message: "pipelineId required" });
  }
});

test("setRetiring rejects resume with daemon_superseded", async () => {
  handlers.setRetiring();
  const response = await handlers.pipeline_resume(
    requestFrame("r", "pipeline_resume", { pipelineId: "p1" }),
    new AbortController().signal,
  );
  expect(response).toEqual({
    kind: "error",
    code: "daemon_superseded",
    message: "Daemon is retiring and not accepting new work",
  });
});

test("resume returns after admission before async continuation runs", async () => {
  const stage2 = controllableBindingFactory();
  const stage2Step: AnyWorkflowStep = createWriteStep("stage-2", "pipeline-branch", stage2.factory, {
    suppressShrink: true,
  });
  const resolveStage = async (
    _definition: PipelineDefinition,
    stageIndex: number,
  ): Promise<PipelineStageResolutionResult> => ({
    ok: true,
    steps: stageIndex === 1 ? [stage2Step] : [],
  });

  const resumeHandlers = createRunControlHandlers({
    stateStore,
    writeLoopExecutor: createFakeWriteLoopExecutor().executor,
    failureReporter: () => {},
    hasMemoryHeadroom: () => true,
    resolveStage,
  });

  const pipelineId = stateStore.createPipeline({ definition: REOPEN_DEFINITION, context: ADMISSION_CONTEXT });
  stateStore.updateStage({ pipelineId, stageId: "s1", patch: { status: "succeeded", workflowInvocationId: "inv-1" } });
  stateStore.updateStage({ pipelineId, stageId: "s2", patch: { status: "failed" } });

  const response = await resumeHandlers.pipeline_resume(
    requestFrame("resume", "pipeline_resume", { pipelineId }),
    new AbortController().signal,
  );
  expect(response).toEqual({ kind: "response", result: { kind: "resumed", pipelineId } });
  expect(stateStore.loadPipeline(pipelineId)?.stages.find((stage) => stage.stageId === "s2")?.status).toBe("pending");

  stage2.settle();
  await waitFor(
    () => stateStore.loadPipeline(pipelineId)?.stages.find((stage) => stage.stageId === "s2")?.status === "succeeded",
  );
  await flushBackgroundRuns();
  expect(stateStore.loadPipeline(pipelineId)?.stages.find((stage) => stage.stageId === "s2")?.status).toBe("succeeded");
});

test("pipeline_resume on awaiting-approval returns missing_context without dispatch", async () => {
  const pipelineId = stateStore.createPipeline({ definition: APPROVAL_DEFINITION, context: ADMISSION_CONTEXT });
  stateStore.updateStage({
    pipelineId,
    stageId: "s1",
    patch: { status: "succeeded", workflowInvocationId: "inv-1" },
  });
  stateStore.updateStage({ pipelineId, stageId: "gate", patch: { status: "awaiting" } });
  const raw = new Database(dbPath);
  try {
    raw.prepare("UPDATE pipelines SET context = NULL WHERE id = ?").run(pipelineId);
  } finally {
    raw.close();
  }

  const response = await handlers.pipeline_resume(
    requestFrame("resume", "pipeline_resume", { pipelineId }),
    new AbortController().signal,
  );
  expect(response).toEqual({
    kind: "response",
    result: { kind: "refused", pipelineId, reason: "missing_context" },
  });
  expect(stateStore.loadPipeline(pipelineId)?.stages.find((stage) => stage.stageId === "s3")?.status).toBe("pending");
});

test("pipeline_resume on awaiting-approval returns claim_refused without dispatch", async () => {
  const pipelineId = stateStore.createPipeline({ definition: APPROVAL_DEFINITION, context: ADMISSION_CONTEXT });
  stateStore.updateStage({
    pipelineId,
    stageId: "s1",
    patch: { status: "succeeded", workflowInvocationId: "inv-1" },
  });
  stateStore.updateStage({ pipelineId, stageId: "gate", patch: { status: "awaiting" } });

  const claimRefusingStore = Object.create(stateStore) as StateStore;
  claimRefusingStore.claimPipelineContinuation = () => ({
    kind: "refused",
    pipelineId,
    reason: "claim_lost",
  });
  const claimHandlers = createRunControlHandlers({
    stateStore: claimRefusingStore,
    writeLoopExecutor: createFakeWriteLoopExecutor().executor,
    failureReporter: () => {},
    hasMemoryHeadroom: () => true,
    resolveStage: async () => ({ ok: true, steps: [] }),
  });

  const response = await claimHandlers.pipeline_resume(
    requestFrame("resume", "pipeline_resume", { pipelineId }),
    new AbortController().signal,
  );
  expect(response).toEqual({
    kind: "response",
    result: { kind: "refused", pipelineId, reason: "claim_refused" },
  });
  expect(stateStore.loadPipeline(pipelineId)?.stages.find((stage) => stage.stageId === "gate")?.status).toBe(
    "awaiting",
  );
  expect(stateStore.loadPipeline(pipelineId)?.stages.find((stage) => stage.stageId === "s3")?.status).toBe("pending");
});
