import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { AsyncSubprocessRunner } from "../../../shared/subprocess.ts";
import { trackedMkdtempSync } from "../../../shared/tracked-temp-dir.test-support.ts";
import { REVIEW_FEEDBACK_WRITE_NOT_AVAILABLE } from "../commands/review-feedback-workflow-admission.ts";
import { getExternalWorktreePath } from "../execution/external-worktree.ts";
import type { PipelineDefinition } from "../execution/pipeline-definition.ts";
import { WORKFLOW_PRESET_BUILDERS } from "../execution/workflow-presets.ts";
import type { AnyWorkflowStep, WriteWorkflowStep } from "../execution/workflow-runner.ts";
import type { ReviewFeedbackLaneResolutionStore } from "../persistence/review-feedback-lane-resolution.ts";
import {
  DEFAULT_PIPELINE_STAGE_BRANCH_KEY,
  type Pipeline,
  type PipelineStageRecord,
  type Run,
  type StateStore,
} from "../persistence/state-store.ts";
import { writeHomeMachineConfig } from "../testing/cli-test-helpers.ts";
import {
  executePipelineStageReviewFeedbackLaunch,
  parsePipelineStageReviewFeedbackLaunchParams,
} from "./pipeline-stage-review-feedback-launch.ts";

const PROJECT = "jarvis";
const BRANCH = "lane-branch";

let fixtureRoot: string;
let machineConfigPath: string;
let worktreePath: string;

beforeAll(() => {
  fixtureRoot = trackedMkdtempSync(join(process.cwd(), ".scratch", "pipeline-stage-review-feedback-launch-unit-"));
  mkdirSync(fixtureRoot, { recursive: true });
  machineConfigPath = writeHomeMachineConfig();
  worktreePath = trackedMkdtempSync("pipeline-stage-review-feedback-launch-wt-");
  mkdirSync(worktreePath, { recursive: true });
});

afterAll(() => {
  rmSync(fixtureRoot, { recursive: true, force: true });
});

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

function succeededIntentPipelineStage(branchKeys: string[] = [DEFAULT_PIPELINE_STAGE_BRANCH_KEY]): {
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
    worktreePath,
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
    admittedSelection: null,
    terminalPublicationFailure: null,
    terminalPublicationSucceededAt: null,
    supersedeFailures: null,
    dismissedAt: null,
    stages: branchKeys.map((branchKey, index) => ({
      id: `stage-row-${index + 1}`,
      pipelineId,
      stageId,
      branchKey,
      position: 0,
      status: "succeeded",
      workflowInvocationId: entryRun.id,
      startedAt: 1,
      endedAt: 2,
      artifact: null,
      failureDetail: null,
      decidedAt: null,
    })),
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

  test("forwards explicit branchKey to select a fan-out stage row", async () => {
    // Mutation checkpoint: in-body mutation on `params.branchKey !== undefined` at pipeline-stage-review-feedback-launch.ts:65 must turn this RED.
    const { store, pipelineId, stageId } = succeededIntentPipelineStage(["b1", "b2"]);
    const deps = {
      store,
      subprocessRunner: noopRunner,
      machineConfigPath,
      resolveProjectRoot: () => undefined,
      builder: WORKFLOW_PRESET_BUILDERS["review-feedback"],
      handleWorkflowStart: (): { kind: "response"; result: null } => ({ kind: "response", result: null }),
    };
    const withoutBranchKey = await executePipelineStageReviewFeedbackLaunch({ pipelineId, stageId }, deps);
    expect(withoutBranchKey).toEqual({
      kind: "error",
      code: "review_feedback_lane_unmatched",
      message: "missing required flag --branch-key for fan-out stage",
    });
    const withBranchKey = await executePipelineStageReviewFeedbackLaunch(
      { pipelineId, stageId, branchKey: "b2" },
      deps,
    );
    expect(withBranchKey).toEqual({
      kind: "error",
      code: REVIEW_FEEDBACK_WRITE_NOT_AVAILABLE,
      message: `review-feedback: unregistered project ${PROJECT}`,
    });
  });

  test("continues when lane resolves and refuses unregistered project", async () => {
    const { store, pipelineId, stageId } = succeededIntentPipelineStage();
    const result = await executePipelineStageReviewFeedbackLaunch(
      { pipelineId, stageId },
      {
        store,
        subprocessRunner: noopRunner,
        machineConfigPath,
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

  test("returns admission refusal when preparation fails without starting workflow", async () => {
    const runner = createGhRunner(openReviewedAdmissionView(BRANCH, { reviews: [] }));
    const { store, pipelineId, stageId } = succeededIntentPipelineStage();
    let startCalled = false;
    const result = await executePipelineStageReviewFeedbackLaunch(
      { pipelineId, stageId },
      {
        store,
        subprocessRunner: runner,
        machineConfigPath,
        resolveProjectRoot: () => fixtureRoot,
        builder: WORKFLOW_PRESET_BUILDERS["review-feedback"],
        handleWorkflowStart: () => {
          startCalled = true;
          return { kind: "response", result: { runId: "should-not-run" } };
        },
      },
    );
    expect(result).toMatchObject({ kind: "error", code: "review_feedback_pr_no_review" });
    expect(startCalled).toBe(false);
  });

  test("starts workflow when admission preparation succeeds", async () => {
    const runner = createGhRunner(openReviewedAdmissionView(BRANCH));
    const { store, pipelineId, stageId } = succeededIntentPipelineStage();
    let admittedSteps: AnyWorkflowStep[] | undefined;
    const result = await executePipelineStageReviewFeedbackLaunch(
      { pipelineId, stageId },
      {
        store,
        subprocessRunner: runner,
        machineConfigPath,
        resolveProjectRoot: () => fixtureRoot,
        builder: WORKFLOW_PRESET_BUILDERS["review-feedback"],
        handleWorkflowStart: (steps) => {
          admittedSteps = steps;
          return { kind: "response", result: { runId: "rf-run" } };
        },
      },
    );
    expect(result).toEqual({ kind: "response", result: { runId: "rf-run" } });
    expect(admittedSteps?.length).toBeGreaterThan(0);
    const writeStep = admittedSteps?.[0] as WriteWorkflowStep | undefined;
    expect(writeStep?.behavior).toBe("write");
    expect(writeStep?.worktree.projectRoot).toBe(fixtureRoot);
    if (writeStep === undefined) throw new Error("expected write step");
    expect(getExternalWorktreePath(writeStep.worktree)).toBe(worktreePath);
    expect(writeStep?.reviewFeedbackLane).toMatchObject({
      pipelineId,
      stageId,
      branchKey: DEFAULT_PIPELINE_STAGE_BRANCH_KEY,
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
