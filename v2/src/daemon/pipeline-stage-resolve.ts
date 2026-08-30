import { existsSync } from "node:fs";
import { join } from "node:path";
import { resolveWorkflowPresetName } from "../commands/workflow-start-preparation.ts";
import type { BuildImplementWorkflowStepsInput } from "../execution/implement-workflow-steps.ts";
import type { PipelineDefinition, PipelineStage } from "../execution/pipeline-definition.ts";
import type { IntentWorkflowInput, PlanWorkflowInput } from "../execution/publication-workflow-steps.ts";
import { type CliWorkflowPresetName, WORKFLOW_PRESET_BUILDERS } from "../execution/workflow-presets.ts";
import type { AnyWorkflowStep } from "../execution/workflow-runner.ts";
import type { IpcClient } from "../ipc/client.ts";
import type { PipelineContext } from "../persistence/state-store.ts";
import { DEFAULT_PIPELINE_STAGE_BRANCH_KEY } from "../persistence/state-store.ts";
import { createChainedStageProjectMatch } from "./pipeline-chained-workflow-deps.ts";
import { type PipelineStageArtifact, stageArtifactKey } from "./pipeline-stage-dispatch.ts";
import {
  capturingStaleReset,
  type PipelineStaleResetPreparation,
  preparePipelineStageWorkflow,
} from "./pipeline-workflow-preparation.ts";

export type { PipelineContext };
export { createChainedStageProjectMatch };

export type StaleResetPreflight = (client: IpcClient) => Promise<number | undefined>;

export const noopStaleResetPreflight: StaleResetPreflight = async () => undefined;

export type PipelineStageResolutionResult =
  | { ok: true; steps: AnyWorkflowStep[]; runStaleResetPreflight?: StaleResetPreflight }
  | {
      ok: true;
      results: Array<{
        steps: AnyWorkflowStep[];
        runStaleResetPreflight?: StaleResetPreflight;
        preflightCapture?: { message: string };
      }>;
    }
  | { ok: false; error: string };

function preparedStageResolution(
  prepared: Awaited<ReturnType<typeof preparePipelineStageWorkflow>>,
): PipelineStageResolutionResult {
  return prepared.ok
    ? { ok: true, steps: prepared.steps, runStaleResetPreflight: prepared.runStaleResetPreflight }
    : prepared;
}

export function isFanOutStageResolution(
  result: Extract<PipelineStageResolutionResult, { ok: true }>,
): result is { ok: true; results: Array<{ steps: AnyWorkflowStep[] }> } {
  return "results" in result;
}

export function singleStageResolutionSteps(
  result: Extract<PipelineStageResolutionResult, { ok: true }>,
): AnyWorkflowStep[] {
  if (isFanOutStageResolution(result)) {
    throw new Error("pipeline-stage-resolve: fan-out resolution requires per-branch dispatch");
  }
  return result.steps;
}

export type PipelineStageResolveDeps = {
  builders?: typeof WORKFLOW_PRESET_BUILDERS;
  loadRun?: (runId: string) => { worktreePath: string; branch: string } | null;
  branchKey?: string;
  splitPosition?: number;
  staleReset?: PipelineStaleResetPreparation;
};

function unmappedResult(stage: PipelineStage & { kind: "workflow" }): { ok: false; error: string } {
  return {
    ok: false,
    error: `pipeline-stage-resolve: no preset mapping for stage "${stage.stageId}" (workflow "${stage.workflow}", review "${stage.review}")`,
  };
}

function artifactBranchKeyForStageIndex(
  stageIndex: number,
  activeBranchKey: string,
  splitPosition: number | undefined,
): string {
  if (splitPosition === undefined || stageIndex <= splitPosition) {
    return DEFAULT_PIPELINE_STAGE_BRANCH_KEY;
  }
  return activeBranchKey;
}

/** Walk back from `stageIndex`, skipping approval stages, to the nearest preceding workflow stage's artifact. */
function findPrecedingWorkflowArtifact(
  stages: readonly PipelineStage[],
  stageIndex: number,
  stageArtifacts: ReadonlyMap<string, PipelineStageArtifact>,
  activeBranchKey: string,
  splitPosition: number | undefined,
): PipelineStageArtifact | undefined {
  for (let index = stageIndex - 1; index >= 0; index -= 1) {
    const candidate = stages[index];
    if (candidate?.kind === "workflow") {
      const key = stageArtifactKey(
        candidate.stageId,
        artifactBranchKeyForStageIndex(index, activeBranchKey, splitPosition),
      );
      return stageArtifacts.get(key);
    }
  }
  return undefined;
}

