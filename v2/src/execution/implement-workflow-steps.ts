import { basename, dirname, join, resolve } from "node:path";
import { findProjectMatch, type ProjectMatch } from "../../../shared/project-registry.ts";
import { readProjectRegistry } from "../config/machine-config-loader.ts";
import { getExternalWorktreePath } from "./external-worktree.ts";
import { resolveActiveLinkedSubspec as realResolveActiveLinkedSubspec } from "./linked-subspec-routing.ts";
import { PATCH_REVIEW_DEBATE_ROLE_PROMPT_IDS } from "./review-debate-render.ts";
import {
  type ReviewDebateWorkflowSourceStep,
  loadWorkflowSteps as realLoadWorkflowSteps,
  type WorkflowSourceStep,
  type WriteWorkflowSourceStep,
} from "./workflow-loader.ts";
import {
  type AnyWorkflowStep,
  type ReviewDebateWorkflowStep,
  resolveWorkflowPreset,
  type WriteWorkflowStep,
} from "./workflow-runner.ts";
import { DEFAULT_WRITE_STEP_RULES } from "./write-loop-input.ts";

/** Per-run inputs the operator supplies alongside cwd project resolution. */
export type BuildImplementWorkflowStepsInput = {
  cwd: string;
  branchName: string;
  baseRef: string;
  specPath: string;
  artifactPath?: string;
  projectRoot?: string;
  projectName?: string;
  reviewPasses: number;
};

/** Test-only seams for project resolution and machine-config loading. */
export type BuildImplementWorkflowStepsDeps = {
  resolveProjectMatch?: (p: string) => ProjectMatch | undefined;
  loadWorkflowSteps?: (steps: readonly WorkflowSourceStep[]) => AnyWorkflowStep[];
  resolveActiveLinkedSubspec?: (
    specPath: string,
    projectRoot: string,
  ) => ReturnType<typeof realResolveActiveLinkedSubspec>;
};

export type BuildImplementWorkflowStepsResult = { ok: true; steps: AnyWorkflowStep[] } | { ok: false; error: string };

function resolveImplementReviewPasses(reviewPasses: number): number | { error: string } {
  if (!Number.isInteger(reviewPasses) || reviewPasses < 0) {
    return { error: "implement: reviewPasses must be a non-negative integer" };
  }
  return reviewPasses;
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

function loadImplementWorkflowSteps(
  loadSteps: NonNullable<BuildImplementWorkflowStepsDeps["loadWorkflowSteps"]>,
  sourceSteps: readonly WorkflowSourceStep[],
  reviewPasses: number,
): BuildImplementWorkflowStepsResult {
  try {
    if (reviewPasses === 0) {
      const loadedSteps = loadSteps(sourceSteps).filter((step): step is WriteWorkflowStep => step.behavior === "write");
      return { ok: true, steps: resolveWorkflowPreset("implement", loadedSteps) };
    }

    const loaded = loadSteps(sourceSteps);
    const writeSteps = loaded.filter((step): step is WriteWorkflowStep => step.behavior === "write");
    const debateStep = loaded.find((step): step is ReviewDebateWorkflowStep => step.behavior === "review-debate");
    if (debateStep === undefined) {
      return { ok: false, error: "implement: review-debate step was not loaded" };
    }
    return { ok: true, steps: [...resolveWorkflowPreset("implement", writeSteps), debateStep] };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Build the implement preset workflow for cwd + run args. */
export function buildImplementWorkflowSteps(
  input: BuildImplementWorkflowStepsInput,
  deps: BuildImplementWorkflowStepsDeps = {},
): BuildImplementWorkflowStepsResult {
  const reviewPasses = resolveImplementReviewPasses(input.reviewPasses);
  if (typeof reviewPasses === "object") return { ok: false, error: reviewPasses.error };

  const resolveProjectMatch = deps.resolveProjectMatch ?? ((p: string) => findProjectMatch(p, readProjectRegistry()));
  const loadSteps = deps.loadWorkflowSteps ?? realLoadWorkflowSteps;
  const resolveLinkedSubspec = deps.resolveActiveLinkedSubspec ?? realResolveActiveLinkedSubspec;

  const match = resolveImplementProjectMatch(input, resolveProjectMatch);
  if ("error" in match) return { ok: false, error: match.error };

  const absoluteSpecPath = resolve(match.root, input.specPath);
  const isIndexSpec = basename(absoluteSpecPath) === "index.md";

  const expectedArtifactPath = resolveImplementExpectedArtifactPath(isIndexSpec, input.specPath, input.artifactPath);
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
      branchName: input.branchName,
      baseRef: input.baseRef,
    },
    specPath: input.specPath,
    expectedArtifactPath,
    linkedIndexRouting: isIndexSpec,
  };

  if (reviewPasses === 0) {
    return loadImplementWorkflowSteps(loadSteps, [sourceStep], reviewPasses);
  }

  const cwd = getExternalWorktreePath(sourceStep.worktree);
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
    verdictPath: join(cwd, dirname(input.specPath), "verdict-patch.md"),
    maxCycles: reviewPasses,
    patchReviewContext: {
      specPath: input.specPath,
      baseBranch: input.baseRef,
    },
  };

  return loadImplementWorkflowSteps(loadSteps, [sourceStep, reviewStep], reviewPasses);
}
