import { describe, expect, test } from "bun:test";
import type { PipelineDefinition } from "../execution/pipeline-definition.ts";
import {
  type ReviewFeedbackLaneResolutionStore,
  resolveReviewFeedbackLane,
} from "./review-feedback-lane-resolution.ts";
import {
  DEFAULT_PIPELINE_STAGE_BRANCH_KEY,
  type Pipeline,
  type PipelineStageRecord,
  type Run,
  type StateStore,
} from "./state-store.ts";

const PROJECT = "jarvis";
const BRANCH = "lane-branch";
const WORKTREE = "/worktrees/lane";

function workflowSnapshot(
  invocationId: string,
  firstStep: { stepId: string; role: string; promptId?: string },
  extraSteps: Array<{ stepId: string; role: string; promptId?: string }> = [],
): NonNullable<Run["workflowSnapshot"]> {
  return {
    invocationId,
    steps: [firstStep, ...extraSteps],
  };
}

function baseRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    project: PROJECT,
    specRef: "main",
    createdAt: 1,
    status: "completed",
    attemptCount: 0,
    worktreePath: WORKTREE,
    branch: BRANCH,
    specPath: "spec.md",
    prNumber: 42,
    prUrl: "https://example.test/pull/42",
    stepId: "step-1",
    workflowSnapshot: workflowSnapshot("inv-1", {
      stepId: "step-1",
      role: "author",
      promptId: "intent.prompt.split",
    }),
    ...overrides,
  };
}

function memoryStore(args: {
  runs: Run[];
  pipelines?: Array<Pipeline & { stages: PipelineStageRecord[] }>;
}): ReviewFeedbackLaneResolutionStore {
  const runs = args.runs;
  const pipelines = args.pipelines ?? [];
  return {
    listRuns: () => runs,
    findRunsByInvocationId: (invocationId) => runs.filter((run) => run.workflowSnapshot?.invocationId === invocationId),
    loadRun: (runId) => (runs.find((run) => run.id === runId) ?? null) as ReturnType<StateStore["loadRun"]>,
    loadPipeline: (pipelineId) => pipelines.find((pipeline) => pipeline.id === pipelineId) ?? null,
  };
}

function pipelineFixture(args: {
  pipelineId: string;
  stageId: string;
  workflow: string;
  entryRun: Run;
  branchKey?: string;
}): Pipeline & { stages: PipelineStageRecord[] } {
  const branchKey = args.branchKey ?? DEFAULT_PIPELINE_STAGE_BRANCH_KEY;
  const definition: PipelineDefinition = {
    name: "test-pipeline",
    stages: [{ stageId: args.stageId, kind: "workflow", workflow: args.workflow, review: "none" }],
  };
  return {
    id: args.pipelineId,
    name: "test-pipeline",
    createdAt: 1,
    ownerIdentity: "owner",
    status: "active",
    definition,
    context: null,
    terminalPublicationFailure: null,
    terminalPublicationSucceededAt: null,
    dismissedAt: null,
    stages: [
      {
        id: "stage-row-1",
        pipelineId: args.pipelineId,
        stageId: args.stageId,
        branchKey,
        position: 0,
        status: "succeeded",
        workflowInvocationId: args.entryRun.id,
        startedAt: 1,
        endedAt: 2,
        artifact: null,
        failureDetail: null,
        decidedAt: null,
      },
    ],
  };
}

