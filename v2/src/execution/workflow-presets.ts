import {
  type BuildImplementWorkflowStepsInput,
  type BuildImplementWorkflowStepsResult,
  buildImplementWorkflowSteps,
} from "./implement-workflow-steps.ts";
import {
  buildIntentWorkflowSteps,
  type IntentWorkflowInput,
  type IntentWorkflowResult,
} from "./intent-workflow-steps.ts";

export type WorkflowPresetBuilderInput = BuildImplementWorkflowStepsInput | IntentWorkflowInput;
export type WorkflowPresetBuilderResult = BuildImplementWorkflowStepsResult | IntentWorkflowResult;
export type WorkflowPresetBuilder = (
  input: BuildImplementWorkflowStepsInput,
) => WorkflowPresetBuilderResult | Promise<WorkflowPresetBuilderResult>;

export const WORKFLOW_PRESET_BUILDERS = {
  implement: buildImplementWorkflowSteps,
  intent: (input) => buildIntentWorkflowSteps(input as unknown as IntentWorkflowInput),
} satisfies Record<string, WorkflowPresetBuilder>;

export type CliWorkflowPresetName = keyof typeof WORKFLOW_PRESET_BUILDERS;
