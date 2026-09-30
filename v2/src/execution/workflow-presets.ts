import {
  type BuildImplementWorkflowStepsInput,
  type BuildImplementWorkflowStepsResult,
  buildImplementWorkflowSteps,
} from "./implement-workflow-steps.ts";
import {
  buildReviewFeedbackWorkflowSteps,
  type ReviewFeedbackWorkflowInput,
  type ReviewFeedbackWorkflowResult,
} from "./review-feedback-workflow-steps.ts";
import {
  buildIntentWorkflowSteps,
  buildPlanWorkflowSteps,
  buildReviewedIntentWorkflowSteps,
  buildReviewedPlanLightWorkflowSteps,
  buildReviewedPlanWorkflowSteps,
  type IntentWorkflowInput,
  type IntentWorkflowResult,
  type PlanWorkflowInput,
  type PlanWorkflowResult,
} from "./publication-workflow-steps.ts";
export type WorkflowPresetBuilderInput =
  | BuildImplementWorkflowStepsInput
  | IntentWorkflowInput
  | PlanWorkflowInput
  | ReviewFeedbackWorkflowInput;
export type WorkflowPresetBuilderResult =
  | BuildImplementWorkflowStepsResult
  | IntentWorkflowResult
  | PlanWorkflowResult
  | ReviewFeedbackWorkflowResult;
export type WorkflowPresetBuilder = (
  input: BuildImplementWorkflowStepsInput,
) => WorkflowPresetBuilderResult | Promise<WorkflowPresetBuilderResult>;

export const WORKFLOW_PRESET_BUILDERS = {
  implement: buildImplementWorkflowSteps,
  intent: (input) => buildIntentWorkflowSteps(input as unknown as IntentWorkflowInput),
  "intent-reviewed": (input) => buildReviewedIntentWorkflowSteps(input as unknown as IntentWorkflowInput),
  plan: (input) => buildPlanWorkflowSteps(input as unknown as PlanWorkflowInput),
  "plan-reviewed": (input) => buildReviewedPlanWorkflowSteps(input as unknown as PlanWorkflowInput),
  "plan-reviewed-light": (input) => buildReviewedPlanLightWorkflowSteps(input as unknown as PlanWorkflowInput),
  "review-feedback": ((input) =>
    buildReviewFeedbackWorkflowSteps(input as unknown as ReviewFeedbackWorkflowInput)) as WorkflowPresetBuilder,
} satisfies Record<string, WorkflowPresetBuilder>;

export type CliWorkflowPresetName = keyof typeof WORKFLOW_PRESET_BUILDERS;

const PIPELINE_ELIGIBILITY = Object.fromEntries(
  (Object.keys(WORKFLOW_PRESET_BUILDERS) as CliWorkflowPresetName[]).map((name) => [
    name,
    { pipelineStageEligible: name !== "review-feedback" },
  ]),
) as Record<CliWorkflowPresetName, { pipelineStageEligible: boolean }>;

export function isStandaloneOnlyPipelineWorkflow(workflow: string): boolean {
  const entry = PIPELINE_ELIGIBILITY[workflow as CliWorkflowPresetName];
  return entry?.pipelineStageEligible === false;
}
