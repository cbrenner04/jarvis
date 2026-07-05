import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export function readMachineConfigDocument(
  configPath: string = join(homedir(), ".jarvis", "v2.json"),
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

  if ("memory" in parsed) {
    validateMachineConfigMemory((parsed as Record<string, unknown>).memory);
  }

  return parsed as Record<string, unknown>;
}

export function validateMachineConfigMemory(memory: unknown): { minFreeGb: number; settleDelayMs: number } | undefined {
  if (typeof memory !== "object" || memory === null || Array.isArray(memory)) {
    throw new Error(
      `Machine config 'memory' must be an object, got ${Array.isArray(memory) ? "array" : memory === null ? "null" : typeof memory}`,
    );
  }

  let settleDelayMs = 2000;
  if ("settleDelayMs" in memory) {
    const rawSettleDelayMs = (memory as Record<string, unknown>).settleDelayMs;
    if (typeof rawSettleDelayMs !== "number" || !Number.isInteger(rawSettleDelayMs) || rawSettleDelayMs <= 0) {
      throw new Error(`Machine config 'memory.settleDelayMs' must be a positive integer, got ${rawSettleDelayMs}`);
    }
    settleDelayMs = rawSettleDelayMs;
  }

  if (!("minFreeGb" in memory)) {
    return undefined;
  }

  const minFreeGb = (memory as Record<string, unknown>).minFreeGb;
  if (typeof minFreeGb !== "number" || !Number.isFinite(minFreeGb) || minFreeGb <= 0) {
    throw new Error(`Machine config 'memory.minFreeGb' must be a positive finite number, got ${minFreeGb}`);
  }

  return { minFreeGb, settleDelayMs };
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

export function loadMachineConfig(configPath: string = join(homedir(), ".jarvis", "v2.json")): string[] | undefined {
  const parsed = readMachineConfigDocument(configPath);
  if (parsed === undefined || !("agents" in parsed)) {
    return undefined;
  }

  return parsed.agents as string[];
}

export function loadMachineConfigMemory(
  configPath: string = join(homedir(), ".jarvis", "v2.json"),
): { minFreeGb: number; settleDelayMs: number } | undefined {
  const parsed = readMachineConfigDocument(configPath);
  if (parsed === undefined || !("memory" in parsed)) {
    return undefined;
  }

  return validateMachineConfigMemory(parsed.memory);
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
