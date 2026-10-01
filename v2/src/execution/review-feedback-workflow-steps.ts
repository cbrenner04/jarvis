import { errorMessage } from "../../../shared/error-message.ts";
import {
  REVIEW_FEEDBACK_RESPONSE_SIDECAR,
  REVIEW_FEEDBACK_WRITE_PROMPT_ID,
  resolveReviewFeedbackStepRules,
} from "../../../shared/prompts/review-feedback-write.ts";
import type {
  ReviewFeedbackLaneKind,
  ReviewFeedbackLaneTarget,
} from "../persistence/review-feedback-lane-resolution.ts";
import { loadWorkflowSteps, type WriteWorkflowSourceStep } from "./workflow-loader.ts";
import type { WriteWorkflowStep } from "./workflow-runner.ts";

export type ReviewFeedbackWorkflowInput = {
  target: ReviewFeedbackLaneTarget;
  projectRoot: string;
  configPath?: string;
};

export type ReviewFeedbackWorkflowResult = { ok: true; steps: WriteWorkflowStep[] } | { ok: false; error: string };

function roleForLaneKind(laneKind: ReviewFeedbackLaneKind): string {
  if (laneKind === "implement") return "implement";
  return "plan";
}

export function buildReviewFeedbackWorkflowSteps(input: ReviewFeedbackWorkflowInput): ReviewFeedbackWorkflowResult {
  const { target, projectRoot, configPath } = input;
  const stepRules = resolveReviewFeedbackStepRules();
  const sourceStep: WriteWorkflowSourceStep = {
    behavior: "write",
    stepId: "review-feedback",
    role: roleForLaneKind(target.laneKind),
    promptId: REVIEW_FEEDBACK_WRITE_PROMPT_ID,
    stepRules,
    worktree: {
      projectRoot,
      projectName: target.project,
      branchName: target.branch,
      baseRef: target.baseRef,
      git: true,
      localPath: target.worktreePath,
    },
    specPath: REVIEW_FEEDBACK_RESPONSE_SIDECAR,
    expectedArtifactPath: REVIEW_FEEDBACK_RESPONSE_SIDECAR,
    promptPlaceholders: {
      LANE_KIND: target.laneKind,
      ENTRY_SPEC_PATH: target.entrySpecPath,
    },
    reviewFeedbackLane: {
      laneKind: target.laneKind,
      entryRunId: target.entryRunId,
      entrySpecPath: target.entrySpecPath,
      prNumber: target.prNumber,
      prUrl: target.prUrl,
      ...(target.provenance.kind === "pipeline"
        ? {
            pipelineId: target.provenance.pipelineId,
            stageId: target.provenance.stageId,
            branchKey: target.provenance.branchKey,
          }
        : {}),
    },
  };
  try {
    const steps = loadWorkflowSteps([sourceStep], configPath === undefined ? {} : { machineConfigPath: configPath });
    return { ok: true, steps };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}
