import {
  type BuildImplementWorkflowStepsInput,
  type BuildImplementWorkflowStepsResult,
  buildImplementWorkflowSteps,
} from "./implement-workflow-steps.ts";
import {
  buildIntentWorkflowSteps,
  buildReviewedIntentWorkflowSteps,
  type IntentWorkflowInput,
  type IntentWorkflowResult,
} from "./intent-workflow-steps.ts";
import {
  buildPlanWorkflowSteps,
  buildReviewedPlanLightWorkflowSteps,
  buildReviewedPlanWorkflowSteps,
  type PlanWorkflowInput,
  type PlanWorkflowResult,
} from "./plan-workflow-steps.ts";

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
