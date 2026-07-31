import { existsSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { findProjectMatch, type ProjectMatch, type ProjectRegistryEntry } from "../../../shared/project-registry.ts";
import type { ImplementReviewBehavior } from "../config/machine-config-loader.ts";
import { readMachineConfigDocument } from "../config/machine-config-loader.ts";
import {
  type BuildImplementWorkflowStepsDeps,
  type BuildImplementWorkflowStepsInput,
  buildImplementWorkflowSteps,
} from "../execution/implement-workflow-steps.ts";
import type { PipelineDefinition, PipelineStage } from "../execution/pipeline-definition.ts";
import {
  buildPlanWorkflowSteps,
  buildReviewedPlanLightWorkflowSteps,
  buildReviewedPlanWorkflowSteps,
  type IntentWorkflowInput,
  type PlanWorkflowDeps,
  type PlanWorkflowInput,
  type PlanWorkflowResult,
} from "../execution/publication-workflow-steps.ts";
import { loadWorkflowSteps as realLoadWorkflowSteps } from "../execution/workflow-loader.ts";
import { type CliWorkflowPresetName, WORKFLOW_PRESET_BUILDERS } from "../execution/workflow-presets.ts";
import type { AnyWorkflowStep } from "../execution/workflow-runner.ts";
import { jarvisHome } from "../paths.ts";
import type { PipelineContext } from "../persistence/state-store.ts";
import type { PipelineStageArtifact } from "./pipeline-stage-dispatch.ts";

export type { PipelineContext };

export type PipelineStageResolutionResult =
  | { ok: true; steps: AnyWorkflowStep[] }
  | { ok: true; results: Array<{ steps: AnyWorkflowStep[] }> }
  | { ok: false; error: string };

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
};

/** review posture -> preset name, for the two presets that consume a prior stage's artifact or the seed. */
const WORKFLOW_POSTURE_PRESETS: Record<string, Partial<Record<string, CliWorkflowPresetName>>> = {
  intent: { none: "intent", light: "intent-reviewed", debate: "intent" },
  plan: { none: "plan", light: "plan-reviewed-light", debate: "plan-reviewed" },
};

const FIXED_REVIEW_PASSES = 1;

let invertPriorWorktreeRootGuardForTest = false;
let collapseFanOutToFirstInputForTest = false;
let treatAbsentDownstreamInputsAsFanOutForTest = false;
let refanOutOnLaterStagesForTest = false;
let treatLength1AsMultiFanOutForTest = false;
let fallbackToDirectorySpecPathOnMissingForTest = false;

export function setInvertPriorWorktreeRootGuardForTest(value: boolean): void {
  invertPriorWorktreeRootGuardForTest = value;
}

export function setCollapseFanOutToFirstInputForTest(value: boolean): void {
  collapseFanOutToFirstInputForTest = value;
}

export function setTreatAbsentDownstreamInputsAsFanOutForTest(value: boolean): void {
  treatAbsentDownstreamInputsAsFanOutForTest = value;
}

export function setRefanOutOnLaterStagesForTest(value: boolean): void {
  refanOutOnLaterStagesForTest = value;
}

export function setTreatLength1AsMultiFanOutForTest(value: boolean): void {
  treatLength1AsMultiFanOutForTest = value;
}

