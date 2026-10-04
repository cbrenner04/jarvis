import type { CliDeps } from "../cli/deps.ts";
import type { Io } from "../cli/io.ts";
import { maybeResetStaleWorkspace } from "../commands/stale-reset-workspace.ts";
import {
  type BaseWorkflowName,
  prepareWorkflowStart,
  type WorkflowStartPreparationRequest,
  type WorkflowStartPreparationResult,
  type WorkflowStartResetFlags,
} from "../commands/workflow-start-preparation.ts";
import { stampWorkflowStepsWithMachineConfig } from "../commands/workflow-step-config-stamp.ts";
import {
  type BuildImplementWorkflowStepsInput,
  buildImplementWorkflowSteps,
} from "../execution/implement-workflow-steps.ts";
import {
  buildPlanWorkflowSteps,
  buildReviewedPlanLightWorkflowSteps,
  buildReviewedPlanWorkflowSteps,
  type PlanWorkflowInput,
} from "../execution/publication-workflow-steps.ts";
import {
  type CliWorkflowPresetName,
  WORKFLOW_PRESET_BUILDERS,
  type WorkflowPresetBuilder,
  type WorkflowPresetBuilderInput,
} from "../execution/workflow-presets.ts";
import type { PipelineContext } from "../persistence/state-store.ts";
import { chainedImplementWorkflowDeps, chainedPlanWorkflowDeps } from "./pipeline-chained-workflow-deps.ts";

const noopStaleReset = async () => undefined;

export type PipelineStaleResetPreparation = {
  deps: CliDeps;
  io: Io;
  flags?: WorkflowStartResetFlags;
};

export function capturingStaleReset(
  staleReset: PipelineStaleResetPreparation,
  capture: { message: string },
): PipelineStaleResetPreparation {
  return {
    ...staleReset,
    io: {
      stdout: staleReset.io.stdout,
      stderr: (text: string) => {
        capture.message += text;
        staleReset.io.stderr(text);
      },
    },
  };
}

export function resolvePipelinePresetBuilder(
  presetName: CliWorkflowPresetName,
  builders: typeof WORKFLOW_PRESET_BUILDERS,
  context: PipelineContext,
): WorkflowPresetBuilder {
  const selected = builders[presetName];
  if (selected !== WORKFLOW_PRESET_BUILDERS[presetName]) {
    return selected;
  }
  const planDeps = chainedPlanWorkflowDeps(context);
  const implementDeps = chainedImplementWorkflowDeps(context);
  switch (presetName) {
    case "implement":
      return (input) => buildImplementWorkflowSteps(input, implementDeps);
    case "plan":
      return (input) => buildPlanWorkflowSteps(input as unknown as PlanWorkflowInput, planDeps);
    case "plan-reviewed":
      return (input) => buildReviewedPlanWorkflowSteps(input as unknown as PlanWorkflowInput, planDeps);
    case "plan-reviewed-light":
      return (input) => buildReviewedPlanLightWorkflowSteps(input as unknown as PlanWorkflowInput, planDeps);
    default:
      return selected;
  }
}

export async function preparePipelineStageWorkflow(
  workflow: BaseWorkflowName,
  presetName: CliWorkflowPresetName,
  builderInput: WorkflowPresetBuilderInput,
  context: PipelineContext,
  builders: typeof WORKFLOW_PRESET_BUILDERS,
  staleReset?: PipelineStaleResetPreparation,
): Promise<WorkflowStartPreparationResult> {
  if (context.configPath === undefined) {
    return { ok: false, error: "pipeline-stage-resolve: admission context is missing required 'configPath'" };
  }
  const builder = resolvePipelinePresetBuilder(presetName, builders, context);
  const usesDefaultBuilder = builders[presetName] === WORKFLOW_PRESET_BUILDERS[presetName];
  const staleResetConfig = staleReset
    ? {
        run: maybeResetStaleWorkspace as WorkflowStartPreparationRequest<CliDeps, Io>["staleReset"]["run"],
        deps: staleReset.deps,
        io: staleReset.io,
        flags: staleReset.flags ?? { skipDirtyWorktreeGate: false, skipLandedCriteriaGate: false },
      }
    : ({
        run: noopStaleReset,
        deps: undefined,
        io: undefined,
        flags: { skipDirtyWorktreeGate: true, skipLandedCriteriaGate: true },
      } as unknown as WorkflowStartPreparationRequest<CliDeps, Io>["staleReset"]);
  return prepareWorkflowStart({
    workflow,
    builder,
    builderInput: builderInput as BuildImplementWorkflowStepsInput,
    machineConfigPath: context.configPath,
    stampSteps: usesDefaultBuilder ? stampWorkflowStepsWithMachineConfig : (steps) => steps,
    staleReset: staleResetConfig,
  });
}
