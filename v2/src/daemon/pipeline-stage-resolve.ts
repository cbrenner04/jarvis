import { getBaseBranch } from "../../../shared/git.ts";
import type { BuildImplementWorkflowStepsInput } from "../execution/implement-workflow-steps.ts";
import type { PipelineDefinition, PipelineStage } from "../execution/pipeline-definition.ts";
import type { IntentWorkflowInput, PlanWorkflowInput } from "../execution/publication-workflow-steps.ts";
import { type CliWorkflowPresetName, WORKFLOW_PRESET_BUILDERS } from "../execution/workflow-presets.ts";
import type { AnyWorkflowStep } from "../execution/workflow-runner.ts";

/** Pipeline-level context admission (subspec 02) holds alongside the validated `PipelineDefinition`. */
export interface PipelineContext {
  cwd: string;
  configPath?: string;
  targetDir?: string;
  projectRegistry?: Record<string, { root: string; origin?: string }>;
  seed: string;
}

export type PipelineStageResolutionResult = { ok: true; steps: AnyWorkflowStep[] } | { ok: false; error: string };

export type PipelineStageResolveDeps = {
  builders?: typeof WORKFLOW_PRESET_BUILDERS;
  resolveBaseRef?: (cwd: string) => Promise<string>;
};

/** review posture -> preset name, for the two presets that consume a prior stage's artifact or the seed. */
const WORKFLOW_POSTURE_PRESETS: Record<string, Partial<Record<string, CliWorkflowPresetName>>> = {
  intent: { none: "intent", light: "intent-reviewed", debate: "intent" },
  plan: { none: "plan", light: "plan-reviewed-light", debate: "plan-reviewed" },
};

const FIXED_REVIEW_PASSES = 1;

function unmappedResult(stage: PipelineStage & { kind: "workflow" }): { ok: false; error: string } {
  return {
    ok: false,
    error: `pipeline-stage-resolve: no preset mapping for stage "${stage.stageId}" (workflow "${stage.workflow}", review "${stage.review}")`,
  };
}

/** Walk back from `stageIndex`, skipping approval stages, to the nearest preceding workflow stage's artifact. */
function findPrecedingWorkflowArtifact(
  stages: readonly PipelineStage[],
  stageIndex: number,
  artifactSpecPaths: ReadonlyMap<string, string>,
): string | undefined {
  for (let index = stageIndex - 1; index >= 0; index -= 1) {
    const candidate = stages[index];
    if (candidate?.kind === "workflow") {
      return artifactSpecPaths.get(candidate.stageId);
    }
  }
  return undefined;
}

function toResolution(result: { ok: true; steps: AnyWorkflowStep[] } | { ok: false; error: string }) {
  return result.ok ? { ok: true as const, steps: result.steps } : { ok: false as const, error: result.error };
}

async function resolveImplementStage(
  stage: PipelineStage & { kind: "workflow" },
  context: PipelineContext,
  priorSpecPath: string | undefined,
  builders: typeof WORKFLOW_PRESET_BUILDERS,
  resolveBaseRef: (cwd: string) => Promise<string>,
): Promise<PipelineStageResolutionResult> {
  if (stage.review !== "light" && stage.review !== "debate") {
    return unmappedResult(stage);
  }
  if (priorSpecPath === undefined) {
    return {
      ok: false,
      error: `pipeline-stage-resolve: stage "${stage.stageId}" has no preceding workflow artifact`,
    };
  }
  const input: BuildImplementWorkflowStepsInput = {
    cwd: context.cwd,
    baseRef: await resolveBaseRef(context.cwd),
    specPath: priorSpecPath,
    reviewPasses: FIXED_REVIEW_PASSES,
    reviewBehavior: stage.review,
    ...(context.configPath !== undefined ? { configPath: context.configPath } : {}),
    ...(context.projectRegistry !== undefined ? { projectRegistry: context.projectRegistry } : {}),
  };
  return toResolution(await builders.implement(input));
}

