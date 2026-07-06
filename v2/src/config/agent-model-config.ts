import { readFileSync } from "node:fs";
import type { ResolvedAgentBinding } from "../../../shared/invocation/agents.ts";

const EXECUTABLE_ROLES = ["plan", "implement", "adversary", "advocate", "adjudicator", "actuator"] as const;

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

  if (rungs === undefined) {
    errors.push(`agent ${agent}, role ${role}: missing rungs`);
    return validRungs;
  }

  if (!isArray(rungs)) {
    errors.push(`agent ${agent}, role ${role}: rungs must be an array`);
    return validRungs;
  }

  if (rungs.length === 0) {
    errors.push(`agent ${agent}, role ${role}: rungs must not be empty`);
    return validRungs;
  }

  for (let i = 0; i < rungs.length; i++) {
    const rung = rungs[i];

    if (!isObject(rung)) {
      errors.push(`agent ${agent}, role ${role}, rung ${i}: value must be an object`);
      continue;
    }

    const adapterModel = rung.adapterModel;
    const priceKey = rung.priceKey;

    if (adapterModel === undefined) {
      errors.push(`agent ${agent}, role ${role}, rung ${i}: missing adapterModel`);
    } else if (!isString(adapterModel)) {
      errors.push(`agent ${agent}, role ${role}, rung ${i}: adapterModel must be a string`);
    }

    if (priceKey === undefined) {
      errors.push(`agent ${agent}, role ${role}, rung ${i}: missing priceKey`);
    } else if (!isString(priceKey)) {
      errors.push(`agent ${agent}, role ${role}, rung ${i}: priceKey must be a string`);
    }

    if (isString(adapterModel) && isString(priceKey)) {
      validRungs.push({ adapterModel, priceKey });
    }
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

function loadJsonFile(filePath: string, errors: string[]): unknown {
  try {
    const raw = readFileSync(filePath, "utf-8");
    return JSON.parse(raw);
  } catch (err) {
    if (err instanceof SyntaxError) {
      errors.push(`malformed JSON in ${filePath}: ${err.message}`);
    } else if (err instanceof Error && "code" in err && err.code === "ENOENT") {
      errors.push(`file not found: ${filePath}`);
    } else {
      errors.push(`failed to read ${filePath}: ${err instanceof Error ? err.message : String(err)}`);
    }
    return undefined;
  }
}

export function validateAgentModelConfig(jsonData: unknown, agents: readonly string[]): AgentModelConfig | LoadError {
  const errors: string[] = [];

  // Check for duplicate agent names
  const agentSet = new Set<string>();
  for (const agent of agents) {
    if (agentSet.has(agent)) {
      errors.push(`duplicate agent name: ${agent}`);
    }
    agentSet.add(agent);
  }

  // Check for object top level
  if (!isObject(jsonData)) {
    errors.push("config file must be a JSON object");
    return { errors };
  }

  const config: Record<string, ModelsByRole> = {};

  // Validate each project-configured agent
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

export function loadAgentModelConfig(filePath: string, agents: readonly string[]): AgentModelConfig | LoadError {
  const errors: string[] = [];

  const jsonData = loadJsonFile(filePath, errors);
  if (jsonData === undefined) {
    return { errors };
  }

  return validateAgentModelConfig(jsonData, agents);
}
