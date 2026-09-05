import { readFileSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  hasUncheckedNonHumanOnlyCriteria,
  resolveActiveLinkedSubspec as realResolveActiveLinkedSubspec,
} from "../../../shared/linked-subspec-routing.ts";
import { findProjectMatch, type ProjectMatch } from "../../../shared/project-registry.ts";
import { projectSafeId } from "../../../shared/project-safe-id.ts";
import {
  implementReviewPromptProfile,
  PATCH_REVIEW_CRITIC_PROMPT_ID,
  PATCH_REVIEW_DEBATE_ROLE_PROMPT_IDS,
} from "../../../shared/prompts/review-implement.ts";
import { parseSpec } from "../../../shared/spec-parser.ts";
import { type AsyncSubprocessRunner, realAsyncSubprocessRunner } from "../../../shared/subprocess.ts";
import type { ImplementReviewBehavior } from "../config/machine-config-loader.ts";
import {
  readProjectConfigRecord,
  readProjectImplementReviewBehavior,
  readProjectImplementReviewPasses,
  readProjectRegistry,
} from "../config/machine-config-loader.ts";
import { jarvisHome, MACHINE_CONFIG_PATH } from "../paths.ts";
import { getExternalWorktreePath } from "./external-worktree.ts";
import type { PipelineDefinition } from "./pipeline-definition.ts";
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
import { IMPLEMENT_WRITE_STEP_RULES } from "./write-loop-input.ts";

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
  /** Git root for chained pipeline preflight; defaults to the resolved project root. */
  preflightGitRoot?: string;
  /** Prior stage branch for chained spec-availability preflight; publication `baseRef` stays the default branch. */
  preflightBaseRef?: string;
  /** Pre-resolved external plan identity from chained pipeline dispatch. */
  absoluteSpecPath?: string;
  specReadRoot?: string;
  externalPlanSpec?: true;
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

type ResolvedImplementLaunch = BuildImplementWorkflowStepsInput & {
  absoluteSpecPath?: string;
  specReadRoot?: string;
  externalPlanSpec?: true;
};

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
export type ImplementSpecIdentity = {
  project: string;
  projectRoot: string;
  specPath: string;
  absoluteSpecPath: string;
  externalPlanSpec?: true;
  specReadRoot?: string;
};

function isProjectConfigRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Project-only external plan admission: strict `git === false` or `plan.commit === false` (intent/plan also honor machine `modes.plan.commit`). */
export function planSourcePublishesExternally(projectConfig: Record<string, unknown>): boolean {
  return (
    projectConfig.git === false || (isProjectConfigRecord(projectConfig.plan) && projectConfig.plan.commit === false)
  );
}

function parseExternalPlanSpecPath(resolvedSpecPath: string): { safeId: string; specReadRoot: string } | undefined {
  const specsRoot = join(jarvisHome(), "specs");
  let resolvedSpecsRoot = specsRoot;
  try {
    resolvedSpecsRoot = realpathSync(specsRoot);
  } catch {
    return undefined;
  }
  if (!insideResolvedPath(resolvedSpecsRoot, resolvedSpecPath)) return undefined;
  const rel = relative(resolvedSpecsRoot, resolvedSpecPath);
  if (rel.startsWith("..") || isAbsolute(rel)) return undefined;
  const segments = rel.split(sep).filter((segment) => segment.length > 0);
  if (segments.length !== 4 || segments[1] !== "plans" || segments[3] !== "index.md") return undefined;
  const safeId = segments[0];
  if (safeId === undefined) return undefined;
  return {
    safeId,
    specReadRoot: dirname(resolvedSpecPath),
  };
}

