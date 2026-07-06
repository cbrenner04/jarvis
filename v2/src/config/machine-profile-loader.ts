import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type AgentModelConfig, type LoadError, validateAgentModelConfig } from "./agent-model-config.ts";

export const DEFAULT_SETTLE_DELAY_MS = 2000;

function validateMachineConfigMemory(memory: unknown): { minFreeGb: number | undefined; settleDelayMs: number } {
  if (typeof memory !== "object" || memory === null || Array.isArray(memory)) {
    throw new Error(
      `Machine config 'memory' must be an object, got ${Array.isArray(memory) ? "array" : memory === null ? "null" : typeof memory}`,
    );
  }

  let settleDelayMs = DEFAULT_SETTLE_DELAY_MS;
  if ("settleDelayMs" in memory) {
    const rawSettleDelayMs = (memory as Record<string, unknown>).settleDelayMs;
    if (typeof rawSettleDelayMs !== "number" || !Number.isInteger(rawSettleDelayMs) || rawSettleDelayMs <= 0) {
      throw new Error(`Machine config 'memory.settleDelayMs' must be a positive integer, got ${rawSettleDelayMs}`);
    }
    settleDelayMs = rawSettleDelayMs;
  }

  if (!("minFreeGb" in memory)) {
    return { minFreeGb: undefined, settleDelayMs };
  }

  const minFreeGb = (memory as Record<string, unknown>).minFreeGb;
  if (typeof minFreeGb !== "number" || !Number.isFinite(minFreeGb) || minFreeGb <= 0) {
    throw new Error(`Machine config 'memory.minFreeGb' must be a positive finite number, got ${minFreeGb}`);
  }

  return { minFreeGb, settleDelayMs };
}

function resolveProfilePath(profileName: string): string {
  return join(import.meta.dir, "..", "..", "..", "config", "machines", `${profileName}.json`);
}

function readMachineProfileDocument(profileName: string): Record<string, unknown> {
  const filePath = resolveProfilePath(profileName);

  let raw: string;
  try {
    raw = readFileSync(filePath, "utf-8");
  } catch (err) {
    throw new Error(`Machine profile '${profileName}' not found at ${filePath}`, { cause: err });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Machine profile '${profileName}' at ${filePath} is malformed JSON`, { cause: err });
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Machine profile '${profileName}' at ${filePath} must be a JSON object`);
  }

  return parsed as Record<string, unknown>;
}

export function loadMachineProfileModels(profileName: string, agents: readonly string[]): AgentModelConfig | LoadError {
  const document = readMachineProfileDocument(profileName);

  if (!("models" in document)) {
    return {
      errors: [
        `Machine profile '${profileName}' at ${resolveProfilePath(profileName)} is missing required 'models' key`,
      ],
    };
  }

  return validateAgentModelConfig(document.models, agents);
}

export function loadMachineProfileMemory(profileName: string): {
  minFreeGb: number | undefined;
  settleDelayMs: number;
} {
  const document = readMachineProfileDocument(profileName);

  if (!("memory" in document)) {
    return { minFreeGb: undefined, settleDelayMs: DEFAULT_SETTLE_DELAY_MS };
  }

  return validateMachineConfigMemory(document.memory);
}
