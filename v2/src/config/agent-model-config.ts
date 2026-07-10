import type { ResolvedAgentBinding } from "../../../shared/invocation/agents.ts";

const EXECUTABLE_ROLES = ["plan", "implement", "shrink", "adversary", "advocate", "adjudicator", "actuator"] as const;

/** Closed role subset that may reach shared invocation today. */
type ExecutableRole = (typeof EXECUTABLE_ROLES)[number];

type Role = ExecutableRole | "operator";
const executableRoleSet = new Set<string>(EXECUTABLE_ROLES);

export type Model = {
  readonly adapterModel: string;
  readonly priceKey: string;
};

export type ModelEscalation = {
  readonly rungs: readonly Model[];
};

export type ModelsByRole = Partial<Record<Role, ModelEscalation>>;

export type AgentModelConfig = Record<string, ModelsByRole | undefined>;

export type LoadError = {
  readonly errors: readonly string[];
};

const ALL_ROLES: readonly Role[] = [...EXECUTABLE_ROLES, "operator"];

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function validateRungs(agent: string, role: string, rungs: unknown, errors: string[]): Model[] {
  const validRungs: Model[] = [];

  if (!isArray(rungs) || rungs.length === 0) {
    errors.push(`agent ${agent}, role ${role}: rungs must be a non-empty array`);
    return validRungs;
  }

  for (let i = 0; i < rungs.length; i++) {
    const rung = rungs[i];

    if (!isObject(rung) || !isString(rung.adapterModel) || !isString(rung.priceKey)) {
      errors.push(`agent ${agent}, role ${role}, rung ${i}: expected { adapterModel: string, priceKey: string }`);
      continue;
    }

    validRungs.push({ adapterModel: rung.adapterModel, priceKey: rung.priceKey });
  }

  return validRungs;
}

/** Reject non-executable workflow-step roles before binding resolution. */
export function resolveExecutableRole(role: string): ExecutableRole {
  if (executableRoleSet.has(role)) {
    return role as ExecutableRole;
  }

  throw new Error(`workflow-step role '${role}' is not executable`);
}

/** Resolve one flat shared-invocation binding list for one executable step role. */
export function resolveInvocationBindings<T>(
  role: ExecutableRole,
  agents: readonly string[],
  config: AgentModelConfig,
  createBinding: (binding: ResolvedAgentBinding) => T,
): readonly T[] {
  const bindings: T[] = [];

  for (const agentId of agents) {
    const escalation = config[agentId]?.[role];
    if (escalation === undefined) {
      throw new Error(`missing model escalation for agent '${agentId}' and role '${role}'`);
    }

    const rungCount = role === "actuator" ? 1 : escalation.rungs.length;
    for (let i = 0; i < rungCount; i++) {
      const rung = escalation.rungs[i];
      if (rung === undefined) {
        throw new Error(`missing rung ${i} for agent '${agentId}' and role '${role}'`);
      }
      bindings.push(
        createBinding({
          agentId,
          adapterModel: rung.adapterModel,
          priceKey: rung.priceKey,
        }),
      );
    }
  }

  return bindings;
}

function validateRoles(agent: string, agentEntry: Record<string, unknown>, errors: string[]): ModelsByRole {
  const modelsByRole: ModelsByRole = {};

  for (const role of ALL_ROLES) {
    const required = role !== "operator";
    const roleEntry = agentEntry[role];

    if (roleEntry === undefined) {
      if (required) {
        errors.push(`agent ${agent}: missing required role ${role}`);
      }
      continue;
    }

    if (!isObject(roleEntry)) {
      errors.push(`agent ${agent}, role ${role}: value must be an object`);
      continue;
    }

    const validRungs = validateRungs(agent, role, roleEntry.rungs, errors);
    if (validRungs.length > 0) {
      modelsByRole[role] = { rungs: validRungs };
    }
  }

  return modelsByRole;
}

export function validateAgentModelConfig(jsonData: unknown, agents: readonly string[]): AgentModelConfig | LoadError {
  const errors: string[] = [];

  const agentSet = new Set<string>();
  for (const agent of agents) {
    if (agentSet.has(agent)) {
      errors.push(`duplicate agent name: ${agent}`);
    }
    agentSet.add(agent);
  }

  if (!isObject(jsonData)) {
    errors.push("config file must be a JSON object");
    return { errors };
  }

  const config: Record<string, ModelsByRole> = {};

  for (const agent of agents) {
    const agentEntry = jsonData[agent];

    if (agentEntry === undefined) {
      for (const role of EXECUTABLE_ROLES) {
        errors.push(`agent ${agent}: missing required role ${role}`);
      }
      continue;
    }

    if (!isObject(agentEntry)) {
      errors.push(`agent ${agent}: value must be an object`);
      continue;
    }

    config[agent] = validateRoles(agent, agentEntry, errors);
  }

  if (errors.length > 0) {
    return { errors };
  }

  return config;
}

