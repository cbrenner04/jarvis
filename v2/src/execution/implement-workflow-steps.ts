import { readFileSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { resolveActiveLinkedSubspec as realResolveActiveLinkedSubspec } from "../../../shared/linked-subspec-routing.ts";
import { findProjectMatch, type ProjectMatch } from "../../../shared/project-registry.ts";
import {
  implementReviewPromptProfile,
  PATCH_REVIEW_CRITIC_PROMPT_ID,
  PATCH_REVIEW_DEBATE_ROLE_PROMPT_IDS,
} from "../../../shared/prompts/review-implement.ts";
import { parseSpec } from "../../../shared/spec-parser.ts";
import { type AsyncSubprocessRunner, realAsyncSubprocessRunner } from "../../../shared/subprocess.ts";
import type { ImplementReviewBehavior } from "../config/machine-config-loader.ts";
import {
  readProjectImplementReviewBehavior,
  readProjectImplementReviewPasses,
  readProjectPipelineConfig,
  readProjectRegistry,
} from "../config/machine-config-loader.ts";
import { getExternalWorktreePath } from "./external-worktree.ts";
import type { PipelineDefinition } from "./pipeline-definition.ts";
import { getPipelineDefinition } from "./pipeline-registry.ts";
import { type ProjectPipelineResolutionResult, resolveProjectPipeline } from "./project-pipeline-resolution.ts";
import {
  type ReviewDebateWorkflowSourceStep,
  type ReviewWorkflowSourceStep,
  loadWorkflowSteps as realLoadWorkflowSteps,
  type WorkflowSourceStep,
  type WriteWorkflowSourceStep,
} from "./workflow-loader.ts";
import {
  type AnyWorkflowStep,
  type ReviewDebateWorkflowStep,
  type ReviewWorkflowStep,
  resolveWorkflowPreset,
  type WriteWorkflowStep,
} from "./workflow-runner.ts";
import { DEFAULT_WRITE_STEP_RULES } from "./write-loop-input.ts";

/** Per-run inputs the operator supplies alongside cwd project resolution. */
export type BuildImplementWorkflowStepsInput = {
  cwd: string;
  branchName?: string;
  baseRef: string;
  specPath: string;
  artifactPath?: string;
  projectRoot?: string;
  projectName?: string;
  reviewPasses?: number;
  reviewBehavior?: ImplementReviewBehavior;
  configPath?: string;
  projectRegistry?: Record<string, { root: string; origin?: string }>;
};

/** Test-only seams for project resolution and machine-config loading. */
export type BuildImplementWorkflowStepsDeps = {
  resolveProjectMatch?: (p: string) => ProjectMatch | undefined;
  readProjectRegistry?: () => Record<string, { root: string; origin?: string }>;
  configPath?: string;
  loadWorkflowSteps?: (steps: readonly WorkflowSourceStep[]) => AnyWorkflowStep[];
  resolveActiveLinkedSubspec?: (
    specPath: string,
    projectRoot: string,
  ) => ReturnType<typeof realResolveActiveLinkedSubspec>;
  readSpecFile?: (path: string) => string;
  asyncSubprocessRunner?: AsyncSubprocessRunner;
};

export type BuildImplementWorkflowStepsResult =
  | { ok: true; steps: AnyWorkflowStep[]; pipelineDefinition?: PipelineDefinition }
  | { ok: false; error: string };

function resolveImplementReviewPasses(reviewPasses: number): number | { error: string } {
  if (!Number.isInteger(reviewPasses) || reviewPasses < 0) {
    return { error: "implement: reviewPasses must be a non-negative integer" };
  }
  return reviewPasses;
}

function resolveExistingImplementPath(label: string, path: string): string | { error: string } {
  try {
    return realpathSync(path);
  } catch {
    return { error: `${label} path does not exist: ${path}` };
  }
}

async function isSpecAvailableInBaseRef(
  projectRoot: string,
  baseRef: string,
  specPath: string,
  runner: AsyncSubprocessRunner,
): Promise<boolean> {
  try {
    await runner.runAsync("git", ["cat-file", "-e", `${baseRef}:${specPath}`], projectRoot, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** Resolve the spec path and its owning project match from the registry, with existence checks. */
function resolveImplementSpecAndProject(
  input: BuildImplementWorkflowStepsInput,
  deps: BuildImplementWorkflowStepsDeps,
): { match: ProjectMatch; resolvedSpecPath: string } | { error: string } {
  const requestedSpecPath = resolve(input.cwd, input.specPath);
  const resolvedSpecPath = resolveExistingImplementPath("Spec", requestedSpecPath);
  if (typeof resolvedSpecPath === "object") return resolvedSpecPath;

  const registry =
    input.projectRegistry ??
    (deps.readProjectRegistry ?? (() => readProjectRegistry(input.configPath ?? deps.configPath)))();
  const lexicalMatch =
    (deps.resolveProjectMatch ?? ((p: string) => findProjectMatch(p, registry)))(requestedSpecPath) ??
    findProjectMatch(resolvedSpecPath, registry);
  if (lexicalMatch === undefined) {
    return { error: `Spec path outside registered project roots: ${resolvedSpecPath}` };
  }
  const root = resolveExistingImplementPath("Registered project root", lexicalMatch.root);
  if (typeof root === "object") return root;
  const match = { ...lexicalMatch, root };
  if (findProjectMatch(resolvedSpecPath, { [match.key]: { root: match.root } }) === undefined) {
    return { error: `Spec path outside registered project roots: ${resolvedSpecPath}` };
  }
  return { match, resolvedSpecPath };
}

function resolveImplementArtifact(
  input: BuildImplementWorkflowStepsInput,
  resolvedSpecPath: string,
  match: ProjectMatch,
): { isIndexSpec: boolean; artifactPath?: string } | { error: string } {
  const isIndexSpec = basename(resolvedSpecPath) === "index.md";
  const artifactPath = isIndexSpec ? resolvedSpecPath : input.artifactPath;
  if (artifactPath === undefined) return { error: "Non-index spec requires --artifact" };
  const resolvedArtifactPath = isIndexSpec
    ? resolvedSpecPath
    : resolveExistingImplementPath("Artifact", resolve(input.cwd, artifactPath));
  if (typeof resolvedArtifactPath === "object") return resolvedArtifactPath;
  if (findProjectMatch(resolvedArtifactPath, { [match.key]: { root: match.root } }) === undefined) {
    return { error: `Artifact path outside registered project root: ${resolvedArtifactPath}` };
  }
  return {
    isIndexSpec,
    ...(isIndexSpec ? {} : { artifactPath: relative(match.root, resolvedArtifactPath) }),
  };
}

function resolveImplementReviewConfig(
  input: BuildImplementWorkflowStepsInput,
  match: ProjectMatch,
  configPath: string | undefined,
): { reviewPasses: number; reviewBehavior: ImplementReviewBehavior } | { error: string } {
  const reviewPasses =
    input.reviewPasses !== undefined
      ? { ok: true as const, reviewPasses: input.reviewPasses }
      : configPath === undefined
        ? { ok: true as const, reviewPasses: 1 }
        : readProjectImplementReviewPasses(match.key, configPath);
  if (!reviewPasses.ok) return { error: reviewPasses.error };
  const reviewBehavior =
    input.reviewBehavior !== undefined
      ? { ok: true as const, reviewBehavior: input.reviewBehavior }
      : configPath === undefined
        ? { ok: true as const, reviewBehavior: "debate" as const }
        : readProjectImplementReviewBehavior(match.key, configPath);
  if (!reviewBehavior.ok) return { error: reviewBehavior.error };
  return { reviewPasses: reviewPasses.reviewPasses, reviewBehavior: reviewBehavior.reviewBehavior };
}

async function resolveImplementLaunch(
  input: BuildImplementWorkflowStepsInput,
  deps: BuildImplementWorkflowStepsDeps,
): Promise<BuildImplementWorkflowStepsInput | { error: string }> {
  if (input.projectRoot !== undefined || deps.resolveProjectMatch !== undefined) {
    return {
      ...input,
      ...(input.projectRoot !== undefined
        ? { branchName: input.branchName ?? basename(dirname(resolve(input.projectRoot, input.specPath))) }
        : {}),
      reviewPasses: input.reviewPasses ?? 1,
    };
  }

  const resolvedSpec = resolveImplementSpecAndProject(input, deps);
  if ("error" in resolvedSpec) return resolvedSpec;
  const { match, resolvedSpecPath } = resolvedSpec;
  const projectRelativeSpecPath = relative(match.root, resolvedSpecPath);

  const artifact = resolveImplementArtifact(input, resolvedSpecPath, match);
  if ("error" in artifact) return artifact;

  const reviewConfig = resolveImplementReviewConfig(input, match, input.configPath ?? deps.configPath);
  if ("error" in reviewConfig) return reviewConfig;

  if (
    !(await isSpecAvailableInBaseRef(
      match.root,
      input.baseRef,
      projectRelativeSpecPath,
      deps.asyncSubprocessRunner ?? realAsyncSubprocessRunner,
    ))
  ) {
    return { error: `Spec path unavailable in base ref ${input.baseRef}: ${projectRelativeSpecPath}` };
  }

  return {
    ...input,
    branchName: input.branchName ?? basename(dirname(resolvedSpecPath)),
    specPath: projectRelativeSpecPath,
    projectRoot: match.root,
    projectName: match.key,
    ...(artifact.isIndexSpec ? {} : { artifactPath: artifact.artifactPath }),
    reviewPasses: reviewConfig.reviewPasses,
    reviewBehavior: reviewConfig.reviewBehavior,
  };
}

function resolveImplementProjectMatch(
  input: BuildImplementWorkflowStepsInput,
  resolveProjectMatch: (p: string) => ProjectMatch | undefined,
): ProjectMatch | { error: string } {
  if (input.projectRoot !== undefined) {
    return { key: input.projectName ?? "", root: input.projectRoot };
  }
  const resolved = resolveProjectMatch(input.cwd);
  if (resolved === undefined) {
    return { error: `No registered project matches cwd: ${input.cwd}` };
  }
  return resolved;
}

function resolveImplementExpectedArtifactPath(
  isIndexSpec: boolean,
  specPath: string,
  artifactPath?: string,
): string | { error: string } {
  if (isIndexSpec) {
    return specPath;
  }
  if (artifactPath !== undefined) {
    return artifactPath;
  }
  return { error: "Non-index spec requires artifact path" };
}

function validateLinkedIndexRouting(
  isIndexSpec: boolean,
  absoluteSpecPath: string,
  projectRoot: string,
  resolveLinkedSubspec: NonNullable<BuildImplementWorkflowStepsDeps["resolveActiveLinkedSubspec"]>,
): { error: string } | undefined {
  if (!isIndexSpec) {
    return undefined;
  }
  const routingResult = resolveLinkedSubspec(absoluteSpecPath, projectRoot);
  if (routingResult.ok || routingResult.errorKind === "empty_index" || routingResult.errorKind === "already_complete") {
    return undefined;
  }
  return { error: `implement.${routingResult.errorKind}: ${routingResult.error}` };
}

function specHasUncheckedAutomatedCriterion(content: string): boolean {
  return parseSpec(content).acceptanceCriteria.some((criterion) => !criterion.humanOnly && !criterion.checked);
}

const ALREADY_COMPLETE_ERROR =
  "implement.already_complete: requested spec has no unchecked non-human-only acceptance criteria";

function validateSpecTreeCompletion(
  absoluteSpecPath: string,
  projectRoot: string,
  readSpecFile: (path: string) => string,
): string | undefined {
  let specContent: string;
  try {
    specContent = readSpecFile(absoluteSpecPath);
  } catch (err) {
    return `implement.link_unreadable: ${err instanceof Error ? err.message : String(err)}`;
  }
  const linkedSubspecs = parseSpec(specContent).linkedSubspecs;
  if (basename(absoluteSpecPath) !== "index.md" || linkedSubspecs.length === 0) {
    return specHasUncheckedAutomatedCriterion(specContent) ? undefined : ALREADY_COMPLETE_ERROR;
  }
  for (const subspec of linkedSubspecs) {
    const subspecPath = isAbsolute(subspec.path) ? subspec.path : resolve(dirname(absoluteSpecPath), subspec.path);
    if (relative(projectRoot, subspecPath).startsWith("..")) {
      return `implement.link_out_of_tree: Linked path is outside project: ${subspec.path}`;
    }
    try {
      if (specHasUncheckedAutomatedCriterion(readSpecFile(subspecPath))) return undefined;
    } catch (err) {
      return `implement.link_unreadable: ${err instanceof Error ? err.message : String(err)}`;
    }
  }
  return ALREADY_COMPLETE_ERROR;
}

function stampImplementReviewBehavior(
  steps: readonly AnyWorkflowStep[],
  reviewBehavior: ImplementReviewBehavior,
): AnyWorkflowStep[] {
  return steps.map((step) =>
    step.behavior === "write" && step.role === "implement" && step.suppressShrink !== true
      ? { ...step, implementReviewBehavior: reviewBehavior }
      : step,
  );
}

function loadImplementWorkflowSteps(
  loadSteps: NonNullable<BuildImplementWorkflowStepsDeps["loadWorkflowSteps"]>,
  sourceSteps: readonly WorkflowSourceStep[],
  reviewPasses: number,
  reviewBehavior: ImplementReviewBehavior,
): BuildImplementWorkflowStepsResult {
  try {
    if (reviewPasses === 0) {
      const loadedSteps = loadSteps(sourceSteps).filter((step): step is WriteWorkflowStep => step.behavior === "write");
      return {
        ok: true,
        steps: stampImplementReviewBehavior(resolveWorkflowPreset("implement", loadedSteps), reviewBehavior),
      };
    }

    const loaded = loadSteps(sourceSteps);
    const writeSteps = loaded.filter((step): step is WriteWorkflowStep => step.behavior === "write");
    if (reviewBehavior === "light") {
      const reviewStep = loaded.find((step): step is ReviewWorkflowStep => step.behavior === "review");
      if (reviewStep === undefined) {
        return { ok: false, error: "implement: review step was not loaded" };
      }
      return {
        ok: true,
        steps: stampImplementReviewBehavior(
          [...resolveWorkflowPreset("implement", writeSteps), reviewStep],
          reviewBehavior,
        ),
      };
    }

    const debateStep = loaded.find((step): step is ReviewDebateWorkflowStep => step.behavior === "review-debate");
    if (debateStep === undefined) {
      return { ok: false, error: "implement: review-debate step was not loaded" };
    }
    return {
      ok: true,
      steps: stampImplementReviewBehavior(
        [...resolveWorkflowPreset("implement", writeSteps), debateStep],
        reviewBehavior,
      ),
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function formatProjectPipelineResolutionError(
  resolution: Extract<ProjectPipelineResolutionResult, { ok: false }>,
): string {
  const { error } = resolution;
  if (error.code === "invalid-project-pipeline-config") {
    return `${error.code}: ${error.message}`;
  }
  if (error.code === "unknown-pipeline") {
    return `${error.code}: ${error.name}`;
  }
  return `${error.code}: ${error.errors.map((item) => item.message).join("; ")}`;
}

function admitProjectPipeline(
  built: BuildImplementWorkflowStepsResult,
  input: BuildImplementWorkflowStepsInput,
  match: ProjectMatch,
  configPath: string | undefined,
): BuildImplementWorkflowStepsResult {
  if (!built.ok || input.projectRegistry === undefined) return built;
  const agentModelConfig = built.steps[0]?.agentModelConfig;
  if (agentModelConfig === undefined) {
    return { ok: false, error: "invalid-pipeline-definition: loaded workflow has no agent model config" };
  }
  const resolution = resolveProjectPipeline(
    readProjectPipelineConfig(match.key, configPath),
    getPipelineDefinition,
    agentModelConfig,
  );
  if (!resolution.ok) return { ok: false, error: formatProjectPipelineResolutionError(resolution) };
  return { ...built, pipelineDefinition: resolution.definition };
}

/** Build the implement preset workflow for cwd + run args. */
export async function buildImplementWorkflowSteps(
  input: BuildImplementWorkflowStepsInput,
  deps: BuildImplementWorkflowStepsDeps = {},
): Promise<BuildImplementWorkflowStepsResult> {
  if (input.reviewPasses !== undefined) {
    const reviewPasses = resolveImplementReviewPasses(input.reviewPasses);
    if (typeof reviewPasses === "object") return { ok: false, error: reviewPasses.error };
  }
  const resolvedInput = await resolveImplementLaunch(input, deps);
  if ("error" in resolvedInput) return { ok: false, error: resolvedInput.error };
  const reviewPasses = resolveImplementReviewPasses(resolvedInput.reviewPasses ?? 1);
  if (typeof reviewPasses === "object") return { ok: false, error: reviewPasses.error };
  const reviewBehavior = resolvedInput.reviewBehavior ?? "debate";

  const resolveProjectMatch = deps.resolveProjectMatch ?? ((p: string) => findProjectMatch(p, readProjectRegistry()));
  const loadSteps = deps.loadWorkflowSteps ?? realLoadWorkflowSteps;
  const resolveLinkedSubspec = deps.resolveActiveLinkedSubspec ?? realResolveActiveLinkedSubspec;

  const match = resolveImplementProjectMatch(resolvedInput, resolveProjectMatch);
  if ("error" in match) return { ok: false, error: match.error };

  const absoluteSpecPath = resolve(match.root, resolvedInput.specPath);
  const isIndexSpec = basename(absoluteSpecPath) === "index.md";

  if (deps.resolveActiveLinkedSubspec === undefined || deps.readSpecFile !== undefined) {
    const completionError = validateSpecTreeCompletion(
      absoluteSpecPath,
      match.root,
      deps.readSpecFile ?? ((path) => readFileSync(path, "utf8")),
    );
    if (completionError !== undefined) return { ok: false, error: completionError };
  }

  const expectedArtifactPath = resolveImplementExpectedArtifactPath(
    isIndexSpec,
    resolvedInput.specPath,
    resolvedInput.artifactPath,
  );
  if (typeof expectedArtifactPath === "object") return { ok: false, error: expectedArtifactPath.error };

  const routingError = validateLinkedIndexRouting(isIndexSpec, absoluteSpecPath, match.root, resolveLinkedSubspec);
  if (routingError !== undefined) return { ok: false, error: routingError.error };

  const sourceStep: WriteWorkflowSourceStep = {
    behavior: "write",
    stepId: "implement",
    role: "implement",
    promptId: "patch.prompt.body",
    stepRules: DEFAULT_WRITE_STEP_RULES,
    worktree: {
      projectRoot: match.root,
      projectName: match.key,
      branchName: resolvedInput.branchName ?? "",
      baseRef: resolvedInput.baseRef,
    },
    specPath: resolvedInput.specPath,
    expectedArtifactPath,
    linkedIndexRouting: isIndexSpec,
  };
  const pipelineConfigPath = resolvedInput.configPath ?? deps.configPath;

  if (reviewPasses === 0) {
    return admitProjectPipeline(
      loadImplementWorkflowSteps(loadSteps, [sourceStep], reviewPasses, reviewBehavior),
      resolvedInput,
      match,
      pipelineConfigPath,
    );
  }

  const cwd = getExternalWorktreePath(sourceStep.worktree);
  const verdictPath = join(cwd, dirname(resolvedInput.specPath), "verdict-patch.md");
  // Serializable: steps cross the daemon IPC boundary as JSON, which drops functions.
  // The review executors stamp passNumber/priorCycleVerdict per cycle.
  const profileContext = {
    specPath: resolvedInput.specPath,
    cwd,
    baseBranch: input.baseRef,
    passNumber: 1,
    totalPasses: reviewPasses,
  };

  if (reviewBehavior === "light") {
    const reviewStep: ReviewWorkflowSourceStep = {
      behavior: "review",
      stepId: "implement-review",
      project: sourceStep.worktree.projectName,
      branch: sourceStep.worktree.branchName,
      cwd,
      prompt: PATCH_REVIEW_CRITIC_PROMPT_ID,
      verdictPath,
      maxCycles: reviewPasses,
      profile: implementReviewPromptProfile,
      profileContext,
    };
    return admitProjectPipeline(
      loadImplementWorkflowSteps(loadSteps, [sourceStep, reviewStep], reviewPasses, reviewBehavior),
      resolvedInput,
      match,
      pipelineConfigPath,
    );
  }

  const reviewStep: ReviewDebateWorkflowSourceStep = {
    behavior: "review-debate",
    stepId: "implement-review",
    project: sourceStep.worktree.projectName,
    branch: sourceStep.worktree.branchName,
    cwd,
    prompts: {
      adversary: PATCH_REVIEW_DEBATE_ROLE_PROMPT_IDS.adversary,
      advocate: PATCH_REVIEW_DEBATE_ROLE_PROMPT_IDS.advocate,
      adjudicator: PATCH_REVIEW_DEBATE_ROLE_PROMPT_IDS.adjudicator,
    },
    verdictPath,
    maxCycles: reviewPasses,
    profile: implementReviewPromptProfile,
    profileContext,
  };

  return admitProjectPipeline(
    loadImplementWorkflowSteps(loadSteps, [sourceStep, reviewStep], reviewPasses, reviewBehavior),
    resolvedInput,
    match,
    pipelineConfigPath,
  );
}
