import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AsyncSubprocessRunner } from "../../../shared/subprocess.ts";
import { trackedMkdtempSync } from "../../../shared/tracked-temp-dir.test-support.ts";
import type { PipelineDefinition } from "../execution/pipeline-definition.ts";
import { WORKFLOW_PRESET_BUILDERS } from "../execution/workflow-presets.ts";
import type { AnyWorkflowStep } from "../execution/workflow-runner.ts";
import { openStateStore, type StateStore } from "../persistence/state-store.ts";
import { removeOrchestrationStore } from "../persistence/state-store-on-disk.ts";
import { writeHomeMachineConfig } from "../testing/cli-test-helpers.ts";
import { flushBackgroundRuns } from "../testing/run-control.ts";
import { createFakeWriteLoopExecutor } from "../testing/write-loop-executor.ts";
import { createPipelineHandlers } from "./daemon-pipeline-handlers.ts";
import { createRunControlHandlerContext } from "./daemon-run-control-context.ts";
import { createRunLifecycleHandlers } from "./daemon-run-lifecycle-handlers.ts";
import type { WorkflowStartResult } from "./daemon-workflow-admission-handlers.ts";
import { createWorkflowStartAdmission } from "./daemon-workflow-admission-handlers.ts";

const PROJECT = "demo";
const BRANCH = "lane-branch";
const STAGE_BY_WORKFLOW = {
  intent: "intent-stage",
  plan: "plan-stage",
  implement: "implement-stage",
} as const;

type StageWorkflow = keyof typeof STAGE_BY_WORKFLOW;

let dbPath: string;
let stateStore: StateStore;
let fixtureRoot: string;
let machineConfigPath: string;
let worktreePathForCapture: string;
let fakeExecutor: ReturnType<typeof createFakeWriteLoopExecutor>;

const ADMISSION_CONTEXT = {
  cwd: "",
  seed: "seed text",
  configPath: "",
};

function requestFrame(id: string, method: string, params?: unknown) {
  return { kind: "request" as const, id, method, params };
}

function pipelineSnapshot(store: StateStore, pipelineId: string): string {
  return JSON.stringify(store.loadPipeline(pipelineId));
}

function workflowSnapshot(
  invocationId: string,
  step: { stepId: string; role: string; promptId: string },
): NonNullable<Parameters<StateStore["createRun"]>[0]["workflowSnapshot"]> {
  return { invocationId, steps: [{ ...step, durable: true }] };
}

function stepForWorkflow(workflow: StageWorkflow): { stepId: string; role: string; promptId: string } {
  switch (workflow) {
    case "intent":
      return { stepId: "intent-step", role: "author", promptId: "intent.prompt.split" };
    case "plan":
      return { stepId: "plan-step", role: "author", promptId: "plan.prompt.draft" };
    case "implement":
      return { stepId: "implement-step", role: "implement", promptId: "implement.prompt.body" };
  }
}

function openReviewedAdmissionView(branch: string, overrides: Record<string, unknown> = {}) {
  return {
    state: "OPEN",
    headRefName: branch,
    url: "https://github.com/owner/repo/pull/42",
    isDraft: true,
    reviews: [{ submittedAt: "2026-05-10T00:00:00Z" }],
    ...overrides,
  };
}

function createGhRunner(admissionView: ReturnType<typeof openReviewedAdmissionView>): AsyncSubprocessRunner {
  return {
    runAsync: async (cmd, args, cwd) => {
      if (cmd !== "gh") throw new Error(`unexpected command ${cmd}`);
      if (args[0] === "pr" && args[1] === "view" && args.some((arg) => arg.includes("isDraft"))) {
        return JSON.stringify(admissionView);
      }
      if (args[0] === "repo" && args[1] === "view") return "owner/repo\n";
      if (args[0] === "api" && args[1] === "graphql") {
        return JSON.stringify({ data: { repository: { pullRequest: { reviewThreads: { nodes: [] } } } } });
      }
      if (args[0] === "pr" && args[1] === "view" && args.includes("reviews,comments")) {
        return JSON.stringify({ reviews: admissionView.reviews, comments: [] });
      }
      throw new Error(`unexpected gh invocation: ${args.join(" ")} in ${cwd}`);
    },
  };
}

