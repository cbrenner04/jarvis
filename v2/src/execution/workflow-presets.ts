import {
  type BuildImplementWorkflowStepsInput,
  type BuildImplementWorkflowStepsResult,
  buildImplementWorkflowSteps,
} from "./implement-workflow-steps.ts";
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
export type WorkflowPresetBuilderInput = BuildImplementWorkflowStepsInput | IntentWorkflowInput | PlanWorkflowInput;
export type WorkflowPresetBuilderResult = BuildImplementWorkflowStepsResult | IntentWorkflowResult | PlanWorkflowResult;
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
} satisfies Record<string, WorkflowPresetBuilder>;

export type CliWorkflowPresetName = keyof typeof WORKFLOW_PRESET_BUILDERS;

type PipelineEligibilityPresetName = CliWorkflowPresetName | "review-feedback";

export const PIPELINE_ELIGIBILITY = {
  implement: { pipelineStageEligible: true },
  intent: { pipelineStageEligible: true },
  "intent-reviewed": { pipelineStageEligible: true },
  plan: { pipelineStageEligible: true },
  "plan-reviewed": { pipelineStageEligible: true },
  "plan-reviewed-light": { pipelineStageEligible: true },
  "review-feedback": { pipelineStageEligible: false },
} satisfies Record<PipelineEligibilityPresetName, { pipelineStageEligible: boolean }>;

export function isStandaloneOnlyPipelineWorkflow(workflow: string): boolean {
  if (!(workflow in PIPELINE_ELIGIBILITY)) {
    return false;
  }
  return PIPELINE_ELIGIBILITY[workflow as PipelineEligibilityPresetName].pipelineStageEligible === false;
}
