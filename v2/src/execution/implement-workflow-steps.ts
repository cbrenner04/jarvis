import { resolve } from "node:path";
import { findProjectMatch, type ProjectMatch } from "../../../shared/project-registry.ts";
import { readProjectRegistry } from "../config/machine-config-loader.ts";
import { resolveActiveLinkedSubspec as realResolveActiveLinkedSubspec } from "./linked-subspec-routing.ts";
import { loadWorkflowSteps as realLoadWorkflowSteps, type WorkflowSourceStep } from "./workflow-loader.ts";
import { type AnyWorkflowStep, resolveWorkflowPreset } from "./workflow-runner.ts";
import { DEFAULT_WRITE_STEP_RULES } from "./write-loop-input.ts";

/** Per-run inputs the operator supplies alongside cwd project resolution. */
export type BuildImplementWorkflowStepsInput = {
  cwd: string;
  branchName: string;
  baseRef: string;
  specPath: string;
};

/** Test-only seams for project resolution and machine-config loading. */
export type BuildImplementWorkflowStepsDeps = {
  resolveProjectMatch?: (p: string) => ProjectMatch | undefined;
  loadWorkflowSteps?: typeof realLoadWorkflowSteps;
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

  const match = resolveProjectMatch(input.cwd);
  if (match === undefined) {
    return { ok: false, error: `No registered project matches cwd: ${input.cwd}` };
  }

  const resolvedSpecPath = resolve(input.specPath);
  const routingResult = resolveLinkedSubspec(resolvedSpecPath, match.root);
  if (!routingResult.ok) {
    return {
      ok: false,
      error: `implement.${routingResult.errorKind}: ${routingResult.error}`,
    };
  }

  const { active } = routingResult;
  const sourceStep: WorkflowSourceStep = {
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
    expectedArtifactPath: active.path,
    linkedIndexRouting: true,
  };

  try {
    const loadedSteps = loadSteps([sourceStep]);
    const steps = resolveWorkflowPreset("implement", loadedSteps);
    return { ok: true, steps };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