function seedSucceededReviewFeedbackStage(
  store: StateStore,
  workflow: StageWorkflow,
  worktreePath: string,
): { pipelineId: string; stageId: string; entryRunId: string; branch: string } {
  const stageId = STAGE_BY_WORKFLOW[workflow];
  const branch = `${workflow}-${BRANCH}`;
  const step = stepForWorkflow(workflow);
  const invocationId = `inv-${workflow}-launch`;
  const entryRunId = store.createRun({
    project: PROJECT,
    specRef: "main",
    worktreePath,
    branch,
    specPath: "spec.md",
    status: "completed",
    stepId: step.stepId,
    workflowSnapshot: workflowSnapshot(invocationId, step),
  });
  store.setPrEvidence(entryRunId, 42, "https://example.test/pull/42");
  const definition: PipelineDefinition = {
    name: "review-feedback-launch",
    stages: [{ stageId, kind: "workflow", workflow, review: "none" }],
  };
  const pipelineId = store.createPipeline({ definition, context: ADMISSION_CONTEXT });
  store.updateStage({
    pipelineId,
    stageId,
    patch: { status: "succeeded", workflowInvocationId: entryRunId, startedAt: 1, endedAt: 2 },
  });
  return { pipelineId, stageId, entryRunId, branch };
}

function launchHandlers(
  runner: AsyncSubprocessRunner,
  handleWorkflowStartOverride?: (steps: AnyWorkflowStep[]) => WorkflowStartResult,
) {
  const ctx = createRunControlHandlerContext({
    stateStore,
    writeLoopExecutor: fakeExecutor.executor,
    failureReporter: () => {},
    hasMemoryHeadroom: () => true,
  });
  const workflowStart = createWorkflowStartAdmission(ctx);
  const handleWorkflowStart = handleWorkflowStartOverride ?? workflowStart.handleWorkflowStart;
  const lifecycle = createRunLifecycleHandlers(ctx, {
    handleWorkflowStart: workflowStart.handleWorkflowStart,
  });
  return createPipelineHandlers(ctx, {
    pipelineDispatch: lifecycle.pipelineDispatch,
    pipelineWait: lifecycle.pipelineWait,
    admitWorkflowStart: workflowStart.admitWorkflowStart,
    handleWorkflowStart,
    reviewFeedbackLaunch: {
      subprocessRunner: runner,
      machineConfigPath,
      resolveProjectRoot: (projectKey) => (projectKey === PROJECT ? fixtureRoot : undefined),
      builder: WORKFLOW_PRESET_BUILDERS["review-feedback"],
    },
  });
}

beforeAll(() => {
  fixtureRoot = trackedMkdtempSync(join(process.cwd(), ".scratch", "pipeline-stage-review-feedback-launch-"));
  mkdirSync(fixtureRoot, { recursive: true });
  machineConfigPath = writeHomeMachineConfig();
  worktreePathForCapture = trackedMkdtempSync("pipeline-stage-review-feedback-launch-wt-");
  ADMISSION_CONTEXT.cwd = fixtureRoot;
  ADMISSION_CONTEXT.configPath = machineConfigPath;
});

afterAll(() => {
  rmSync(fixtureRoot, { recursive: true, force: true });
});

beforeEach(() => {
  dbPath = join(tmpdir(), `jarvis-pipeline-stage-review-feedback-launch-${process.pid}-${Date.now()}.db`);
  removeOrchestrationStore(dbPath);
  stateStore = openStateStore(dbPath);
  fakeExecutor = createFakeWriteLoopExecutor();
});

afterEach(async () => {
  fakeExecutor.abortAll();
  await flushBackgroundRuns();
  stateStore.close();
});

