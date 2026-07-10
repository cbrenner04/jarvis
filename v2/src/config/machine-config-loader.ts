import { readFileSync } from "node:fs";
import type { ProjectRegistryEntry } from "../../../shared/project-registry.ts";
import { MACHINE_CONFIG_PATH } from "../paths.ts";

export function readMachineConfigDocument(
  configPath: string = MACHINE_CONFIG_PATH,
): Record<string, unknown> | undefined {
  const parsed = readMachineConfigFile(configPath);
  if (parsed === undefined) return undefined;

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(
      `Machine config at ${configPath} must be a JSON object, got ${
        Array.isArray(parsed) ? "array" : parsed === null ? "null" : typeof parsed
      }`,
    );
  }

  if ("agents" in parsed) {
    validateMachineConfigAgents((parsed as Record<string, unknown>).agents);
  }

  return parsed as Record<string, unknown>;
}

export function validateMachineConfigAgents(agents: unknown): string[] {
  if (!Array.isArray(agents)) {
    throw new Error(`Machine config 'agents' must be an array, got ${typeof agents}`);
  }

  if (agents.length === 0) {
    throw new Error("Machine config 'agents' array must not be empty");
  }

  const seenAgents = new Set<string>();
  for (let i = 0; i < agents.length; i++) {
    const agent = agents[i];
    if (typeof agent !== "string") {
      throw new Error(`Machine config 'agents' entry at index ${i} must be a string, got ${typeof agent}`);
    }
    if (agent === "") {
      throw new Error(`Machine config 'agents' entry at index ${i} must not be an empty string`);
    }
    if (seenAgents.has(agent)) {
      throw new Error(`Machine config 'agents' contains duplicate entry: "${agent}"`);
    }
    seenAgents.add(agent);
  }

  return agents;
}

export function loadMachineConfig(configPath: string = MACHINE_CONFIG_PATH): string[] | undefined {
  const parsed = readMachineConfigDocument(configPath);
  if (parsed === undefined || !("agents" in parsed)) {
    return undefined;
  }

  return parsed.agents as string[];
}

export function readProjectRegistry(configPath: string = MACHINE_CONFIG_PATH): Record<string, ProjectRegistryEntry> {
  const parsed = readMachineConfigDocument(configPath);
  const projects = parsed?.projects;
  if (typeof projects !== "object" || projects === null || Array.isArray(projects)) {
    return {};
  }

  const registry: Record<string, ProjectRegistryEntry> = {};
  for (const [key, value] of Object.entries(projects)) {
    if (typeof value !== "object" || value === null) continue;
    const root = (value as Record<string, unknown>).root;
    if (typeof root !== "string" || root === "") continue;
    const origin = (value as Record<string, unknown>).origin;
    registry[key] = typeof origin === "string" ? { root, origin } : { root };
  }
  return registry;
}

export function resolveMachineProfile(configPath: string = MACHINE_CONFIG_PATH): string {
  const parsed = readMachineConfigDocument(configPath);
  const machineProfile = parsed?.machineProfile;

  if (typeof machineProfile !== "string" || machineProfile === "") {
    throw new Error(`Machine config at ${configPath} is missing required 'machineProfile' key`);
  }

  return machineProfile;
}

function readMachineConfigFile(configPath: string): unknown {
  let content: string;
  try {
    content = readFileSync(configPath, "utf8");
  } catch (err: unknown) {
    if (typeof err === "object" && err !== null && "code" in err && err.code === "ENOENT") {
      return undefined;
    }
    throw err;
  }

  try {
    return JSON.parse(content);
  } catch {
    throw new Error(`Failed to parse machine config at ${configPath}: invalid JSON`);
  }
}