type PriorArtifactContext = {
  artifact: PipelineStageArtifact;
  cwd: string;
  worktreePath: string;
  branch: string;
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
  if (priorEntryRun.branch.length === 0) {
    return {
      ok: false,
      error: `pipeline-stage-resolve: entry run ${priorArtifact.entryRunId} is missing branch`,
    };
  }
  return {
    ok: true,
    prior: {
      artifact: priorArtifact,
      cwd: priorEntryRun.worktreePath,
      worktreePath: priorEntryRun.worktreePath,
      branch: priorEntryRun.branch,
      specPath: priorArtifact.specPath,
    },
  };
}

function isChainedPlanReadyIntentPath(specPath: string): boolean {
  return specPath.endsWith(".md");
}

function resolveChainedImplementSpecPath(
  worktreePath: string,
  specPath: string,
): { ok: true; specPath: string } | { ok: false; error: string } {
  // Plan completion records specPath as the spec directory; normalize to index.md for implement.
  if (isChainedPlanReadyIntentPath(specPath)) {
    return { ok: true, specPath };
  }
  const indexPath = join(specPath, "index.md");
  if (!existsSync(join(worktreePath, indexPath))) {
    return {
      ok: false,
      error: `pipeline-stage-resolve: expected index at ${indexPath} in prior worktree`,
    };
  }
  return { ok: true, specPath: indexPath };
}

type ChainedReadyIntentPaths =
  | { ok: true; kind: "single"; path: string }
  | { ok: true; kind: "fan-out"; paths: readonly string[] }
  | { ok: false; error: string };

function verifyChainedReadyIntentPath(
  prior: PriorArtifactContext,
  path: string,
): { ok: true } | { ok: false; error: string } {
  if (!isChainedPlanReadyIntentPath(path)) {
    return {
      ok: false,
      error: "pipeline-stage-resolve: downstream input must be a ready-intent file, not a directory",
    };
  }
  if (!existsSync(join(prior.worktreePath, path))) {
    return {
      ok: false,
      error: `pipeline-stage-resolve: downstream input ${path} not found in prior worktree`,
    };
  }
  return { ok: true };
}

function resolveVerifiedChainedReadyIntentPath(
  prior: PriorArtifactContext,
  path: string,
  asFanOut: boolean,
): ChainedReadyIntentPaths {
  const verified = verifyChainedReadyIntentPath(prior, path);
  if (!verified.ok) return verified;
  if (asFanOut) return { ok: true, kind: "fan-out", paths: [path] };
  return { ok: true, kind: "single", path };
}

/**
 * Fan-out happens only at the plan stage — the pipeline has already branched by the time implement
 * resolves, so this is called from the plan resolver alone.
 */
function resolveChainedReadyIntentPaths(prior: PriorArtifactContext): ChainedReadyIntentPaths {
  const downstreamInputs = prior.artifact.downstreamInputs;

  // Mutation checkpoint: treating absent/empty downstreamInputs as a fan-out, treating length 1 as a
  // multi fan-out, or collapsing a multi-input list to its first entry each must turn the fan-out
  // regressions RED.
  if (downstreamInputs === undefined || downstreamInputs.length === 0) {
    return { ok: true, kind: "single", path: prior.specPath };
  }

  if (downstreamInputs.length === 1) {
    const singlePath = downstreamInputs[0];
    if (singlePath !== undefined) {
      return resolveVerifiedChainedReadyIntentPath(prior, singlePath, false);
    }
  }

  for (const path of downstreamInputs) {
    const verified = verifyChainedReadyIntentPath(prior, path);
    // Mutation checkpoint: falling back to the directory specPath here instead of surfacing the
    // error must turn the missing-downstream-input regression RED.
    if (!verified.ok) return verified;
  }
  return { ok: true, kind: "fan-out", paths: downstreamInputs };
}

function stageReviewPasses(stage: PipelineStage & { kind: "workflow" }): number {
  return stage.review === "none" ? 0 : 1;
}