export function setFallbackToDirectorySpecPathOnMissingForTest(value: boolean): void {
  fallbackToDirectorySpecPathOnMissingForTest = value;
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

function isUnderPath(child: string, parent: string): boolean {
  const resolvedChild = resolve(child);
  const resolvedParent = resolve(parent);
  const prefix = resolvedParent.endsWith(sep) ? resolvedParent : resolvedParent + sep;
  return resolvedChild === resolvedParent || resolvedChild.startsWith(prefix);
}

function projectRegistryFromContext(context: PipelineContext): Record<string, ProjectRegistryEntry> {
  if (context.projectRegistry !== undefined) return context.projectRegistry;
  const projects = readMachineConfigDocument(context.configPath)?.projects;
  return projects && typeof projects === "object" && !Array.isArray(projects)
    ? (projects as Record<string, ProjectRegistryEntry>)
    : {};
}

/** Pipeline chained stages match cwd under the admission root or jarvis external worktrees. */
export function createChainedStageProjectMatch(context: PipelineContext): (path: string) => ProjectMatch | undefined {
  const registry = projectRegistryFromContext(context);
  const admissionRoot = context.cwd;
  return (path: string) => {
    const direct = findProjectMatch(path, registry);
    if (direct !== undefined && isUnderPath(path, admissionRoot)) return direct;
    const resolved = resolve(path);
    const jarvisRoot = jarvisHome();
    for (const key of Object.keys(registry)) {
      const externalRoot = join(jarvisRoot, "worktrees", key);
      if (isUnderPath(resolved, externalRoot)) {
        return { key, root: admissionRoot };
      }
    }
    return direct;
  };
}

function chainedPlanWorkflowDeps(context: PipelineContext): PlanWorkflowDeps {
  return { resolveProjectMatch: createChainedStageProjectMatch(context) };
}

function chainedImplementWorkflowDeps(context: PipelineContext): BuildImplementWorkflowStepsDeps {
  const configPath = context.configPath;
  return {
    resolveProjectMatch: createChainedStageProjectMatch(context),
    ...(configPath !== undefined
      ? {
          configPath,
          loadWorkflowSteps: (steps) => realLoadWorkflowSteps(steps, { machineConfigPath: configPath }),
        }
      : {}),
  };
}

async function invokePlanPresetBuilder(
  presetName: CliWorkflowPresetName,
  input: PlanWorkflowInput,
  context: PipelineContext,
  builders: typeof WORKFLOW_PRESET_BUILDERS,
): Promise<PlanWorkflowResult> {
  const customBuilder = builders[presetName];
  const defaultBuilder = WORKFLOW_PRESET_BUILDERS[presetName];
  if (customBuilder !== defaultBuilder) {
    return (await customBuilder(input as unknown as BuildImplementWorkflowStepsInput)) as PlanWorkflowResult;
  }
  const deps = chainedPlanWorkflowDeps(context);
  switch (presetName) {
    case "plan":
      return buildPlanWorkflowSteps(input, deps);
    case "plan-reviewed":
      return buildReviewedPlanWorkflowSteps(input, deps);
    case "plan-reviewed-light":
      return buildReviewedPlanLightWorkflowSteps(input, deps);
    default:
      return (await customBuilder(input as unknown as BuildImplementWorkflowStepsInput)) as PlanWorkflowResult;
  }
}

async function invokeImplementPresetBuilder(
  input: BuildImplementWorkflowStepsInput,
  context: PipelineContext,
  builders: typeof WORKFLOW_PRESET_BUILDERS,
): Promise<Awaited<ReturnType<typeof buildImplementWorkflowSteps>>> {
  const customBuilder = builders.implement;
  if (customBuilder !== WORKFLOW_PRESET_BUILDERS.implement) {
    return customBuilder(input);
  }
  return buildImplementWorkflowSteps(input, chainedImplementWorkflowDeps(context));
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
      cwd: selectChainedStageCwd(context.cwd, priorEntryRun.worktreePath),
      worktreePath: priorEntryRun.worktreePath,
      branch: priorEntryRun.branch,
      specPath: priorArtifact.specPath,
    },
  };
}

function isChainedPlanReadyIntentPath(specPath: string): boolean {
  return specPath.endsWith(".md");
}

type ChainedReadyIntentPaths =
  | { ok: true; kind: "single"; path: string }
  | { ok: true; kind: "fan-out"; paths: readonly string[] }
  | { ok: false; error: string };

function chainedStageAllowsFanOut(stage: PipelineStage & { kind: "workflow" }): boolean {
  if (stage.workflow === "plan") return true;
  return refanOutOnLaterStagesForTest && stage.workflow !== "intent";
}

function resolveChainedReadyIntentPaths(
  prior: PriorArtifactContext,
  stage: PipelineStage & { kind: "workflow" },
): ChainedReadyIntentPaths {
  const downstreamInputs = prior.artifact.downstreamInputs;
  const allowFanOut = chainedStageAllowsFanOut(stage);

  if (!allowFanOut) {
    return { ok: true, kind: "single", path: prior.specPath };
  }

  if (downstreamInputs === undefined || downstreamInputs.length === 0) {
    if (treatAbsentDownstreamInputsAsFanOutForTest) {
      return { ok: true, kind: "fan-out", paths: [prior.specPath] };
    }
    return { ok: true, kind: "single", path: prior.specPath };
  }

  const verifyPath = (path: string): { ok: true } | { ok: false; error: string } => {
    if (!isChainedPlanReadyIntentPath(path)) {
      return {
        ok: false,
        error: "pipeline-stage-resolve: downstream input must be a ready-intent file, not a directory",
      };
    }
    if (!existsSync(join(prior.worktreePath, path))) {
      if (fallbackToDirectorySpecPathOnMissingForTest) {
        return { ok: true };
      }
      return {
        ok: false,
        error: `pipeline-stage-resolve: downstream input ${path} not found in prior worktree`,
      };
    }
    return { ok: true };
  };

  if (downstreamInputs.length === 1) {
    const path = downstreamInputs[0]!;
    const verified = verifyPath(path);
    if (!verified.ok) {
      if (fallbackToDirectorySpecPathOnMissingForTest) {
        return { ok: true, kind: "single", path: prior.specPath };
      }
      return verified;
    }
    if (treatLength1AsMultiFanOutForTest) {
      return { ok: true, kind: "fan-out", paths: [path] };
    }
    return { ok: true, kind: "single", path };
  }

  if (collapseFanOutToFirstInputForTest) {
    const path = downstreamInputs[0]!;
    const verified = verifyPath(path);
    if (!verified.ok) {
      if (fallbackToDirectorySpecPathOnMissingForTest) {
        return { ok: true, kind: "single", path: prior.specPath };
      }
      return verified;
    }
    return { ok: true, kind: "single", path };
  }

  for (const path of downstreamInputs) {
    const verified = verifyPath(path);
    if (!verified.ok) {
      if (fallbackToDirectorySpecPathOnMissingForTest) {
        return { ok: true, kind: "single", path: prior.specPath };
      }
      return verified;
    }
  }
  return { ok: true, kind: "fan-out", paths: downstreamInputs };
}