async function resolveIntentStage(
  stage: PipelineStage & { kind: "workflow" },
  context: PipelineContext,
  priorSpecPath: string | undefined,
  presetName: CliWorkflowPresetName,
  builders: typeof WORKFLOW_PRESET_BUILDERS,
): Promise<PipelineStageResolutionResult> {
  if (priorSpecPath !== undefined) {
    return {
      ok: false,
      error: `pipeline-stage-resolve: stage "${stage.stageId}" is not the first workflow stage`,
    };
  }
  const input: IntentWorkflowInput = {
    cwd: context.cwd,
    seedText: context.seed,
    reviewPasses: stage.review === "none" ? 0 : FIXED_REVIEW_PASSES,
    ...(stage.review === "light" || stage.review === "debate" ? { reviewBehavior: stage.review } : {}),
    ...(context.targetDir !== undefined ? { targetDir: context.targetDir } : {}),
    ...(context.configPath !== undefined ? { configPath: context.configPath } : {}),
  };
  return toResolution(await builders[presetName](input as unknown as BuildImplementWorkflowStepsInput));
}

async function resolvePlanStage(
  stage: PipelineStage & { kind: "workflow" },
  context: PipelineContext,
  priorSpecPath: string | undefined,
  presetName: CliWorkflowPresetName,
  builders: typeof WORKFLOW_PRESET_BUILDERS,
): Promise<PipelineStageResolutionResult> {
  if (priorSpecPath === undefined) {
    return {
      ok: false,
      error: `pipeline-stage-resolve: stage "${stage.stageId}" has no preceding workflow artifact`,
    };
  }
  const input: PlanWorkflowInput = {
    cwd: context.cwd,
    readyIntent: priorSpecPath,
    reviewPasses: stage.review === "none" ? 0 : FIXED_REVIEW_PASSES,
    ...(stage.review === "light" || stage.review === "debate" ? { reviewBehavior: stage.review } : {}),
    ...(context.targetDir !== undefined ? { targetDir: context.targetDir } : {}),
    ...(context.configPath !== undefined ? { configPath: context.configPath } : {}),
  };
  return toResolution(await builders[presetName](input as unknown as BuildImplementWorkflowStepsInput));
}

/**
 * Resolve one pipeline stage into buildable workflow steps.
 *
 * `pipeline-definition.ts`'s `validatePipelineDefinition` is the sole authority on which
 * (workflow, review) pairs are realizable; this only maps realizable pairs to builders.
 */
export async function resolveStageWorkflowSteps(
  definition: PipelineDefinition,
  stageIndex: number,
  context: PipelineContext,
  artifactSpecPaths: ReadonlyMap<string, string>,
  deps: PipelineStageResolveDeps = {},
): Promise<PipelineStageResolutionResult> {
  const stage = definition.stages[stageIndex];
  if (stage === undefined || stage.kind !== "workflow") {
    return { ok: false, error: `pipeline-stage-resolve: stage at index ${stageIndex} is not a workflow stage` };
  }
  const builders = deps.builders ?? WORKFLOW_PRESET_BUILDERS;
  const priorSpecPath = findPrecedingWorkflowArtifact(definition.stages, stageIndex, artifactSpecPaths);

  if (stage.workflow === "implement") {
    const resolveBaseRef = deps.resolveBaseRef ?? ((cwd: string) => getBaseBranch(cwd));
    return resolveImplementStage(stage, context, priorSpecPath, builders, resolveBaseRef);
  }

  const presetName = WORKFLOW_POSTURE_PRESETS[stage.workflow]?.[stage.review];
  if (presetName === undefined) {
    return unmappedResult(stage);
  }

  if (stage.workflow === "intent") {
    return resolveIntentStage(stage, context, priorSpecPath, presetName, builders);
  }
  if (stage.workflow === "plan") {
    return resolvePlanStage(stage, context, priorSpecPath, presetName, builders);
  }
  return unmappedResult(stage);
}