async function resolveForDownstreamPaths(
  prior: PriorArtifactContext,
  paths: readonly string[],
  resolveOne: (
    prior: PriorArtifactContext,
    staleReset?: PipelineStaleResetPreparation,
  ) => Promise<PipelineStageResolutionResult>,
  staleReset?: PipelineStaleResetPreparation,
  mapSteps?: (steps: AnyWorkflowStep[]) => AnyWorkflowStep[],
): Promise<PipelineStageResolutionResult> {
  const results: Array<{
    steps: AnyWorkflowStep[];
    runStaleResetPreflight?: StaleResetPreflight;
    preflightCapture?: { message: string };
  }> = [];
  for (const downstreamPath of paths) {
    const preflightCapture = staleReset === undefined ? undefined : { message: "" };
    const branchStaleReset =
      staleReset === undefined || preflightCapture === undefined
        ? undefined
        : capturingStaleReset(staleReset, preflightCapture);
    const result = await resolveOne({ ...prior, specPath: downstreamPath }, branchStaleReset);
    if (!result.ok) return result;
    if (isFanOutStageResolution(result)) {
      return {
        ok: false,
        error: "pipeline-stage-resolve: fan-out resolution is not supported in downstream path binding",
      };
    }
    results.push({
      steps: mapSteps ? mapSteps(result.steps) : result.steps,
      ...(result.runStaleResetPreflight !== undefined ? { runStaleResetPreflight: result.runStaleResetPreflight } : {}),
      ...(preflightCapture !== undefined ? { preflightCapture } : {}),
    });
  }
  return { ok: true, results };
}

async function resolveImplementStage(
  stage: PipelineStage & { kind: "workflow" },
  prior: PriorArtifactContext,
  context: PipelineContext,
  builders: typeof WORKFLOW_PRESET_BUILDERS,
  staleReset?: PipelineStaleResetPreparation,
): Promise<PipelineStageResolutionResult> {
  const specPathResult = resolveChainedImplementSpecPath(prior.worktreePath, prior.specPath);
  if (!specPathResult.ok) return specPathResult;
  const specPath = specPathResult.specPath;

  const usesDefaultBuilder = builders.implement === WORKFLOW_PRESET_BUILDERS.implement;
  let input: BuildImplementWorkflowStepsInput = {
    cwd: prior.cwd,
    baseRef: prior.branch,
    specPath,
    ...(context.configPath !== undefined ? { configPath: context.configPath } : {}),
    ...(context.projectRegistry !== undefined ? { projectRegistry: context.projectRegistry } : {}),
  };
  if (usesDefaultBuilder) {
    const projectMatch = createChainedStageProjectMatch(context)(prior.worktreePath);
    if (projectMatch === undefined) {
      return {
        ok: false,
        error: `pipeline-stage-resolve: no registered project matches prior worktree ${prior.worktreePath}`,
      };
    }
    input = {
      ...input,
      projectRoot: projectMatch.root,
      projectName: projectMatch.key,
      preflightGitRoot: prior.worktreePath,
    };
  }
  const prepared = await preparePipelineStageWorkflow("implement", "implement", input, context, builders, staleReset);
  return preparedStageResolution(prepared);
}

async function resolveIntentStage(
  stage: PipelineStage & { kind: "workflow" },
  context: PipelineContext,
  priorArtifact: PipelineStageArtifact | undefined,
  presetName: CliWorkflowPresetName,
  builders: typeof WORKFLOW_PRESET_BUILDERS,
  staleReset?: PipelineStaleResetPreparation,
): Promise<PipelineStageResolutionResult> {
  if (priorArtifact !== undefined) {
    return {
      ok: false,
      error: `pipeline-stage-resolve: stage "${stage.stageId}" is not the first workflow stage`,
    };
  }
  const input: IntentWorkflowInput = {
    cwd: context.cwd,
    reviewPasses: stageReviewPasses(stage),
    ...(stage.review === "light" || stage.review === "debate" ? { reviewBehavior: stage.review } : {}),
    ...(context.seedPath !== undefined
      ? { seed: context.seedPath }
      : context.seed !== undefined
        ? { seedText: context.seed }
        : {}),
    ...(context.targetDir !== undefined ? { targetDir: context.targetDir } : {}),
    ...(context.configPath !== undefined ? { configPath: context.configPath } : {}),
  };
  const prepared = await preparePipelineStageWorkflow("intent", presetName, input, context, builders, staleReset);
  return preparedStageResolution(prepared);
}

async function resolvePlanStage(
  stage: PipelineStage & { kind: "workflow" },
  prior: PriorArtifactContext,
  context: PipelineContext,
  presetName: CliWorkflowPresetName,
  builders: typeof WORKFLOW_PRESET_BUILDERS,
  staleReset?: PipelineStaleResetPreparation,
): Promise<PipelineStageResolutionResult> {
  // Mutation checkpoint: accepting a directory specPath here must turn the plan-stage
  // ready-intent-file regression RED.
  if (!isChainedPlanReadyIntentPath(prior.specPath)) {
    return {
      ok: false,
      error: `pipeline-stage-resolve: preceding artifact specPath must be a ready-intent file, not a directory`,
    };
  }
  const input: PlanWorkflowInput = {
    cwd: prior.cwd,
    readyIntent: prior.specPath,
    reviewPasses: stageReviewPasses(stage),
    ...(stage.review === "light" || stage.review === "debate" ? { reviewBehavior: stage.review } : {}),
    ...(context.targetDir !== undefined ? { targetDir: context.targetDir } : {}),
    ...(context.configPath !== undefined ? { configPath: context.configPath } : {}),
  };
  const prepared = await preparePipelineStageWorkflow("plan", presetName, input, context, builders, staleReset);
  return preparedStageResolution(prepared);
}

