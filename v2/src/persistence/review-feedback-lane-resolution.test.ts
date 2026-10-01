import { describe, expect, test } from "bun:test";
import { REVIEW_FEEDBACK_WRITE_PROMPT_ID } from "../../../shared/prompts/review-feedback-write.ts";
import type { PipelineDefinition } from "../execution/pipeline-definition.ts";
import {
  type ReviewFeedbackLaneResolutionStore,
  resolveReviewFeedbackEntrySpecPath,
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
  firstStep: {
    stepId: string;
    role: string;
    promptId?: string;
    landingInputs?: NonNullable<Run["workflowSnapshot"]>["steps"][number]["landingInputs"];
  },
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
    supersedeFailures: null,
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
        entryRunId: "intent-entry",
        entrySpecPath: "spec.md",
        baseRef: "main",
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

  test("resolves implement lane when a completed review-feedback run shares the branch", () => {
    const implementRun = baseRun({
      id: "implement-entry",
      stepId: "implement-step",
      workflowSnapshot: workflowSnapshot("inv-implement", {
        stepId: "implement-step",
        role: "implement",
        promptId: "implement.prompt.body",
      }),
      specPath: "v2/spec/lane/index.md",
    });
    const reviewFeedbackRun = baseRun({
      id: "rf-entry",
      stepId: "review-feedback",
      createdAt: 2,
      workflowSnapshot: workflowSnapshot("inv-rf", {
        stepId: "review-feedback",
        role: "implement",
        promptId: REVIEW_FEEDBACK_WRITE_PROMPT_ID,
      }),
    });
    const result = resolveReviewFeedbackLane(memoryStore({ runs: [implementRun, reviewFeedbackRun] }), {
      mode: "bare",
      project: PROJECT,
      branch: BRANCH,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    expect(result.target.laneKind).toBe("implement");
    expect(result.target.entryRunId).toBe("implement-entry");
    expect(result.target.entrySpecPath).toBe("v2/spec/lane/index.md");
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

  test("resolves pipeline_stage for succeeded intent, plan, and implement rows from entry-run project and branch", () => {
    const cases: Array<{
      workflow: string;
      laneKind: "intent" | "plan" | "implement";
      promptId: string;
      role: string;
    }> = [
      { workflow: "intent", laneKind: "intent", promptId: "intent.prompt.split", role: "author" },
      { workflow: "plan", laneKind: "plan", promptId: "plan.prompt.draft", role: "author" },
      { workflow: "implement", laneKind: "implement", promptId: "implement.prompt.body", role: "implement" },
    ];
    for (const caseDef of cases) {
      const entryRun = baseRun({
        id: `pipeline-${caseDef.workflow}-entry`,
        stepId: `${caseDef.workflow}-step`,
        workflowSnapshot: workflowSnapshot(`inv-pipeline-${caseDef.workflow}`, {
          stepId: `${caseDef.workflow}-step`,
          role: caseDef.role,
          promptId: caseDef.promptId,
        }),
      });
      const pipeline = pipelineFixture({
        pipelineId: `pipe-${caseDef.workflow}`,
        stageId: `${caseDef.workflow}-stage`,
        workflow: caseDef.workflow,
        entryRun,
      });
      const result = resolveReviewFeedbackLane(memoryStore({ runs: [entryRun], pipelines: [pipeline] }), {
        mode: "pipeline_stage",
        pipelineId: `pipe-${caseDef.workflow}`,
        stageId: `${caseDef.workflow}-stage`,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("expected success");
      expect(result.target.laneKind).toBe(caseDef.laneKind);
      expect(result.target.project).toBe(PROJECT);
      expect(result.target.branch).toBe(BRANCH);
      expect(result.target.provenance).toEqual({
        kind: "pipeline",
        pipelineId: `pipe-${caseDef.workflow}`,
        stageId: `${caseDef.workflow}-stage`,
        branchKey: DEFAULT_PIPELINE_STAGE_BRANCH_KEY,
      });
    }
  });

  test("refuses unknown stage, non-succeeded stage, and fan-out without branchKey", () => {
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
    });
    const unknownStage = resolveReviewFeedbackLane(memoryStore({ runs: [entryRun], pipelines: [pipeline] }), {
      mode: "pipeline_stage",
      pipelineId: "pipe-1",
      stageId: "missing-stage",
    });
    expect(unknownStage).toMatchObject({ ok: false, code: "review_feedback_lane_unmatched" });

    const pendingPipeline: Pipeline & { stages: PipelineStageRecord[] } = {
      ...pipeline,
      stages: [{ ...pipeline.stages[0]!, status: "pending" }],
    };
    const nonSucceeded = resolveReviewFeedbackLane(memoryStore({ runs: [entryRun], pipelines: [pendingPipeline] }), {
      mode: "pipeline_stage",
      pipelineId: "pipe-1",
      stageId: "intent-stage",
    });
    expect(nonSucceeded).toMatchObject({ ok: false, code: "review_feedback_lane_unmatched" });

    const entryRunA = baseRun({
      id: "pipeline-intent-entry-a",
      stepId: "intent-step-a",
      workflowSnapshot: workflowSnapshot("inv-pipeline-intent-a", {
        stepId: "intent-step-a",
        role: "author",
        promptId: "intent.prompt.split",
      }),
    });
    const entryRunB = baseRun({
      id: "pipeline-intent-entry-b",
      stepId: "intent-step-b",
      workflowSnapshot: workflowSnapshot("inv-pipeline-intent-b", {
        stepId: "intent-step-b",
        role: "author",
        promptId: "intent.prompt.split",
      }),
    });
    const fanOutPipeline: Pipeline & { stages: PipelineStageRecord[] } = {
      id: "pipe-fanout",
      name: "test-pipeline",
      createdAt: 1,
      ownerIdentity: "owner",
      status: "active",
      definition: pipeline.definition,
      context: null,
      terminalPublicationFailure: null,
      terminalPublicationSucceededAt: null,
      supersedeFailures: null,
      dismissedAt: null,
      stages: [
        {
          id: "stage-row-a",
          pipelineId: "pipe-fanout",
          stageId: "intent-stage",
          branchKey: "feature-a",
          position: 0,
          status: "succeeded",
          workflowInvocationId: entryRunA.id,
          startedAt: 1,
          endedAt: 2,
          artifact: null,
          failureDetail: null,
          decidedAt: null,
        },
        {
          id: "stage-row-b",
          pipelineId: "pipe-fanout",
          stageId: "intent-stage",
          branchKey: "feature-b",
          position: 1,
          status: "succeeded",
          workflowInvocationId: entryRunB.id,
          startedAt: 1,
          endedAt: 2,
          artifact: null,
          failureDetail: null,
          decidedAt: null,
        },
      ],
    };
    const fanOutOmitted = resolveReviewFeedbackLane(
      memoryStore({ runs: [entryRunA, entryRunB], pipelines: [fanOutPipeline] }),
      {
        mode: "pipeline_stage",
        pipelineId: "pipe-fanout",
        stageId: "intent-stage",
      },
    );
    expect(fanOutOmitted).toMatchObject({ ok: false, code: "review_feedback_lane_unmatched" });
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

describe("resolveReviewFeedbackEntrySpecPath", () => {
  test("intent lane maps ready-intents landing path to ready-intents entry spec path", () => {
    const run = baseRun({
      specPath: "v2/spec/other.md",
      workflowSnapshot: workflowSnapshot("inv-intent", {
        stepId: "step-1",
        role: "author",
        promptId: "intent.prompt.split",
        landingInputs: {
          sourceRoot: "/home/.jarvis/specs/jarvis/ready-intents",
          paths: ["/home/.jarvis/specs/jarvis/ready-intents/seed.md"],
          consumeFrom: "source",
        },
      }),
    });
    expect(resolveReviewFeedbackEntrySpecPath("intent", run)).toBe("ready-intents");
  });

  test("non-intent lane keeps stored spec path when landing paths mention ready-intents", () => {
    const landingInputs = {
      sourceRoot: "/home/.jarvis/specs/jarvis/ready-intents",
      paths: ["/home/.jarvis/specs/jarvis/ready-intents/seed.md"],
      consumeFrom: "source" as const,
    };
    const run = baseRun({
      specPath: "v2/spec/plan/index.md",
      workflowSnapshot: workflowSnapshot("inv-plan", {
        stepId: "step-1",
        role: "author",
        promptId: "plan.prompt.draft",
        landingInputs,
      }),
    });
    expect(resolveReviewFeedbackEntrySpecPath("plan", run)).toBe("v2/spec/plan/index.md");
    expect(resolveReviewFeedbackEntrySpecPath("implement", run)).toBe("v2/spec/plan/index.md");
  });
});
