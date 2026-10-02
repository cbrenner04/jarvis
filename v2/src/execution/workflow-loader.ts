import {
  type AgentModelConfig,
  isLoadError,
  type LoadError,
  resolveExecutableRole,
} from "../config/agent-model-config.ts";
import {
  loadMachineConfig,
  readProjectConfigOverrides,
  resolveMachineProfile,
} from "../config/machine-config-loader.ts";
import { loadMachineProfileModels, type MachineProfileLoadOptions } from "../config/machine-profile-loader.ts";
import {
  type ReviewDebateWorkflowStep,
  type ReviewWorkflowStep,
  validateWorkflowStepRoles,
  type WriteWorkflowStep,
} from "./workflow-runner.ts";
import { DEFAULT_WRITE_AGENTS } from "./write-loop-input.ts";

/** Authored write step minus config-derived `agents`/`agentModelConfig`. */
export type WriteWorkflowSourceStep = Omit<WriteWorkflowStep, "agents" | "agentModelConfig">;

/** Authored review step minus config-derived `agents`/`agentModelConfig`. */
export type ReviewWorkflowSourceStep = Omit<ReviewWorkflowStep, "agents" | "agentModelConfig">;

/** Authored review-debate step minus config-derived `agents`/`agentModelConfig`. */
export type ReviewDebateWorkflowSourceStep = Omit<ReviewDebateWorkflowStep, "agents" | "agentModelConfig">;

/** Authored executable workflow step before machine configuration is attached. */
export type WorkflowSourceStep = WriteWorkflowSourceStep | ReviewWorkflowSourceStep | ReviewDebateWorkflowSourceStep;

/** Executable workflow step with machine-derived agent bindings. */
export type LoadedWorkflowStep = WriteWorkflowStep | ReviewWorkflowStep | ReviewDebateWorkflowStep;

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
  const machineAgents = loadMachineConfig(deps.machineConfigPath) ?? DEFAULT_WRITE_AGENTS;
  const loadAgentModelConfig = deps.loadAgentModelConfig ?? loadMachineProfileModels;
  let machineProfile: string | undefined;
  const bindingsByOrder = new Map<string, { agents: readonly string[]; agentModelConfig: AgentModelConfig }>();
  // Resolved once per step's project; the loaded step (persisted in the workflow snapshot) carries the result.
  const bindingsFor = (projectName: string) => {
    const agents = readProjectConfigOverrides(projectName, deps.machineConfigPath).agents ?? machineAgents;
    const key = agents.join("\0");
    const cached = bindingsByOrder.get(key);
    if (cached !== undefined) return cached;
    machineProfile ??= deps.machineProfile ?? resolveMachineProfile(deps.machineConfigPath);
    const loadResult = loadAgentModelConfig(machineProfile, agents, { machinesDir: deps.machinesDir });
    if (isLoadError(loadResult)) {
      throw new Error(`Failed to load agent model config: ${loadResult.errors.join(", ")}`);
    }
    const bindings = { agents, agentModelConfig: loadResult };
    bindingsByOrder.set(key, bindings);
    return bindings;
  };

  const invalidRoles: string[] = [];
  const resolvedSteps = steps.map((step) => {
    const { agents, agentModelConfig } = bindingsFor(
      step.behavior === "write" ? step.worktree.projectName : step.project,
    );
    if (step.behavior === "write") {
      try {
        resolveExecutableRole(step.role);
      } catch {
        invalidRoles.push(`(${step.stepId}, ${step.role})`);
      }
      return { ...step, agents, agentModelConfig };
    }

    if (step.behavior === "review") {
      return { ...step, agents: { critic: agents, actuator: agents }, agentModelConfig };
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
