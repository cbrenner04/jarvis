import { basename, dirname, join, resolve } from "node:path";
import { findProjectMatch, type ProjectMatch } from "../../../shared/project-registry.ts";
import { readProjectRegistry } from "../config/machine-config-loader.ts";
import { getExternalWorktreePath } from "./external-worktree.ts";
import { resolveActiveLinkedSubspec as realResolveActiveLinkedSubspec } from "./linked-subspec-routing.ts";
import { PATCH_REVIEW_DEBATE_ROLE_PROMPT_IDS } from "./review-debate-render.ts";
import {
  loadWorkflowSteps as realLoadWorkflowSteps,
  type ReviewDebateWorkflowSourceStep,
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

  let match: ProjectMatch;
  if (input.projectRoot !== undefined) {
    match = { key: input.projectName ?? "", root: input.projectRoot };
  } else {
    const resolved = resolveProjectMatch(input.cwd);
    if (resolved === undefined) {
      return { ok: false, error: `No registered project matches cwd: ${input.cwd}` };
    }
    match = resolved;
  }

  const absoluteSpecPath = resolve(match.root, input.specPath);
  const specFilename = basename(absoluteSpecPath);
  const isIndexSpec = specFilename === "index.md";

  let expectedArtifactPath: string;
  if (isIndexSpec) {
    expectedArtifactPath = input.specPath;
  } else if (input.artifactPath !== undefined) {
    expectedArtifactPath = input.artifactPath;
  } else {
    return { ok: false, error: "Non-index spec requires artifact path" };
  }

  if (isIndexSpec) {
    const routingResult = resolveLinkedSubspec(absoluteSpecPath, match.root);
    if (
      !routingResult.ok &&
      routingResult.errorKind !== "empty_index" &&
      routingResult.errorKind !== "already_complete"
    ) {
      return {
        ok: false,
        error: `implement.${routingResult.errorKind}: ${routingResult.error}`,
      };
    }
  }

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
    try {
      const loadedSteps = loadSteps([sourceStep]).filter((step): step is WriteWorkflowStep => step.behavior === "write");
      const steps = resolveWorkflowPreset("implement", loadedSteps);
      return { ok: true, steps };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
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

  try {
    const loaded = loadSteps([sourceStep, reviewStep]);
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
