import { join } from "node:path";
import { type LoadError, loadAgentModelConfig, resolveExecutableRole } from "../config/agent-model-config.ts";
import { loadMachineConfig } from "../config/machine-config-loader.ts";
import { DEFAULT_WRITE_AGENTS } from "./write-loop-input.ts";
import { validateWorkflowStepRoles, type WorkflowStep } from "./workflow-runner.ts";

const AGENT_MODEL_CONFIG_PATH = join(import.meta.dir, "..", "..", "..", "data", "agent-model-config.json");

function isLoadError(value: unknown): value is LoadError {
  return typeof value === "object" && value !== null && "errors" in value && Array.isArray((value as LoadError).errors);
}

/** Authored workflow-source step: a `WorkflowStep` minus config-derived `agents`/`agentModelConfig`. */
export type WorkflowSourceStep = Omit<WorkflowStep, "agents" | "agentModelConfig">;

/** Path overrides for {@link loadWorkflowSteps}; test-only seam, absent in normal use. */
export type LoadWorkflowStepsDeps = {
  machineConfigPath?: string;
  agentModelConfigPath?: string;
};

/**
 * Assemble runnable `WorkflowStep`s from authored steps: attach the machine's
 * configured agent order (falling back to {@link DEFAULT_WRITE_AGENTS}) and the
 * global `AgentModelConfig` to every step, then validate every step role
 * resolves for every loaded agent before returning. Throws one aggregated
 * error naming every offending step/role if any step is unrunnable.
 */
export function loadWorkflowSteps(
  steps: readonly WorkflowSourceStep[],
  deps: LoadWorkflowStepsDeps = {},
): WorkflowStep[] {
  const agents = loadMachineConfig(deps.machineConfigPath) ?? DEFAULT_WRITE_AGENTS;

  const loadResult = loadAgentModelConfig(deps.agentModelConfigPath ?? AGENT_MODEL_CONFIG_PATH, agents);
  if (isLoadError(loadResult)) {
    throw new Error(`Failed to load agent model config: ${loadResult.errors.join(", ")}`);
  }
  const agentModelConfig = loadResult;

  const invalidRoles: string[] = [];
  for (const step of steps) {
    try {
      resolveExecutableRole(step.role);
    } catch {
      invalidRoles.push(`(${step.stepId}, ${step.role})`);
    }
  }
  if (invalidRoles.length > 0) {
    throw new Error(`Workflow step role validation failed: non-executable role ${invalidRoles.join(", ")}`);
  }

  const resolvedSteps = steps.map((step) => ({ ...step, agents, agentModelConfig }));
  validateWorkflowStepRoles(resolvedSteps);
  return resolvedSteps;
}
