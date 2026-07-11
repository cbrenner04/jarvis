import { basename, resolve } from "node:path";
import { findProjectMatch, type ProjectMatch } from "../../../shared/project-registry.ts";
import { readProjectRegistry } from "../config/machine-config-loader.ts";
import { resolveActiveLinkedSubspec as realResolveActiveLinkedSubspec } from "./linked-subspec-routing.ts";
import { loadWorkflowSteps as realLoadWorkflowSteps, type WriteWorkflowSourceStep } from "./workflow-loader.ts";
import { type AnyWorkflowStep, resolveWorkflowPreset, type WriteWorkflowStep } from "./workflow-runner.ts";
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
  loadWorkflowSteps?: (steps: readonly WriteWorkflowSourceStep[]) => WriteWorkflowStep[];
  resolveActiveLinkedSubspec?: (
    specPath: string,
    projectRoot: string,
  ) => ReturnType<typeof realResolveActiveLinkedSubspec>;
};

export type BuildImplementWorkflowStepsResult = { ok: true; steps: AnyWorkflowStep[] } | { ok: false; error: string };

/** Build the one-step `implement` preset workflow for cwd + run args. */
export function buildImplementWorkflowSteps(
  input: BuildImplementWorkflowStepsInput,
  deps: BuildImplementWorkflowStepsDeps = {},
): BuildImplementWorkflowStepsResult {
  const resolveProjectMatch = deps.resolveProjectMatch ?? ((p: string) => findProjectMatch(p, readProjectRegistry()));
  const loadSteps = deps.loadWorkflowSteps ?? realLoadWorkflowSteps;
  const resolveLinkedSubspec = deps.resolveActiveLinkedSubspec ?? realResolveActiveLinkedSubspec;

  // If projectRoot is provided, use it directly; otherwise resolve from cwd
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

  // Spec path may be worktree-relative (from CLI) or absolute (legacy)
  const absoluteSpecPath = resolve(match.root, input.specPath);
  const specFilename = basename(absoluteSpecPath);
  const isIndexSpec = specFilename === "index.md";

  // For artifact path, use provided value or default to spec for index specs
  let expectedArtifactPath: string;
  if (isIndexSpec) {
    expectedArtifactPath = input.specPath;
  } else if (input.artifactPath !== undefined) {
    expectedArtifactPath = input.artifactPath;
  } else {
    return { ok: false, error: "Non-index spec requires artifact path" };
  }

  // Resolve linked subspec if this is an index spec
  if (isIndexSpec) {
    const routingResult = resolveLinkedSubspec(absoluteSpecPath, match.root);
    if (!routingResult.ok) {
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

  try {
    const loadedSteps = loadSteps([sourceStep]);
    const steps = resolveWorkflowPreset("implement", loadedSteps);
    return { ok: true, steps };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