function pathForDownstreamInput(
  prior: PriorArtifactContext,
  path: string,
): { ok: true; path: string } | { ok: false; error: string } {
  if (fallbackToDirectorySpecPathOnMissingForTest && !existsSync(join(prior.worktreePath, path))) {
    return { ok: true, path: prior.artifact.specPath };
  }
  return { ok: true, path };
}

async function resolveForDownstreamPaths(
  prior: PriorArtifactContext,
  paths: readonly string[],
  resolveOne: (prior: PriorArtifactContext) => Promise<PipelineStageResolutionResult>,
  mapSteps?: (steps: AnyWorkflowStep[]) => AnyWorkflowStep[],
): Promise<PipelineStageResolutionResult> {
  const results: Array<{ steps: AnyWorkflowStep[] }> = [];
  for (const downstreamPath of paths) {
    const bound = pathForDownstreamInput(prior, downstreamPath);
    if (!bound.ok) return bound;
    const result = await resolveOne({ ...prior, specPath: bound.path });
    if (!result.ok) return result;
    const steps = singleStageResolutionSteps(result);
    results.push({ steps: mapSteps ? mapSteps(steps) : steps });
  }
  return { ok: true, results };
}

function toResolution(result: { ok: true; steps: AnyWorkflowStep[] } | { ok: false; error: string }) {
  return result.ok ? { ok: true as const, steps: result.steps } : { ok: false as const, error: result.error };
}

async function resolveImplementStage(
  stage: PipelineStage & { kind: "workflow" },
  prior: PriorArtifactContext,
  context: PipelineContext,
  builders: typeof WORKFLOW_PRESET_BUILDERS,
): Promise<PipelineStageResolutionResult> {
  const customBuilder = builders.implement;
  if (customBuilder !== WORKFLOW_PRESET_BUILDERS.implement) {
    const input: BuildImplementWorkflowStepsInput = {
      cwd: prior.cwd,
      baseRef: prior.branch,
      specPath: prior.specPath,
      reviewPasses: FIXED_REVIEW_PASSES,
      reviewBehavior: stage.review as ImplementReviewBehavior,
    };
    return toResolution(await customBuilder(input));
  }

  const projectMatch = createChainedStageProjectMatch(context)(prior.worktreePath);
  if (projectMatch === undefined) {
    return {
      ok: false,
      error: `pipeline-stage-resolve: no registered project matches prior worktree ${prior.worktreePath}`,
    };
  }
  const input: BuildImplementWorkflowStepsInput = {
    cwd: prior.cwd,
    baseRef: prior.branch,
    specPath: prior.specPath,
    reviewPasses: FIXED_REVIEW_PASSES,
    reviewBehavior: stage.review as ImplementReviewBehavior,
    projectRoot: projectMatch.root,
    projectName: projectMatch.key,
    preflightGitRoot: prior.worktreePath,
    ...(context.configPath !== undefined ? { configPath: context.configPath } : {}),
    ...(context.projectRegistry !== undefined ? { projectRegistry: context.projectRegistry } : {}),
  };
  return toResolution(await invokeImplementPresetBuilder(input, context, builders));
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
  if (!isChainedPlanReadyIntentPath(prior.specPath) && !fallbackToDirectorySpecPathOnMissingForTest) {
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
  return toResolution(await invokePlanPresetBuilder(presetName, input, context, builders));
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

    if (refanOutOnLaterStagesForTest) {
      const inputPaths = resolveChainedReadyIntentPaths(priorResult.prior, stage);
      if (!inputPaths.ok) return inputPaths;
      if (inputPaths.kind === "fan-out") {
        return resolveForDownstreamPaths(
          priorResult.prior,
          inputPaths.paths,
          (prior) => resolveImplementStage(stage, prior, context, builders),
          definition.terminalAction === "leave-draft"
            ? (steps) =>
                steps.map((step) =>
                  step.behavior === "write" && step.publishCompletion !== false
                    ? { ...step, skipReadyFinalization: true }
                    : step,
                )
            : undefined,
        );
      }
    }

    const result = await resolveImplementStage(stage, priorResult.prior, context, builders);
    if (!result.ok || definition.terminalAction !== "leave-draft") return result;
    return {
      ok: true,
      steps: singleStageResolutionSteps(result).map((step) =>
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

    const inputPaths = resolveChainedReadyIntentPaths(priorResult.prior, stage);
    if (!inputPaths.ok) return inputPaths;

    if (inputPaths.kind === "fan-out") {
      return resolveForDownstreamPaths(priorResult.prior, inputPaths.paths, (prior) =>
        resolvePlanStage(stage, prior, context, presetName, builders),
      );
    }

    const bound = pathForDownstreamInput(priorResult.prior, inputPaths.path);
    if (!bound.ok) return bound;
    const prior = { ...priorResult.prior, specPath: bound.path };
    return resolvePlanStage(stage, prior, context, presetName, builders);
  }
  return unmappedResult(stage);
}