export function resolveExternalPlanSpecIdentity(
  resolvedSpecPath: string,
  projectRegistry: Record<string, { root: string; origin?: string }>,
  configPath: string,
): ImplementSpecIdentity | { error: string } | undefined {
  const parsed = parseExternalPlanSpecPath(resolvedSpecPath);
  if (parsed === undefined) return undefined;
  const owners = Object.keys(projectRegistry).filter((key) => projectSafeId(key) === parsed.safeId);
  if (owners.length !== 1) {
    return { error: `Spec path outside registered project roots: ${resolvedSpecPath}` };
  }
  const project = owners[0]!;
  const projectConfig = readProjectConfigRecord(project, configPath);
  if (projectConfig === undefined || !planSourcePublishesExternally(projectConfig)) {
    return { error: `Spec path outside registered project roots: ${resolvedSpecPath}` };
  }
  const root = resolveExistingImplementPath("Registered project root", projectRegistry[project]!.root);
  if (typeof root === "object") return root;
  if (!insideResolvedPath(parsed.specReadRoot, resolvedSpecPath)) {
    return { error: `Spec path outside registered project roots: ${resolvedSpecPath}` };
  }
  let resolvedJarvisHome = jarvisHome();
  try {
    resolvedJarvisHome = realpathSync(jarvisHome());
  } catch {
    // keep lexical home when the directory is absent
  }
  return {
    project,
    projectRoot: root,
    specPath: relative(resolvedJarvisHome, resolvedSpecPath),
    absoluteSpecPath: resolvedSpecPath,
    externalPlanSpec: true,
    specReadRoot: parsed.specReadRoot,
  };
}

/** Resolve the canonical project and spec identity shared by implement preflight and recovery. */
export function resolveImplementSpecIdentity(
  cwd: string,
  specPath: string,
  projectRegistry: Record<string, { root: string; origin?: string }>,
  configPath: string = MACHINE_CONFIG_PATH,
): ImplementSpecIdentity | { error: string } {
  const requestedSpecPath = resolve(cwd, specPath);
  const resolvedSpecPath = resolveExistingImplementPath("Spec", requestedSpecPath);
  if (typeof resolvedSpecPath === "object") return resolvedSpecPath;
  const external = resolveExternalPlanSpecIdentity(resolvedSpecPath, projectRegistry, configPath);
  if (external !== undefined) return external;
  const lexicalMatch =
    findProjectMatch(requestedSpecPath, projectRegistry) ?? findProjectMatch(resolvedSpecPath, projectRegistry);
  if (lexicalMatch === undefined) {
    return { error: `Spec path outside registered project roots: ${resolvedSpecPath}` };
  }
  const root = resolveExistingImplementPath("Registered project root", lexicalMatch.root);
  if (typeof root === "object") return root;
  if (findProjectMatch(resolvedSpecPath, { [lexicalMatch.key]: { root } }) === undefined) {
    return { error: `Spec path outside registered project roots: ${resolvedSpecPath}` };
  }
  return {
    project: lexicalMatch.key,
    projectRoot: root,
    specPath: relative(root, resolvedSpecPath),
    absoluteSpecPath: resolvedSpecPath,
  };
}