describe("resolveReviewFeedbackLane bare", () => {
  test("resolves a completed bare intent lane by branch", () => {
    const run = baseRun({
      id: "intent-entry",
      stepId: "intent-step",
      workflowSnapshot: workflowSnapshot("inv-intent", {
        stepId: "intent-step",
        role: "author",
        promptId: "intent.prompt.split",
      }),
    });
    const result = resolveReviewFeedbackLane(memoryStore({ runs: [run] }), {
      mode: "bare",
      project: PROJECT,
      branch: BRANCH,
    });
    expect(result).toEqual({
      ok: true,
      target: {
        laneKind: "intent",
        project: PROJECT,
        branch: BRANCH,
        worktreePath: WORKTREE,
        prNumber: 42,
        prUrl: "https://example.test/pull/42",
        provenance: { kind: "bare" },
      },
    });
  });

  test("resolves a completed bare plan lane by branch", () => {
    const run = baseRun({
      id: "plan-entry",
      stepId: "plan-step",
      workflowSnapshot: workflowSnapshot("inv-plan", {
        stepId: "plan-step",
        role: "author",
        promptId: "plan.prompt.draft",
      }),
    });
    const result = resolveReviewFeedbackLane(memoryStore({ runs: [run] }), {
      mode: "bare",
      project: PROJECT,
      branch: BRANCH,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    expect(result.target.laneKind).toBe("plan");
  });

  test("resolves a completed bare implement lane by branch", () => {
    const run = baseRun({
      id: "implement-entry",
      stepId: "implement-step",
      workflowSnapshot: workflowSnapshot("inv-implement", {
        stepId: "implement-step",
        role: "implement",
        promptId: "implement.prompt.body",
      }),
    });
    const result = resolveReviewFeedbackLane(memoryStore({ runs: [run] }), {
      mode: "bare",
      project: PROJECT,
      branch: BRANCH,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    expect(result.target.laneKind).toBe("implement");
  });

  test("refuses in-flight lane", () => {
    const completed = baseRun({ id: "intent-entry" });
    const inFlight = baseRun({
      id: "other-run",
      status: "in-progress",
      stepId: "other-step",
      workflowSnapshot: workflowSnapshot("inv-other", { stepId: "other-step", role: "author" }),
    });
    const result = resolveReviewFeedbackLane(memoryStore({ runs: [completed, inFlight] }), {
      mode: "bare",
      project: PROJECT,
      branch: BRANCH,
    });
    expect(result).toMatchObject({ ok: false, code: "review_feedback_lane_in_flight" });
  });

  test("refuses unmatched branch", () => {
    const result = resolveReviewFeedbackLane(memoryStore({ runs: [] }), {
      mode: "bare",
      project: PROJECT,
      branch: "missing-branch",
    });
    expect(result).toMatchObject({ ok: false, code: "review_feedback_lane_unmatched" });
  });

  test("refuses ambiguous bare branch", () => {
    const first = baseRun({
      id: "intent-a",
      stepId: "intent-a",
      workflowSnapshot: workflowSnapshot("inv-a", {
        stepId: "intent-a",
        role: "author",
        promptId: "intent.prompt.split",
      }),
    });
    const second = baseRun({
      id: "intent-b",
      stepId: "intent-b",
      createdAt: 2,
      workflowSnapshot: workflowSnapshot("inv-b", {
        stepId: "intent-b",
        role: "author",
        promptId: "intent.prompt.split",
      }),
    });
    const result = resolveReviewFeedbackLane(memoryStore({ runs: [first, second] }), {
      mode: "bare",
      project: PROJECT,
      branch: BRANCH,
    });
    expect(result).toMatchObject({ ok: false, code: "review_feedback_lane_ambiguous" });
  });

  test("refuses non intent-plan-implement workflow kind", () => {
    const run = baseRun({
      id: "debate-entry",
      stepId: "debate-step",
      workflowSnapshot: workflowSnapshot("inv-debate", {
        stepId: "debate-step",
        role: "author",
        promptId: "debate.prompt.body",
      }),
    });
    const result = resolveReviewFeedbackLane(memoryStore({ runs: [run] }), {
      mode: "bare",
      project: PROJECT,
      branch: BRANCH,
    });
    expect(result).toMatchObject({ ok: false, code: "review_feedback_lane_not_eligible" });
  });

  test("refuses completed lane without publication evidence", () => {
    const run = baseRun({
      id: "intent-no-pr",
      prNumber: null,
      prUrl: null,
    });
    const result = resolveReviewFeedbackLane(memoryStore({ runs: [run] }), {
      mode: "bare",
      project: PROJECT,
      branch: BRANCH,
    });
    expect(result).toMatchObject({ ok: false, code: "review_feedback_lane_unmatched" });
  });
});

describe("resolveReviewFeedbackLane pipeline", () => {
  test("resolves a succeeded pipeline stage with pipeline stage and branch-key flags", () => {
    const entryRun = baseRun({
      id: "pipeline-intent-entry",
      stepId: "intent-step",
      workflowSnapshot: workflowSnapshot("inv-pipeline-intent", {
        stepId: "intent-step",
        role: "author",
        promptId: "intent.prompt.split",
      }),
    });
    const pipeline = pipelineFixture({
      pipelineId: "pipe-1",
      stageId: "intent-stage",
      workflow: "intent",
      entryRun,
      branchKey: "feature-a",
    });
    const result = resolveReviewFeedbackLane(memoryStore({ runs: [entryRun], pipelines: [pipeline] }), {
      mode: "pipeline",
      project: PROJECT,
      branch: BRANCH,
      pipelineId: "pipe-1",
      stageId: "intent-stage",
      branchKey: "feature-a",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    expect(result.target.provenance).toEqual({
      kind: "pipeline",
      pipelineId: "pipe-1",
      stageId: "intent-stage",
      branchKey: "feature-a",
    });
    expect(result.target.laneKind).toBe("intent");
  });

  test("resolves a succeeded pipeline stage when stage workflow is plan", () => {
    const entryRun = baseRun({
      id: "pipeline-plan-entry",
      stepId: "plan-step",
      workflowSnapshot: workflowSnapshot("inv-pipeline-plan", {
        stepId: "plan-step",
        role: "author",
        promptId: "plan.prompt.draft",
      }),
    });
    const pipeline = pipelineFixture({
      pipelineId: "pipe-plan",
      stageId: "plan-stage",
      workflow: "plan",
      entryRun,
    });
    const result = resolveReviewFeedbackLane(memoryStore({ runs: [entryRun], pipelines: [pipeline] }), {
      mode: "pipeline",
      project: PROJECT,
      branch: BRANCH,
      pipelineId: "pipe-plan",
      stageId: "plan-stage",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    expect(result.target.laneKind).toBe("plan");
  });

  test("resolves a succeeded pipeline stage when stage workflow is implement", () => {
    const entryRun = baseRun({
      id: "pipeline-implement-entry",
      stepId: "implement-step",
      workflowSnapshot: workflowSnapshot("inv-pipeline-implement", {
        stepId: "implement-step",
        role: "implement",
        promptId: "implement.prompt.body",
      }),
    });
    const pipeline = pipelineFixture({
      pipelineId: "pipe-implement",
      stageId: "implement-stage",
      workflow: "implement",
      entryRun,
    });
    const result = resolveReviewFeedbackLane(memoryStore({ runs: [entryRun], pipelines: [pipeline] }), {
      mode: "pipeline",
      project: PROJECT,
      branch: BRANCH,
      pipelineId: "pipe-implement",
      stageId: "implement-stage",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    expect(result.target.laneKind).toBe("implement");
  });

  test("refuses pipeline stage whose workflow is not intent, plan, or implement", () => {
    const entryRun = baseRun({
      id: "pipeline-debate-entry",
      stepId: "debate-step",
      workflowSnapshot: workflowSnapshot("inv-pipeline-debate", {
        stepId: "debate-step",
        role: "author",
        promptId: "debate.prompt.body",
      }),
    });
    const pipeline = pipelineFixture({
      pipelineId: "pipe-debate",
      stageId: "debate-stage",
      workflow: "debate",
      entryRun,
    });
    const result = resolveReviewFeedbackLane(memoryStore({ runs: [entryRun], pipelines: [pipeline] }), {
      mode: "pipeline",
      project: PROJECT,
      branch: BRANCH,
      pipelineId: "pipe-debate",
      stageId: "debate-stage",
    });
    expect(result).toMatchObject({ ok: false, code: "review_feedback_lane_not_eligible" });
  });
});
