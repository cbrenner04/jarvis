import { type LoadError, resolveExecutableRole } from "../config/agent-model-config.ts";
import { loadMachineConfig, resolveMachineProfile } from "../config/machine-config-loader.ts";
import { loadMachineProfileModels, type MachineProfileLoadOptions } from "../config/machine-profile-loader.ts";
import { validateWorkflowStepRoles, type WriteWorkflowStep } from "./workflow-runner.ts";
import { DEFAULT_WRITE_AGENTS } from "./write-loop-input.ts";

function isLoadError(value: unknown): value is LoadError {
  return typeof value === "object" && value !== null && "errors" in value && Array.isArray((value as LoadError).errors);
}

/** Authored step: `WriteWorkflowStep` minus config-derived `agents`/`agentModelConfig`. */
export type WorkflowSourceStep = Omit<WriteWorkflowStep, "agents" | "agentModelConfig">;

/** Test-only path overrides. */
type LoadWorkflowStepsDeps = {
  machineConfigPath?: string;
  machineProfile?: string;
  machinesDir?: MachineProfileLoadOptions["machinesDir"];
};

/** Throws one aggregated error naming every step with an unrunnable role. */
export function loadWorkflowSteps(
  steps: readonly WorkflowSourceStep[],
  deps: LoadWorkflowStepsDeps = {},
): WriteWorkflowStep[] {
  const agents = loadMachineConfig(deps.machineConfigPath) ?? DEFAULT_WRITE_AGENTS;

  const loadResult = loadMachineProfileModels(deps.machineProfile ?? resolveMachineProfile(), agents, {
    machinesDir: deps.machinesDir,
  });
  if (isLoadError(loadResult)) {
    throw new Error(`Failed to load agent model config: ${loadResult.errors.join(", ")}`);
  }
  const agentModelConfig = loadResult;

  const invalidRoles: string[] = [];
  const resolvedSteps = steps.map((step) => {
    try {
      resolveExecutableRole(step.role);
    } catch {
      invalidRoles.push(`(${step.stepId}, ${step.role})`);
    }
    return { ...step, agents, agentModelConfig };
  });
  if (invalidRoles.length > 0) {
    throw new Error(`Workflow step role validation failed: non-executable role ${invalidRoles.join(", ")}`);
  }

  validateWorkflowStepRoles(resolvedSteps);
  return resolvedSteps;
}
