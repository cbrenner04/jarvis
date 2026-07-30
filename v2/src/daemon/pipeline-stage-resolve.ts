import { getBaseBranch } from "../../../shared/git.ts";
import type { BuildImplementWorkflowStepsInput } from "../execution/implement-workflow-steps.ts";
import type { PipelineDefinition, PipelineStage } from "../execution/pipeline-definition.ts";
import type { IntentWorkflowInput, PlanWorkflowInput } from "../execution/publication-workflow-steps.ts";
import { type CliWorkflowPresetName, WORKFLOW_PRESET_BUILDERS } from "../execution/workflow-presets.ts";
import type { AnyWorkflowStep } from "../execution/workflow-runner.ts";
import type { PipelineContext } from "../persistence/state-store.ts";
import type { PipelineStageArtifact } from "./pipeline-stage-dispatch.ts";

export type { PipelineContext };

export type PipelineStageResolutionResult = { ok: true; steps: AnyWorkflowStep[] } | { ok: false; error: string };

export type PipelineStageResolveDeps = {
  builders?: typeof WORKFLOW_PRESET_BUILDERS;
  resolveBaseRef?: (cwd: string) => Promise<string>;
  loadRun?: (runId: string) => { worktreePath: string } | null;
};

/** review posture -> preset name, for the two presets that consume a prior stage's artifact or the seed. */
const WORKFLOW_POSTURE_PRESETS: Record<string, Partial<Record<string, CliWorkflowPresetName>>> = {
  intent: { none: "intent", light: "intent-reviewed", debate: "intent" },
  plan: { none: "plan", light: "plan-reviewed-light", debate: "plan-reviewed" },
};

const FIXED_REVIEW_PASSES = 1;

let invertPriorWorktreeRootGuardForTest = false;

export function setInvertPriorWorktreeRootGuardForTest(value: boolean): void {
  invertPriorWorktreeRootGuardForTest = value;
}

function selectChainedStageCwd(contextCwd: string, priorWorktreePath: string): string {
  return invertPriorWorktreeRootGuardForTest ? contextCwd : priorWorktreePath;
}

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
  stageArtifacts: ReadonlyMap<string, PipelineStageArtifact>,
): PipelineStageArtifact | undefined {
  for (let index = stageIndex - 1; index >= 0; index -= 1) {
    const candidate = stages[index];
    if (candidate?.kind === "workflow") {
      return stageArtifacts.get(candidate.stageId);
    }
  }
  return undefined;
}

type PriorArtifactContext = {
  artifact: PipelineStageArtifact;
  cwd: string;
  worktreePath: string;
  specPath: string;
};

function resolvePriorArtifactContext(
  stage: PipelineStage & { kind: "workflow" },
  priorArtifact: PipelineStageArtifact | undefined,
  context: PipelineContext,
  loadRun: NonNullable<PipelineStageResolveDeps["loadRun"]>,
): { ok: true; prior: PriorArtifactContext } | { ok: false; error: string } {
  if (priorArtifact === undefined) {
    return {
      ok: false,
      error: `pipeline-stage-resolve: stage "${stage.stageId}" has no preceding workflow artifact`,
    };
  }
  if (priorArtifact.entryRunId.length === 0) {
    return {
      ok: false,
      error: `pipeline-stage-resolve: preceding artifact for stage "${stage.stageId}" is missing entryRunId`,
    };
  }
  const priorEntryRun = loadRun(priorArtifact.entryRunId);
  if (priorEntryRun === null) {
    return {
      ok: false,
      error: `pipeline-stage-resolve: entry run ${priorArtifact.entryRunId} not found for preceding artifact`,
    };
  }
  if (priorEntryRun.worktreePath.length === 0) {
    return {
      ok: false,
      error: `pipeline-stage-resolve: entry run ${priorArtifact.entryRunId} is missing worktreePath`,
    };
  }
  return {
    ok: true,
    prior: {
      artifact: priorArtifact,
      cwd: selectChainedStageCwd(context.cwd, priorEntryRun.worktreePath),
      worktreePath: priorEntryRun.worktreePath,
      specPath: priorArtifact.specPath,
    },
  };
}

