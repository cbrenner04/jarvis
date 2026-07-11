import { type AgentModelConfig, type LoadError, resolveExecutableRole } from "../config/agent-model-config.ts";
import { loadMachineConfig, resolveMachineProfile } from "../config/machine-config-loader.ts";
import { loadMachineProfileModels, type MachineProfileLoadOptions } from "../config/machine-profile-loader.ts";
import { type ReviewDebateWorkflowStep, validateWorkflowStepRoles, type WriteWorkflowStep } from "./workflow-runner.ts";
import { DEFAULT_WRITE_AGENTS } from "./write-loop-input.ts";

function isLoadError(value: unknown): value is LoadError {
  return typeof value === "object" && value !== null && "errors" in value && Array.isArray((value as LoadError).errors);
}

/** Authored write step minus config-derived `agents`/`agentModelConfig`. */
export type WriteWorkflowSourceStep = Omit<WriteWorkflowStep, "agents" | "agentModelConfig">;

/** Authored review-debate step minus config-derived `agents`/`agentModelConfig`. */
export type ReviewDebateWorkflowSourceStep = Omit<ReviewDebateWorkflowStep, "agents" | "agentModelConfig">;

/** Authored executable workflow step before machine configuration is attached. */
export type WorkflowSourceStep = WriteWorkflowSourceStep | ReviewDebateWorkflowSourceStep;

type LoadedWorkflowStep = WriteWorkflowStep | ReviewDebateWorkflowStep;

/** Test-only path overrides. */
type LoadWorkflowStepsDeps = {
  machineConfigPath?: string;
  machineProfile?: string;
  machinesDir?: MachineProfileLoadOptions["machinesDir"];
  loadAgentModelConfig?: (
    profileName: string,
    agents: readonly string[],
    opts: MachineProfileLoadOptions,
  ) => AgentModelConfig | LoadError;
};

/** Throws one aggregated error naming every step with an unrunnable role. */
export function loadWorkflowSteps(
  steps: readonly WriteWorkflowSourceStep[],
  deps?: LoadWorkflowStepsDeps,
): WriteWorkflowStep[];
export function loadWorkflowSteps(
  steps: readonly WorkflowSourceStep[],
  deps?: LoadWorkflowStepsDeps,
): LoadedWorkflowStep[];
export function loadWorkflowSteps(
  steps: readonly WorkflowSourceStep[],
  deps: LoadWorkflowStepsDeps = {},
): LoadedWorkflowStep[] {
  const agents = loadMachineConfig(deps.machineConfigPath) ?? DEFAULT_WRITE_AGENTS;

  const loadAgentModelConfig = deps.loadAgentModelConfig ?? loadMachineProfileModels;
  const loadResult = loadAgentModelConfig(deps.machineProfile ?? resolveMachineProfile(), agents, {
    machinesDir: deps.machinesDir,
  });
  if (isLoadError(loadResult)) {
    throw new Error(`Failed to load agent model config: ${loadResult.errors.join(", ")}`);
  }
  const agentModelConfig = loadResult;

  const invalidRoles: string[] = [];
  const resolvedSteps = steps.map((step) => {
    if (step.behavior === "write") {
      try {
        resolveExecutableRole(step.role);
      } catch {
        invalidRoles.push(`(${step.stepId}, ${step.role})`);
      }
      return { ...step, agents, agentModelConfig };
    }

    return {
      ...step,
      agents: {
        adversary: agents,
        advocate: agents,
        adjudicator: agents,
        actuator: agents,
      },
      agentModelConfig,
    };
  });
  if (invalidRoles.length > 0) {
    throw new Error(`Workflow step role validation failed: non-executable role ${invalidRoles.join(", ")}`);
  }

  validateWorkflowStepRoles(resolvedSteps);
  return resolvedSteps;
}
