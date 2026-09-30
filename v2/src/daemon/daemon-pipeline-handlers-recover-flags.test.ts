import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { PipelineDefinition } from "../execution/pipeline-definition.ts";
import { openStateStore, type StateStore } from "../persistence/state-store.ts";
import { flushBackgroundRuns } from "../testing/run-control.ts";
import { createFakeWriteLoopExecutor } from "../testing/write-loop-executor.ts";
import { createRunControlHandlerContext } from "./daemon-run-control-context.ts";
import { createRunLifecycleHandlers } from "./daemon-run-lifecycle-handlers.ts";
import { createWorkflowStartAdmission } from "./daemon-workflow-admission-handlers.ts";

type RecoverProbeOptions = { resetDespiteDirty?: boolean; resetDespiteLandedCriteria?: boolean };
const recoverProbeCaptures: RecoverProbeOptions[] = [];

mock.module("./pipeline-execution.ts", () => {
  const pe = require("./pipeline-execution.ts") as typeof import("./pipeline-execution.ts");
  return {
    ...pe,
    probePipelineRecoverRedispatchRefusal: async (
      _pipelineId: string,
      _recoveryTarget: { stageId: string; branchKey: string },
      _deps: unknown,
      options: RecoverProbeOptions,
    ) => {
      recoverProbeCaptures.push(options);
      return { refused: true, message: "probe refusal" };
    },
  };
});

import { createPipelineHandlers } from "./daemon-pipeline-handlers.ts";

const CONTEXT = { cwd: "/fake", seed: "seed text", configPath: "/fake/.jarvis/config.json" };

const SINGLE_DEFINITION: PipelineDefinition = {
  name: "solo",
  stages: [
    { stageId: "intent", kind: "workflow", workflow: "intent", review: "none" },
    { stageId: "plan", kind: "workflow", workflow: "plan", review: "debate" },
  ],
};

function requestFrame(id: string, method: string, params?: unknown) {
  return { kind: "request" as const, id, method, params };
}

function seedBlockedPlanDraftRun(
  store: StateStore,
  args: {
    project: string;
    branch: string;
    worktreePath: string;
    specPath: string;
    stepId: string;
    invocationId: string;
  },
): string {
  const runId = store.createRun({
    project: args.project,
    specRef: "HEAD",
    worktreePath: args.worktreePath,
    branch: args.branch,
    specPath: args.specPath,
    stepId: args.stepId,
    workflowSnapshot: {
      invocationId: args.invocationId,
      steps: [
        {
          stepId: args.stepId,
          role: "plan",
          expectedArtifactPath: ".jarvis-plan-stage",
          agents: ["claude"],
          landingInputs: { sourceRoot: args.worktreePath, paths: [], consumeFrom: "worktree" },
        },
        { stepId: "plan-review", role: "", behavior: "review" },
      ],
    },
  });
  const attemptId = store.recordAttemptStart(runId);
  store.commitCompletionBoundary({ attemptId, runStatus: "blocked", outcomeKind: "contract_miss" });
  return runId;
}

let stateStore: StateStore;

beforeEach(() => {
  recoverProbeCaptures.length = 0;
  const dbPath = join(tmpdir(), `handlers-recover-flags-${process.pid}-${Date.now()}.db`);
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

function recoverHandlers() {
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
    daemonSocketPath: "/handlers-recover-flags.sock",
  });
}

function seedRecoverablePipeline(): string {
  const entryRunId = seedBlockedPlanDraftRun(stateStore, {
    project: "demo",
    branch: "plan/recover-flags",
    worktreePath: "/fake/worktree/recover-flags",
    specPath: "spec/recover-flags",
    stepId: "plan",
    invocationId: "handlers-recover-flags-inv",
  });
  const pipelineId = stateStore.createPipeline({ definition: SINGLE_DEFINITION, context: CONTEXT });
  stateStore.updateStage({
    pipelineId,
    stageId: "intent",
    patch: {
      status: "succeeded",
      workflowInvocationId: "run-intent",
      artifact: { entryRunId: "run-intent", specPath: "ready-intents/solo.md" },
    },
  });
  stateStore.updateStage({
    pipelineId,
    stageId: "plan",
    patch: { status: "failed", workflowInvocationId: entryRunId, failureDetail: { message: "blocked" } },
  });
  return pipelineId;
}

test.each([
  { resetDespiteDirty: true, resetDespiteLandedCriteria: false },
  { resetDespiteDirty: false, resetDespiteLandedCriteria: true },
] as const)("pipeline_recover maps resetDespiteDirty to recover preflight (dirty=$resetDespiteDirty landed=$resetDespiteLandedCriteria)", async ({
  resetDespiteDirty,
  resetDespiteLandedCriteria,
}) => {
  const pipelineId = seedRecoverablePipeline();
  const handlers = recoverHandlers();
  const response = await handlers.pipeline_recover(
    requestFrame("recover-flags", "pipeline_recover", {
      pipelineId,
      branchKey: "default",
      resetDespiteDirty,
      resetDespiteLandedCriteria,
    }),
    new AbortController().signal,
  );
  expect(response).toEqual({
    kind: "error",
    code: "recover_dispatch_refused",
    message: "probe refusal",
  });
  expect(recoverProbeCaptures).toEqual([
    {
      resetDespiteDirty: resetDespiteDirty === true,
      resetDespiteLandedCriteria: resetDespiteLandedCriteria === true,
    },
  ]);
});