function isChainedPlanReadyIntentPath(specPath: string): boolean {
  return specPath.endsWith(".md");
}

function toResolution(result: { ok: true; steps: AnyWorkflowStep[] } | { ok: false; error: string }) {
  return result.ok ? { ok: true as const, steps: result.steps } : { ok: false as const, error: result.error };
}

async function resolveImplementStage(
  stage: PipelineStage & { kind: "workflow" },
  prior: PriorArtifactContext,
  context: PipelineContext,
  builders: typeof WORKFLOW_PRESET_BUILDERS,
  resolveBaseRef: (cwd: string) => Promise<string>,
): Promise<PipelineStageResolutionResult> {
  const input: BuildImplementWorkflowStepsInput = {
    cwd: prior.cwd,
    baseRef: await resolveBaseRef(prior.worktreePath),
    specPath: prior.specPath,
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
  priorArtifact: PipelineStageArtifact | undefined,
  presetName: CliWorkflowPresetName,
  builders: typeof WORKFLOW_PRESET_BUILDERS,
): Promise<PipelineStageResolutionResult> {
  if (priorArtifact !== undefined) {
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
  prior: PriorArtifactContext,
  context: PipelineContext,
  presetName: CliWorkflowPresetName,
  builders: typeof WORKFLOW_PRESET_BUILDERS,
): Promise<PipelineStageResolutionResult> {
  if (!isChainedPlanReadyIntentPath(prior.specPath)) {
    return {
      ok: false,
      error: `pipeline-stage-resolve: preceding artifact specPath must be a ready-intent file, not a directory`,
    };
  }
  const input: PlanWorkflowInput = {
    cwd: prior.cwd,
    readyIntent: prior.specPath,
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
  stageArtifacts: ReadonlyMap<string, PipelineStageArtifact>,
  deps: PipelineStageResolveDeps = {},
): Promise<PipelineStageResolutionResult> {
  const stage = definition.stages[stageIndex];
  if (stage === undefined || stage.kind !== "workflow") {
    return { ok: false, error: `pipeline-stage-resolve: stage at index ${stageIndex} is not a workflow stage` };
  }
  const builders = deps.builders ?? WORKFLOW_PRESET_BUILDERS;
  const priorArtifact = findPrecedingWorkflowArtifact(definition.stages, stageIndex, stageArtifacts);

  if (stage.workflow === "implement") {
    if (stage.review !== "light" && stage.review !== "debate") {
      return unmappedResult(stage);
    }
    const loadRun = deps.loadRun;
    if (loadRun === undefined) {
      return { ok: false, error: "pipeline-stage-resolve: loadRun is required for chained stage resolution" };
    }
    const priorResult = resolvePriorArtifactContext(stage, priorArtifact, context, loadRun);
    if (!priorResult.ok) return priorResult;
    const resolveBaseRef = deps.resolveBaseRef ?? ((cwd: string) => getBaseBranch(cwd));
    const result = await resolveImplementStage(stage, priorResult.prior, context, builders, resolveBaseRef);
    if (!result.ok || definition.terminalAction !== "leave-draft") return result;
    return {
      ok: true,
      steps: result.steps.map((step) =>
        step.behavior === "write" && step.publishCompletion !== false ? { ...step, skipReadyFinalization: true } : step,
      ),
    };
  }

  const presetName = WORKFLOW_POSTURE_PRESETS[stage.workflow]?.[stage.review];
  if (presetName === undefined) {
    return unmappedResult(stage);
  }

  if (stage.workflow === "intent") {
    return resolveIntentStage(stage, context, priorArtifact, presetName, builders);
  }
  if (stage.workflow === "plan") {
    const loadRun = deps.loadRun;
    if (loadRun === undefined) {
      return { ok: false, error: "pipeline-stage-resolve: loadRun is required for chained stage resolution" };
    }
    const priorResult = resolvePriorArtifactContext(stage, priorArtifact, context, loadRun);
    if (!priorResult.ok) return priorResult;
    return resolvePlanStage(stage, priorResult.prior, context, presetName, builders);
  }
  return unmappedResult(stage);
}