function insideResolvedPath(parent: string, child: string): boolean {
  let resolvedParent = parent;
  let resolvedChild = child;
  try {
    resolvedParent = realpathSync(parent);
    resolvedChild = realpathSync(child);
  } catch {
    resolvedParent = resolve(parent);
    resolvedChild = resolve(child);
  }
  const rel = relative(resolvedParent, resolvedChild);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function resolveImplementArtifact(
  input: BuildImplementWorkflowStepsInput,
  resolvedSpecPath: string,
  match: ProjectMatch,
  externalPlanSpec?: true,
): { isIndexSpec: boolean; artifactPath?: string } | { error: string } {
  const isIndexSpec = basename(resolvedSpecPath) === "index.md";
  const artifactPath = isIndexSpec ? resolvedSpecPath : input.artifactPath;
  if (artifactPath === undefined) return { error: "Non-index spec requires --artifact" };
  const resolvedArtifactPath = isIndexSpec
    ? resolvedSpecPath
    : resolveExistingImplementPath("Artifact", resolve(input.cwd, artifactPath));
  if (typeof resolvedArtifactPath === "object") return resolvedArtifactPath;
  if (input.preflightGitRoot !== undefined) {
    if (!insideResolvedPath(input.preflightGitRoot, resolvedArtifactPath)) {
      return { error: `Artifact path outside chained worktree: ${resolvedArtifactPath}` };
    }
  } else if (
    externalPlanSpec !== true &&
    findProjectMatch(resolvedArtifactPath, { [match.key]: { root: match.root } }) === undefined
  ) {
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

/**
 * Pipeline-chained launch: the spec tree lives on the prior stage's worktree, so the spec read root
 * and spec-availability preflight run against `preflightGitRoot` / `preflightBaseRef` rather than
 * publication `baseRef` or the registered project root.
 */
async function resolveChainedImplementLaunch(
  input: BuildImplementWorkflowStepsInput,
  deps: BuildImplementWorkflowStepsDeps,
  specReadRoot: string,
  runner: AsyncSubprocessRunner,
): Promise<BuildImplementWorkflowStepsInput | { error: string }> {
  const resolveProjectMatch =
    deps.resolveProjectMatch ??
    ((p: string) => findProjectMatch(p, readProjectRegistry(input.configPath ?? deps.configPath)));
  const match =
    input.projectRoot !== undefined
      ? { key: input.projectName ?? "", root: input.projectRoot }
      : resolveProjectMatch(input.cwd);
  if (match === undefined) {
    return { error: `No registered project matches cwd: ${input.cwd}` };
  }
  const resolvedSpecPath = resolveExistingImplementPath("Spec", resolve(specReadRoot, input.specPath));
  if (typeof resolvedSpecPath === "object") return resolvedSpecPath;
  const artifact = resolveImplementArtifact({ ...input, cwd: specReadRoot }, resolvedSpecPath, match);
  if ("error" in artifact) return artifact;
  const reviewConfig = resolveImplementReviewConfig(input, match, input.configPath ?? deps.configPath);
  if ("error" in reviewConfig) return reviewConfig;
  const registry =
    input.projectRegistry ??
    (deps.readProjectRegistry ?? (() => readProjectRegistry(input.configPath ?? deps.configPath)))();
  const externalIdentity = resolveExternalPlanSpecIdentity(
    resolvedSpecPath,
    registry,
    input.configPath ?? deps.configPath ?? MACHINE_CONFIG_PATH,
  );
  if (externalIdentity !== undefined) {
    if ("error" in externalIdentity) return externalIdentity;
    const { preflightGitRoot: _preflightGitRoot, preflightBaseRef: _preflightBaseRef, ...chainedInput } = input;
    return {
      ...chainedInput,
      branchName: input.branchName ?? basename(dirname(resolvedSpecPath)),
      specPath: externalIdentity.absoluteSpecPath,
      projectRoot: externalIdentity.projectRoot,
      projectName: externalIdentity.project,
      absoluteSpecPath: externalIdentity.absoluteSpecPath,
      externalPlanSpec: true,
      ...(externalIdentity.specReadRoot !== undefined ? { specReadRoot: externalIdentity.specReadRoot } : {}),
      ...(artifact.isIndexSpec ? {} : { artifactPath: artifact.artifactPath }),
      reviewPasses: reviewConfig.reviewPasses,
      reviewBehavior: reviewConfig.reviewBehavior,
    };
  }
  const preflightBaseRef = input.preflightBaseRef ?? input.baseRef;
  if (!(await isSpecAvailableInBaseRef(specReadRoot, preflightBaseRef, input.specPath, runner))) {
    return { error: `Spec path unavailable in base ref ${preflightBaseRef}: ${input.specPath}` };
  }
  return {
    ...input,
    branchName: input.branchName ?? basename(dirname(resolvedSpecPath)),
    specPath: input.specPath,
    projectRoot: match.root,
    projectName: match.key,
    ...(artifact.isIndexSpec ? {} : { artifactPath: artifact.artifactPath }),
    reviewPasses: reviewConfig.reviewPasses,
    reviewBehavior: reviewConfig.reviewBehavior,
  };
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: external-plan admission adds base-ref-bypass and specPath branches; extraction would fragment the reviewed launch flow
async function resolveImplementLaunch(
  input: BuildImplementWorkflowStepsInput,
  deps: BuildImplementWorkflowStepsDeps,
): Promise<ResolvedImplementLaunch | { error: string }> {
  const runner = deps.asyncSubprocessRunner ?? realAsyncSubprocessRunner;
  const skipPreflight =
    (input.projectRoot !== undefined || deps.resolveProjectMatch !== undefined) && input.preflightGitRoot === undefined;
  if (skipPreflight) {
    return {
      ...input,
      ...(input.projectRoot !== undefined
        ? {
            branchName:
              input.branchName ??
              basename(
                dirname(isAbsolute(input.specPath) ? input.specPath : resolve(input.projectRoot, input.specPath)),
              ),
          }
        : {}),
      reviewPasses: input.reviewPasses ?? 1,
    };
  }

  if (input.preflightGitRoot !== undefined) {
    return await resolveChainedImplementLaunch(input, deps, input.preflightGitRoot, runner);
  }

  const registry =
    input.projectRegistry ??
    (deps.readProjectRegistry ?? (() => readProjectRegistry(input.configPath ?? deps.configPath)))();
  const identity = resolveImplementSpecIdentity(
    input.cwd,
    input.specPath,
    registry,
    input.configPath ?? deps.configPath,
  );
  if ("error" in identity) return identity;
  const match = { key: identity.project, root: identity.projectRoot };
  const resolvedSpecPath = identity.absoluteSpecPath;
  const specReadRoot = identity.specReadRoot ?? identity.projectRoot;
  const externalPlanSpec = identity.externalPlanSpec === true ? (true as const) : undefined;
  const projectRelativeSpecPath = relative(match.root, resolvedSpecPath);
  const launchSpecPath = externalPlanSpec === true ? resolvedSpecPath : projectRelativeSpecPath;

  const artifact = resolveImplementArtifact(input, resolvedSpecPath, match, externalPlanSpec);
  if ("error" in artifact) return artifact;

  const reviewConfig = resolveImplementReviewConfig(input, match, input.configPath ?? deps.configPath);
  if ("error" in reviewConfig) return reviewConfig;

  if (
    externalPlanSpec !== true &&
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
    specPath: launchSpecPath,
    projectRoot: match.root,
    projectName: match.key,
    absoluteSpecPath: resolvedSpecPath,
    specReadRoot,
    ...(externalPlanSpec === true ? { externalPlanSpec } : {}),
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
  specReadRoot: string,
  resolveLinkedSubspec: NonNullable<BuildImplementWorkflowStepsDeps["resolveActiveLinkedSubspec"]>,
): { error: string } | undefined {
  if (!isIndexSpec) {
    return undefined;
  }
  const routingResult = resolveLinkedSubspec(absoluteSpecPath, specReadRoot);
  if (routingResult.ok || routingResult.errorKind === "empty_index" || routingResult.errorKind === "already_complete") {
    return undefined;
  }
  return { error: `implement.${routingResult.errorKind}: ${routingResult.error}` };
}

const ALREADY_COMPLETE_ERROR =
  "implement.already_complete: requested spec has no unchecked non-human-only acceptance criteria";

export function validateImplementSpecTreeCompletion(
  absoluteSpecPath: string,
  specReadRoot: string,
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
    return hasUncheckedNonHumanOnlyCriteria(specContent) ? undefined : ALREADY_COMPLETE_ERROR;
  }
  for (const subspec of linkedSubspecs) {
    const subspecPath = isAbsolute(subspec.path) ? subspec.path : resolve(dirname(absoluteSpecPath), subspec.path);
    if (!insideResolvedPath(specReadRoot, subspecPath)) {
      return `implement.link_out_of_tree: Linked path is outside project: ${subspec.path}`;
    }
    try {
      if (hasUncheckedNonHumanOnlyCriteria(readSpecFile(subspecPath))) return undefined;
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

function admitProjectPipeline(
  built: BuildImplementWorkflowStepsResult,
  input: BuildImplementWorkflowStepsInput,
  match: ProjectMatch,
  configPath: string | undefined,
): BuildImplementWorkflowStepsResult {
  if (!built.ok || input.projectRegistry === undefined) return built;
  if (built.steps[0]?.agentModelConfig === undefined) {
    return { ok: false, error: "invalid-pipeline-definition: loaded workflow has no agent model config" };
  }
  const project = readProjectConfigRecord(match.key, configPath ?? MACHINE_CONFIG_PATH);
  if (project === undefined) {
    return { ok: false, error: `projects.${match.key} must be an object` };
  }
  return built;
}

/** Build the implement preset workflow for cwd + run args. */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: external-plan preflight/completeness branches; kept inline to preserve the reviewed build sequence
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

  const specReadRoot = resolvedInput.specReadRoot ?? resolvedInput.preflightGitRoot ?? match.root;
  const absoluteSpecPath =
    resolvedInput.absoluteSpecPath ??
    (resolvedInput.preflightGitRoot !== undefined
      ? resolve(resolvedInput.cwd, resolvedInput.specPath)
      : resolve(match.root, resolvedInput.specPath));
  const isIndexSpec = basename(absoluteSpecPath) === "index.md";

  if (
    resolvedInput.externalPlanSpec === true ||
    deps.resolveActiveLinkedSubspec === undefined ||
    deps.readSpecFile !== undefined
  ) {
    const completionError = validateImplementSpecTreeCompletion(
      absoluteSpecPath,
      specReadRoot,
      deps.readSpecFile ?? ((path) => readFileSync(path, "utf8")),
    );
    if (completionError !== undefined) return { ok: false, error: completionError };
  }

  const chained = resolvedInput.preflightGitRoot !== undefined;
  const launchSpecPath = chained ? absoluteSpecPath : resolvedInput.specPath;
  const expectedArtifactPath = resolveImplementExpectedArtifactPath(
    isIndexSpec,
    launchSpecPath,
    resolvedInput.artifactPath,
  );
  if (typeof expectedArtifactPath === "object") return { ok: false, error: expectedArtifactPath.error };

  const routingError = validateLinkedIndexRouting(isIndexSpec, absoluteSpecPath, specReadRoot, resolveLinkedSubspec);
  if (routingError !== undefined) return { ok: false, error: routingError.error };

  const sourceStep: WriteWorkflowSourceStep = {
    behavior: "write",
    stepId: "implement",
    role: "implement",
    promptId: "patch.prompt.body",
    stepRules: IMPLEMENT_WRITE_STEP_RULES,
    worktree: {
      projectRoot: match.root,
      projectName: match.key,
      branchName: resolvedInput.branchName ?? "",
      baseRef: resolvedInput.baseRef,
    },
    specPath: launchSpecPath,
    expectedArtifactPath,
    linkedIndexRouting: isIndexSpec,
    ...(chained || resolvedInput.externalPlanSpec === true ? { specReadRoot } : {}),
    ...(resolvedInput.externalPlanSpec === true ? { externalPlanSpec: true as const } : {}),
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
  const verdictPath = join(
    dirname(isAbsolute(launchSpecPath) ? launchSpecPath : join(cwd, launchSpecPath)),
    "verdict-patch.md",
  );
  // Serializable: steps cross the daemon IPC boundary as JSON, which drops functions.
  // The review executors stamp passNumber/priorCycleVerdict per cycle.
  const profileContext = {
    specPath: launchSpecPath,
    cwd,
    ...(resolvedInput.externalPlanSpec === true ? { specReadRoot } : {}),
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
      ...(resolvedInput.externalPlanSpec === true ? { externalPlanSpec: true as const, specReadRoot } : {}),
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
    ...(resolvedInput.externalPlanSpec === true ? { externalPlanSpec: true as const, specReadRoot } : {}),
  };

  return admitProjectPipeline(
    loadImplementWorkflowSteps(loadSteps, [sourceStep, reviewStep], reviewPasses, reviewBehavior),
    resolvedInput,
    match,
    pipelineConfigPath,
  );
}
