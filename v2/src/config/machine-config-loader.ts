import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Parsed top-level machine config object from `~/.jarvis/v2.json`. */
export type MachineConfigDocument = Record<string, unknown>;

/** Read and validate the machine-config document when it exists. */
export function readMachineConfigDocument(
  configPath: string = join(homedir(), ".jarvis", "v2.json"),
): MachineConfigDocument | undefined {
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
    validateMachineConfigAgents((parsed as MachineConfigDocument).agents);
  }

  return parsed as MachineConfigDocument;
}

/** Validate the machine-config `agents` array contract and return it unchanged. */
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

/** Load the persisted machine fallback order from `~/.jarvis/v2.json`. */
export function loadMachineConfig(configPath: string = join(homedir(), ".jarvis", "v2.json")): string[] | undefined {
  const parsed = readMachineConfigDocument(configPath);
  if (parsed === undefined || !("agents" in parsed)) {
    return undefined;
  }

  return validateMachineConfigAgents(parsed.agents);
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
