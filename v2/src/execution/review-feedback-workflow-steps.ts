import { errorMessage } from "../../../shared/error-message.ts";
import type {
  ReviewFeedbackLaneKind,
  ReviewFeedbackLaneTarget,
} from "../persistence/review-feedback-lane-resolution.ts";
import { loadWorkflowSteps, type WriteWorkflowSourceStep } from "./workflow-loader.ts";
import type { WriteWorkflowStep } from "./workflow-runner.ts";
import { DEFAULT_WRITE_STEP_RULES } from "./write-loop-input.ts";

export type ReviewFeedbackWorkflowInput = {
  target: ReviewFeedbackLaneTarget;
  projectRoot: string;
  configPath?: string;
};

export type ReviewFeedbackWorkflowResult = { ok: true; steps: WriteWorkflowStep[] } | { ok: false; error: string };

const REVIEW_FEEDBACK_PENDING_PROMPT_ID = "review-feedback.prompt.pending";

function roleForLaneKind(laneKind: ReviewFeedbackLaneKind): string {
  if (laneKind === "implement") return "implement";
  return "plan";
}

export function buildReviewFeedbackWorkflowSteps(input: ReviewFeedbackWorkflowInput): ReviewFeedbackWorkflowResult {
  const { target, projectRoot, configPath } = input;
  const sourceStep: WriteWorkflowSourceStep = {
    behavior: "write",
    stepId: "review-feedback",
    role: roleForLaneKind(target.laneKind),
    promptId: REVIEW_FEEDBACK_PENDING_PROMPT_ID,
    stepRules: DEFAULT_WRITE_STEP_RULES,
    worktree: {
      projectRoot,
      projectName: target.project,
      branchName: target.branch,
      baseRef: target.branch,
      git: false,
      localPath: target.worktreePath,
    },
    specPath: ".jarvis/review-feedback-pending",
    expectedArtifactPath: ".jarvis/review-feedback-pending",
  };
  try {
    const steps = loadWorkflowSteps([sourceStep], configPath === undefined ? {} : { machineConfigPath: configPath });
    return { ok: true, steps };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}