function leaveDraftWriteStepMapper(steps: AnyWorkflowStep[]): AnyWorkflowStep[] {
  return steps.map((step) =>
    step.behavior === "write" && step.publishCompletion !== false ? { ...step, skipReadyFinalization: true } : step,
  );
}

async function resolveImplementWorkflowStage(
  definition: PipelineDefinition,
  stage: PipelineStage & { kind: "workflow" },
  context: PipelineContext,
  priorArtifact: PipelineStageArtifact | undefined,
  deps: PipelineStageResolveDeps,
  builders: typeof WORKFLOW_PRESET_BUILDERS,
): Promise<PipelineStageResolutionResult> {
  if (stage.review !== "light" && stage.review !== "debate") {
    return unmappedResult(stage);
  }
  const loadRun = deps.loadRun;
  if (loadRun === undefined) {
    return { ok: false, error: "pipeline-stage-resolve: loadRun is required for chained stage resolution" };
  }
  const priorResult = resolvePriorArtifactContext(stage, priorArtifact, context, loadRun);
  if (!priorResult.ok) return priorResult;

  // Implement never re-fans out: the pipeline already branched at plan, so this stage resolves
  // exactly one input. Mutation checkpoint: fanning out here must turn the
  // "later stages do not re-fan out" regression RED.
  const result = await resolveImplementStage(stage, priorResult.prior, context, builders, deps.staleReset);
  if (!result.ok || definition.terminalAction !== "leave-draft") return result;
  if (isFanOutStageResolution(result)) {
    return {
      ok: false,
      error: "pipeline-stage-resolve: implement stage resolution cannot fan out",
    };
  }
  return {
    ok: true,
    steps: leaveDraftWriteStepMapper(result.steps),
    ...(result.runStaleResetPreflight !== undefined ? { runStaleResetPreflight: result.runStaleResetPreflight } : {}),
  };
}

async function resolvePlanWorkflowStage(
  stage: PipelineStage & { kind: "workflow" },
  context: PipelineContext,
  priorArtifact: PipelineStageArtifact | undefined,
  presetName: CliWorkflowPresetName,
  deps: PipelineStageResolveDeps,
  builders: typeof WORKFLOW_PRESET_BUILDERS,
): Promise<PipelineStageResolutionResult> {
  const loadRun = deps.loadRun;
  if (loadRun === undefined) {
    return { ok: false, error: "pipeline-stage-resolve: loadRun is required for chained stage resolution" };
  }
  const priorResult = resolvePriorArtifactContext(stage, priorArtifact, context, loadRun);
  if (!priorResult.ok) return priorResult;

  const inputPaths = resolveChainedReadyIntentPaths(priorResult.prior);
  if (!inputPaths.ok) return inputPaths;

  if (inputPaths.kind === "fan-out") {
    return resolveForDownstreamPaths(
      priorResult.prior,
      inputPaths.paths,
      (prior, branchStaleReset) => resolvePlanStage(stage, prior, context, presetName, builders, branchStaleReset),
      deps.staleReset,
    );
  }

  const bound = inputPaths.path;
  const prior = { ...priorResult.prior, specPath: bound };
  return resolvePlanStage(stage, prior, context, presetName, builders, deps.staleReset);
}

/**
 * Resolve one pipeline stage into buildable workflow steps.
 *
 * Workflow-start preparation is the shared authority on which (workflow, review) pairs are
 * realizable and which preset each pair selects.
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
  const branchKey = deps.branchKey ?? DEFAULT_PIPELINE_STAGE_BRANCH_KEY;
  const priorArtifact = findPrecedingWorkflowArtifact(
    definition.stages,
    stageIndex,
    stageArtifacts,
    branchKey,
    deps.splitPosition,
  );

  const presetName = resolveWorkflowPresetName(stage.workflow, stage.review);
  if (presetName === undefined) {
    return unmappedResult(stage);
  }

  if (stage.workflow === "implement") {
    return resolveImplementWorkflowStage(definition, stage, context, priorArtifact, deps, builders);
  }

  if (stage.workflow === "intent") {
    return resolveIntentStage(stage, context, priorArtifact, presetName, builders, deps.staleReset);
  }
  if (stage.workflow === "plan") {
    return resolvePlanWorkflowStage(stage, context, priorArtifact, presetName, deps, builders);
  }
  return unmappedResult(stage);
}
