import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PipelineDefinition } from "../execution/pipeline-definition.ts";
import { openStateStore, type StateStore } from "../persistence/state-store.ts";
import { flushBackgroundRuns } from "../testing/run-control.ts";
import { createFakeWriteLoopExecutor } from "../testing/write-loop-executor.ts";
import { createRunControlHandlerContext } from "./daemon-run-control-context.ts";
import { createRunLifecycleHandlers } from "./daemon-run-lifecycle-handlers.ts";
import { createWorkflowStartAdmission } from "./daemon-workflow-admission-handlers.ts";

type ResumePipelineOptionsCapture = { allowLanePrRepublish?: boolean };
const resumePipelineOptionsCaptures: ResumePipelineOptionsCapture[] = [];

mock.module("./pipeline-execution.ts", () => {
  const pe = require("./pipeline-execution.ts") as typeof import("./pipeline-execution.ts");
  return {
    ...pe,
    resumePipeline: async (pipelineId: string, _deps: unknown, options: ResumePipelineOptionsCapture) => {
      resumePipelineOptionsCaptures.push(options);
      return { kind: "refused" as const, pipelineId, reason: "pipeline_terminal_succeeded" as const };
    },
  };
});

import { createPipelineHandlers } from "./daemon-pipeline-handlers.ts";

const CONTEXT = { cwd: "/fake", seed: "seed text", configPath: "/fake/.jarvis/config.json" };

const SINGLE_STAGE_DEFINITION: PipelineDefinition = {
  name: "resume-republish-probe",
  stages: [{ stageId: "only", kind: "workflow", workflow: "intent", review: "none" }],
};

function requestFrame(id: string, method: string, params?: unknown) {
  return { kind: "request" as const, id, method, params };
}

let stateStore: StateStore;

beforeEach(() => {
  resumePipelineOptionsCaptures.length = 0;
  const dbPath = join(tmpdir(), `handlers-resume-republish-${process.pid}-${Date.now()}.db`);
  stateStore = openStateStore(dbPath);
});

afterEach(async () => {
  await flushBackgroundRuns();
  try {
    stateStore.close();
  } catch {
    // already closed
  }
});

function resumeHandlers() {
  const fakeExecutor = createFakeWriteLoopExecutor();
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
  return createPipelineHandlers(ctx, {
    pipelineDispatch: lifecycle.pipelineDispatch,
    pipelineWait: lifecycle.pipelineWait,
    admitWorkflowStart: workflowStart.admitWorkflowStart,
    handleWorkflowStart: workflowStart.handleWorkflowStart,
  });
}

function seedTerminalPipeline(): string {
  const pipelineId = stateStore.createPipeline({
    definition: SINGLE_STAGE_DEFINITION,
    context: CONTEXT,
  });
  stateStore.updateStage({
    pipelineId,
    stageId: "only",
    patch: { status: "succeeded", workflowInvocationId: "inv-probe" },
  });
  return pipelineId;
}

test.each([
  { rpcAllowLanePrRepublish: undefined, expectedInResumeOptions: undefined },
  { rpcAllowLanePrRepublish: true, expectedInResumeOptions: true },
] as const)("pipeline_resume forwards allowLanePrRepublish to resumePipeline only when RPC sets true (rpc=$rpcAllowLanePrRepublish)", async ({
  rpcAllowLanePrRepublish,
  expectedInResumeOptions,
}) => {
  const pipelineId = seedTerminalPipeline();
  const handlers = resumeHandlers();
  const response = await handlers.pipeline_resume(
    requestFrame("resume-republish-probe", "pipeline_resume", {
      pipelineId,
      ...(rpcAllowLanePrRepublish === true ? { allowLanePrRepublish: true } : {}),
    }),
    new AbortController().signal,
  );
  expect(response).toEqual({
    kind: "response",
    result: { kind: "refused", pipelineId, reason: "pipeline_terminal_succeeded" },
  });
  expect(resumePipelineOptionsCaptures).toHaveLength(1);
  expect(resumePipelineOptionsCaptures[0]?.allowLanePrRepublish).toBe(expectedInResumeOptions);
});