describe("pipeline_stage_review_feedback_launch", () => {
  test.each([
    "intent",
    "plan",
    "implement",
  ] as const)("admits succeeded %s stage with an open reviewed PR without mutating pipeline rows", async (workflow) => {
    const branch = `${workflow}-${BRANCH}`;
    const worktreePath = join(worktreePathForCapture, workflow);
    mkdirSync(worktreePath, { recursive: true });
    const runner = createGhRunner(openReviewedAdmissionView(branch));
    let admittedSteps: AnyWorkflowStep[] | undefined;
    const handlers = launchHandlers(runner, (steps) => {
      admittedSteps = steps;
      return { kind: "response", result: { runId: `review-feedback-${workflow}` } };
    });
    const { pipelineId, stageId } = seedSucceededReviewFeedbackStage(stateStore, workflow, worktreePath);
    const before = pipelineSnapshot(stateStore, pipelineId);

    const response = await handlers.pipeline_stage_review_feedback_launch(
      requestFrame("launch", "pipeline_stage_review_feedback_launch", { pipelineId, stageId }),
      new AbortController().signal,
    );

    expect(response.kind).toBe("response");
    if (response.kind !== "response") throw new Error("expected response");
    expect(response.result).toEqual({ runId: `review-feedback-${workflow}` });
    expect(admittedSteps?.length).toBeGreaterThan(0);
    expect(admittedSteps?.[0]?.behavior).toBe("write");
    expect(pipelineSnapshot(stateStore, pipelineId)).toBe(before);
  });

  test("refuses unknown stage by review_feedback_lane_unmatched without mutating pipeline rows", async () => {
    const branch = `intent-${BRANCH}`;
    const runner = createGhRunner(openReviewedAdmissionView(branch));
    const handlers = launchHandlers(runner);
    const { pipelineId } = seedSucceededReviewFeedbackStage(
      stateStore,
      "intent",
      join(worktreePathForCapture, "intent-unknown"),
    );
    const before = pipelineSnapshot(stateStore, pipelineId);

    const response = await handlers.pipeline_stage_review_feedback_launch(
      requestFrame("refuse-unknown", "pipeline_stage_review_feedback_launch", {
        pipelineId,
        stageId: "missing-stage",
      }),
      new AbortController().signal,
    );

    expect(response).toEqual({
      kind: "error",
      code: "review_feedback_lane_unmatched",
      message: `pipeline ${pipelineId} has no workflow stage missing-stage`,
    });
    expect(pipelineSnapshot(stateStore, pipelineId)).toBe(before);
  });

  test("refuses unfinished stage by review_feedback_lane_unmatched without mutating pipeline rows", async () => {
    const branch = `plan-${BRANCH}`;
    const runner = createGhRunner(openReviewedAdmissionView(branch));
    const handlers = launchHandlers(runner);
    const { pipelineId, stageId } = seedSucceededReviewFeedbackStage(
      stateStore,
      "plan",
      join(worktreePathForCapture, "plan-unfinished"),
    );
    stateStore.updateStage({ pipelineId, stageId, patch: { status: "running", workflowInvocationId: null } });
    const before = pipelineSnapshot(stateStore, pipelineId);

    const response = await handlers.pipeline_stage_review_feedback_launch(
      requestFrame("refuse-unfinished", "pipeline_stage_review_feedback_launch", { pipelineId, stageId }),
      new AbortController().signal,
    );

    expect(response).toEqual({
      kind: "error",
      code: "review_feedback_lane_unmatched",
      message: `stage ${stageId} is not succeeded`,
    });
    expect(pipelineSnapshot(stateStore, pipelineId)).toBe(before);
  });

  test("refuses open PR with no review by review_feedback_pr_no_review without mutating pipeline rows", async () => {
    const branch = `implement-${BRANCH}`;
    const runner = createGhRunner(openReviewedAdmissionView(branch, { reviews: [] }));
    const handlers = launchHandlers(runner);
    const { pipelineId, stageId } = seedSucceededReviewFeedbackStage(
      stateStore,
      "implement",
      join(worktreePathForCapture, "implement-no-review"),
    );
    const before = pipelineSnapshot(stateStore, pipelineId);

    const response = await handlers.pipeline_stage_review_feedback_launch(
      requestFrame("refuse-no-review", "pipeline_stage_review_feedback_launch", { pipelineId, stageId }),
      new AbortController().signal,
    );

    expect(response).toMatchObject({ kind: "error", code: "review_feedback_pr_no_review" });
    expect(pipelineSnapshot(stateStore, pipelineId)).toBe(before);
  });
});
