import type { ResolvedAgentBinding } from "../shared/invocation/agents.ts";
import { routingRefusalReason } from "../shared/invocation/routing.ts";

/** Workflow-step roles: the closed subset a workflow source may declare and full-tool bindings serve. */
const EXECUTABLE_ROLES = [
  "plan",
  "implement",
  "shrink",
  "adversary",
  "critic",
  "advocate",
  "adjudicator",
  "actuator",
] as const;

type ExecutableRole = (typeof EXECUTABLE_ROLES)[number];

/** Tool-free free-text translation; resolved by `resolveRoutingBindings`, never by a workflow step. */
const ROUTING_ROLE = "routing";

type Role = ExecutableRole | typeof ROUTING_ROLE | "operator";
const executableRoleSet = new Set<string>(EXECUTABLE_ROLES);

type Model = {
  readonly adapterModel: string;
  readonly priceKey: string;
};

type ModelEscalation = {
  readonly rungs: readonly Model[];
};

type ModelsByRole = Partial<Record<Role, ModelEscalation>>;

export type AgentModelConfig = Record<string, ModelsByRole | undefined>;

/** Discriminates a machine-config load failure from a loaded `AgentModelConfig`. */
export function isLoadError(value: unknown): value is LoadError {
  return typeof value === "object" && value !== null && "errors" in value && Array.isArray((value as LoadError).errors);
}

export type LoadError = {
  readonly errors: readonly string[];
};

const ALL_ROLES: readonly Role[] = [...EXECUTABLE_ROLES, ROUTING_ROLE, "operator"];

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

/** Reject non-executable workflow-step roles before binding resolution; `routing` is reserved for the router. */
export function resolveExecutableRole(role: string): ExecutableRole {
  if (executableRoleSet.has(role)) {
    return role as ExecutableRole;
  }
  if (role === ROUTING_ROLE) {
    throw new Error(`workflow-step role '${role}' is reserved for the free-text router and is not a workflow step`);
  }

  throw new Error(`workflow-step role '${role}' is not executable`);
}

function rungBindings<T>(
  agentId: string,
  role: Role,
  config: AgentModelConfig,
  createBinding: (binding: ResolvedAgentBinding) => T,
): T[] {
  const escalation = config[agentId]?.[role];
  if (escalation === undefined) {
    throw new Error(`missing model escalation for agent '${agentId}' and role '${role}'`);
  }
  const rungCount = role === "actuator" ? 1 : escalation.rungs.length;
  const bindings: T[] = [];
  for (let i = 0; i < rungCount; i++) {
    const rung = escalation.rungs[i];
    if (rung === undefined) {
      throw new Error(`missing rung ${i} for agent '${agentId}' and role '${role}'`);
    }
    bindings.push(createBinding({ agentId, adapterModel: rung.adapterModel, priceKey: rung.priceKey }));
  }
  return bindings;
}

/** Resolve one flat shared-invocation binding list for one executable step role (full-tool bindings). */
export function resolveInvocationBindings<T>(
  role: ExecutableRole,
  agents: readonly string[],
  config: AgentModelConfig,
  createBinding: (binding: ResolvedAgentBinding) => T,
): readonly T[] {
  if ((role as string) === ROUTING_ROLE) {
    throw new Error(`role '${ROUTING_ROLE}' resolves tool-free bindings through resolveRoutingBindings only`);
  }
  return agents.flatMap((agentId) => rungBindings(agentId, role, config, createBinding));
}

type RoutingBindingResolution<T> = {
  bindings: readonly T[];
  /** Agents in the order skipped because they refuse the routing role, with why. */
  refused: readonly { agentId: string; reason: string }[];
};

/**
 * Resolve the tool-free routing binding list for an agent order: vendors that refuse the routing
 * role are skipped by name (recorded in `refused`), never degraded; an order with no routable vendor
 * throws naming every refusal.
 */
export function resolveRoutingBindings<T>(
  agents: readonly string[],
  config: AgentModelConfig,
  createBinding: (binding: ResolvedAgentBinding) => T,
): RoutingBindingResolution<T> {
  const refused: { agentId: string; reason: string }[] = [];
  const bindings: T[] = [];
  for (const agentId of agents) {
    const reason = routingRefusalReason(agentId);
    if (reason !== null) {
      refused.push({ agentId, reason });
      continue;
    }
    bindings.push(...rungBindings(agentId, ROUTING_ROLE, config, createBinding));
  }
  if (bindings.length === 0 && refused.length > 0) {
    throw new Error(
      `no agent in the order can run the routing role: ${refused.map((r) => `${r.agentId} (${r.reason})`).join("; ")}`,
    );
  }
  return { bindings, refused };
}

function validateRoles(agent: string, agentEntry: Record<string, unknown>, errors: string[]): ModelsByRole {
  const modelsByRole: ModelsByRole = {};

  for (const role of ALL_ROLES) {
    const required = role === ROUTING_ROLE ? routingRefusalReason(agent) === null : role !== "operator";
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
      validateRoles(agent, {}, errors);
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
