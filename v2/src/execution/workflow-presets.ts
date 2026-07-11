import {
  type BuildImplementWorkflowStepsInput,
  type BuildImplementWorkflowStepsResult,
  buildImplementWorkflowSteps,
} from "./implement-workflow-steps.ts";

export type WorkflowPresetBuilder = (input: BuildImplementWorkflowStepsInput) => BuildImplementWorkflowStepsResult;

export const WORKFLOW_PRESET_BUILDERS = {
  implement: buildImplementWorkflowSteps,
} satisfies Record<string, WorkflowPresetBuilder>;

export type CliWorkflowPresetName = keyof typeof WORKFLOW_PRESET_BUILDERS;
