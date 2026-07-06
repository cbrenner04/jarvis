import { join } from "node:path";
import { type LoadError, loadAgentModelConfig, resolveExecutableRole } from "../config/agent-model-config.ts";
import { loadMachineConfig } from "../config/machine-config-loader.ts";
import { validateWorkflowStepRoles, type WriteWorkflowStep } from "./workflow-runner.ts";
import { DEFAULT_WRITE_AGENTS } from "./write-loop-input.ts";

const AGENT_MODEL_CONFIG_PATH = join(import.meta.dir, "..", "..", "..", "data", "agent-model-config.json");

function isLoadError(value: unknown): value is LoadError {
  return typeof value === "object" && value !== null && "errors" in value && Array.isArray((value as LoadError).errors);
}

/** Authored step: `WriteWorkflowStep` minus config-derived `agents`/`agentModelConfig`. */
export type WorkflowSourceStep = Omit<WriteWorkflowStep, "agents" | "agentModelConfig">;

/** Test-only path overrides. */
type LoadWorkflowStepsDeps = {
  machineConfigPath?: string;
  agentModelConfigPath?: string;
};

/** Throws one aggregated error naming every step with an unrunnable role. */
export function loadWorkflowSteps(
  steps: readonly WorkflowSourceStep[],
  deps: LoadWorkflowStepsDeps = {},
): WriteWorkflowStep[] {
  const agents = loadMachineConfig(deps.machineConfigPath) ?? DEFAULT_WRITE_AGENTS;

  const loadResult = loadAgentModelConfig(deps.agentModelConfigPath ?? AGENT_MODEL_CONFIG_PATH, agents);
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
