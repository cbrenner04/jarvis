import { describe, expect, test } from "bun:test";
import type { AsyncSubprocessRunner } from "../../../shared/subprocess.ts";
import { REVIEW_FEEDBACK_WRITE_NOT_AVAILABLE } from "../commands/review-feedback-workflow-admission.ts";
import type { PipelineDefinition } from "../execution/pipeline-definition.ts";
import { WORKFLOW_PRESET_BUILDERS } from "../execution/workflow-presets.ts";
import type { ReviewFeedbackLaneResolutionStore } from "../persistence/review-feedback-lane-resolution.ts";
import {
  DEFAULT_PIPELINE_STAGE_BRANCH_KEY,
  type Pipeline,
  type PipelineStageRecord,
  type Run,
  type StateStore,
} from "../persistence/state-store.ts";
import {
  executePipelineStageReviewFeedbackLaunch,
  parsePipelineStageReviewFeedbackLaunchParams,
} from "./pipeline-stage-review-feedback-launch.ts";

const PROJECT = "jarvis";
const BRANCH = "lane-branch";

function workflowSnapshot(
  invocationId: string,
  firstStep: { stepId: string; role: string; promptId: string },
): NonNullable<Run["workflowSnapshot"]> {
  return { invocationId, steps: [firstStep] };
}

function laneResolutionStore(args: {
  runs: Run[];
  pipelines?: Array<Pipeline & { stages: PipelineStageRecord[] }>;
}): StateStore {
  const runs = args.runs;
  const pipelines = args.pipelines ?? [];
  const base: ReviewFeedbackLaneResolutionStore = {
    listRuns: () => runs,
    findRunsByInvocationId: (invocationId) => runs.filter((run) => run.workflowSnapshot?.invocationId === invocationId),
    loadRun: (runId) => (runs.find((run) => run.id === runId) ?? null) as ReturnType<StateStore["loadRun"]>,
    loadPipeline: (pipelineId) => pipelines.find((pipeline) => pipeline.id === pipelineId) ?? null,
  };
  return base as StateStore;
}

function succeededIntentPipelineStage(): {
  store: StateStore;
  pipelineId: string;
  stageId: string;
} {
  const entryRun: Run = {
    id: "pipeline-intent-entry",
    project: PROJECT,
    specRef: "main",
    createdAt: 1,
    status: "completed",
    attemptCount: 0,
    worktreePath: "/worktrees/lane",
    branch: BRANCH,
    specPath: "spec.md",
    prNumber: 42,
    prUrl: "https://example.test/pull/42",
    stepId: "intent-step",
    workflowSnapshot: workflowSnapshot("inv-pipeline-intent", {
      stepId: "intent-step",
      role: "author",
      promptId: "intent.prompt.split",
    }),
  };
  const pipelineId = "pipe-intent";
  const stageId = "intent-stage";
  const definition: PipelineDefinition = {
    name: "test-pipeline",
    stages: [{ stageId, kind: "workflow", workflow: "intent", review: "none" }],
  };
  const pipeline: Pipeline & { stages: PipelineStageRecord[] } = {
    id: pipelineId,
    name: "test-pipeline",
    createdAt: 1,
    ownerIdentity: "owner",
    status: "active",
    definition,
    context: null,
    terminalPublicationFailure: null,
    terminalPublicationSucceededAt: null,
    supersedeFailures: null,
    dismissedAt: null,
    stages: [
      {
        id: "stage-row-1",
        pipelineId,
        stageId,
        branchKey: DEFAULT_PIPELINE_STAGE_BRANCH_KEY,
        position: 0,
        status: "succeeded",
        workflowInvocationId: entryRun.id,
        startedAt: 1,
        endedAt: 2,
        artifact: null,
        failureDetail: null,
        decidedAt: null,
      },
    ],
  };
  return { store: laneResolutionStore({ runs: [entryRun], pipelines: [pipeline] }), pipelineId, stageId };
}

const noopRunner: AsyncSubprocessRunner = { runAsync: async () => "" };

describe("executePipelineStageReviewFeedbackLaunch", () => {
  test("returns lane refusal when stage lane does not resolve", async () => {
    const result = await executePipelineStageReviewFeedbackLaunch(
      { pipelineId: "missing-pipe", stageId: "intent-stage" },
      {
        store: laneResolutionStore({ runs: [] }),
        subprocessRunner: noopRunner,
        machineConfigPath: "/tmp/machine.json",
        resolveProjectRoot: () => "/repo",
        builder: WORKFLOW_PRESET_BUILDERS["review-feedback"],
        handleWorkflowStart: () => ({ kind: "response", result: null }),
      },
    );
    expect(result).toEqual({
      kind: "error",
      code: "review_feedback_lane_unmatched",
      message: "pipeline missing-pipe not found",
    });
  });

  test("continues when lane resolves and refuses unregistered project", async () => {
    const { store, pipelineId, stageId } = succeededIntentPipelineStage();
    const result = await executePipelineStageReviewFeedbackLaunch(
      { pipelineId, stageId },
      {
        store,
        subprocessRunner: noopRunner,
        machineConfigPath: "/tmp/machine.json",
        resolveProjectRoot: () => undefined,
        builder: WORKFLOW_PRESET_BUILDERS["review-feedback"],
        handleWorkflowStart: () => ({ kind: "response", result: null }),
      },
    );
    expect(result).toEqual({
      kind: "error",
      code: REVIEW_FEEDBACK_WRITE_NOT_AVAILABLE,
      message: `review-feedback: unregistered project ${PROJECT}`,
    });
  });
});

describe("parsePipelineStageReviewFeedbackLaunchParams", () => {
  test("accepts params when branchKey is omitted", () => {
    expect(parsePipelineStageReviewFeedbackLaunchParams({ pipelineId: "p1", stageId: "s1" })).toEqual({
      ok: true,
      value: { pipelineId: "p1", stageId: "s1" },
    });
  });

  test("accepts params when branchKey is explicitly undefined", () => {
    expect(
      parsePipelineStageReviewFeedbackLaunchParams({ pipelineId: "p1", stageId: "s1", branchKey: undefined }),
    ).toEqual({
      ok: true,
      value: { pipelineId: "p1", stageId: "s1" },
    });
  });

  test("rejects empty branchKey with invalid_params message", () => {
    expect(parsePipelineStageReviewFeedbackLaunchParams({ pipelineId: "p1", stageId: "s1", branchKey: "" })).toEqual({
      ok: false,
      message: "branchKey must be a non-empty string when provided",
    });
  });

  test("includes non-empty branchKey in parsed value", () => {
    expect(
      parsePipelineStageReviewFeedbackLaunchParams({ pipelineId: "p1", stageId: "s1", branchKey: "main" }),
    ).toEqual({
      ok: true,
      value: { pipelineId: "p1", stageId: "s1", branchKey: "main" },
    });
  });
});
