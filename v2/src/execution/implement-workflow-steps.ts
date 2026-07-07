import { findProjectMatchForPath } from "../../../v1/src/config.ts";
import { loadWorkflowSteps as realLoadWorkflowSteps, type WorkflowSourceStep } from "./workflow-loader.ts";
import { type AnyWorkflowStep, resolveWorkflowPreset } from "./workflow-runner.ts";
import { DEFAULT_WRITE_STEP_RULES } from "./write-loop-input.ts";

/** Per-run inputs the operator supplies alongside cwd project resolution. */
export type BuildImplementWorkflowStepsInput = {
  cwd: string;
  branchName: string;
  baseRef: string;
  specPath: string;
  artifactPath: string;
};

/** Test-only seams for project resolution and machine-config loading. */
export type BuildImplementWorkflowStepsDeps = {
  findProjectMatchForPath?: typeof findProjectMatchForPath;
  loadWorkflowSteps?: typeof realLoadWorkflowSteps;
};

export type BuildImplementWorkflowStepsResult =
  | { ok: true; steps: AnyWorkflowStep[] }
  | { ok: false; error: string };

/** Build the one-step `implement` preset workflow for cwd + run args. */
export function buildImplementWorkflowSteps(
  input: BuildImplementWorkflowStepsInput,
  deps: BuildImplementWorkflowStepsDeps = {},
): BuildImplementWorkflowStepsResult {
  const resolveProjectMatch = deps.findProjectMatchForPath ?? findProjectMatchForPath;
  const loadSteps = deps.loadWorkflowSteps ?? realLoadWorkflowSteps;

  const match = resolveProjectMatch(input.cwd);
  if (match === undefined) {
    return { ok: false, error: `No registered project matches cwd: ${input.cwd}` };
  }

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
    expectedArtifactPath: input.artifactPath,
  };

  try {
    const loadedSteps = loadSteps([sourceStep]);
    const steps = resolveWorkflowPreset("implement", loadedSteps);
    return { ok: true, steps };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
