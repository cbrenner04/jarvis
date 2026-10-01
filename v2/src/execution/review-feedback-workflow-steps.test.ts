import { describe, expect, test } from "bun:test";
import { REVIEW_FEEDBACK_WRITE_PROMPT_ID } from "../../../shared/prompts/review-feedback-write.ts";
import type { ReviewFeedbackLaneTarget } from "../persistence/review-feedback-lane-resolution.ts";
import { writeHomeMachineConfig } from "../testing/cli-test-helpers.ts";
import { getExternalWorktreePath } from "./external-worktree.ts";
import { buildReviewFeedbackWorkflowSteps } from "./review-feedback-workflow-steps.ts";
import type { WriteWorkflowStep } from "./workflow-runner.ts";

const PROJECT = "demo";
const BRANCH = "lane-branch";
const WORKTREE = "/worktrees/lane";
const BASE_REF = "main";

function laneTarget(laneKind: ReviewFeedbackLaneTarget["laneKind"], entrySpecPath: string): ReviewFeedbackLaneTarget {
  return {
    laneKind,
    project: PROJECT,
    branch: BRANCH,
    worktreePath: WORKTREE,
    prNumber: 42,
    prUrl: "https://example.test/pull/42",
    entryRunId: `${laneKind}-entry`,
    entrySpecPath,
    baseRef: BASE_REF,
    provenance: { kind: "bare" },
  };
}

function buildSteps(laneKind: ReviewFeedbackLaneTarget["laneKind"], entrySpecPath: string): WriteWorkflowStep {
  const result = buildReviewFeedbackWorkflowSteps({
    target: laneTarget(laneKind, entrySpecPath),
    projectRoot: "/repo",
    configPath: writeHomeMachineConfig(),
  });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error);
  const step = result.steps[0];
  if (step === undefined) throw new Error("expected write step");
  return step;
}

describe("buildReviewFeedbackWorkflowSteps", () => {
  test("builds a write step for each lane kind with review-feedback.prompt.write", () => {
    const cases: Array<{ laneKind: ReviewFeedbackLaneTarget["laneKind"]; entrySpecPath: string; role: string }> = [
      { laneKind: "intent", entrySpecPath: "ready-intents", role: "plan" },
      { laneKind: "plan", entrySpecPath: "v2/spec/plan-tree", role: "plan" },
      { laneKind: "implement", entrySpecPath: "v2/spec/lane/index.md", role: "implement" },
    ];
    for (const { laneKind, entrySpecPath, role } of cases) {
      const step = buildSteps(laneKind, entrySpecPath);
      expect(step.promptId).toBe(REVIEW_FEEDBACK_WRITE_PROMPT_ID);
      expect(step.promptId).not.toBe("review-feedback.prompt.pending");
      expect(step.role).toBe(role);
      expect(step.specPath).toBe(".jarvis-review-feedback-response.md");
      expect(step.expectedArtifactPath).toBe(".jarvis-review-feedback-response.md");
      expect(step.worktree.git).toBe(true);
      expect(step.worktree.baseRef).toBe(BASE_REF);
      expect(step.worktree.baseRef).not.toBe(BRANCH);
      expect(step.worktree.branchName).toBe(BRANCH);
      expect(getExternalWorktreePath(step.worktree)).toBe(WORKTREE);
      expect(step.reviewFeedbackLane).toEqual({
        laneKind,
        entryRunId: `${laneKind}-entry`,
        entrySpecPath,
        prNumber: 42,
        prUrl: "https://example.test/pull/42",
      });
    }
  });

  test("stamps pipeline stage identity on reviewFeedbackLane when provenance is pipeline", () => {
    const pipelineTarget: ReviewFeedbackLaneTarget = {
      ...laneTarget("intent", "ready-intents"),
      provenance: { kind: "pipeline", pipelineId: "pipe-1", stageId: "intent-stage", branchKey: "feature-a" },
    };
    const result = buildReviewFeedbackWorkflowSteps({
      target: pipelineTarget,
      projectRoot: "/repo",
      configPath: writeHomeMachineConfig(),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.steps[0]?.reviewFeedbackLane).toEqual({
      laneKind: "intent",
      entryRunId: "intent-entry",
      entrySpecPath: "ready-intents",
      prNumber: 42,
      prUrl: "https://example.test/pull/42",
      pipelineId: "pipe-1",
      stageId: "intent-stage",
      branchKey: "feature-a",
    });
  });

  test("implement-lane steps omit linked-index routing bindings", () => {
    const step = buildSteps("implement", "v2/spec/lane/index.md");
    expect(step.linkedIndexRouting).toBeUndefined();
    expect(step.promptPlaceholders?.ACTIVE_SUBSPEC_PATH).toBeUndefined();
    expect(step.promptPlaceholders?.ACTIVE_SUBSPEC_BODY).toBeUndefined();
    expect(step.promptPlaceholders?.PATCH_RULES).toBeUndefined();
    expect(step.promptPlaceholders).toEqual({
      LANE_KIND: "implement",
      ENTRY_SPEC_PATH: "v2/spec/lane/index.md",
    });
  });
});
