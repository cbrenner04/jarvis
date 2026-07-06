import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type AgentModelConfig, type LoadError, validateAgentModelConfig } from "./agent-model-config.ts";
import { validateMachineConfigMemory } from "./machine-config-loader.ts";

export const DEFAULT_SETTLE_DELAY_MS = 2000;

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

export function loadMachineProfileModels(
  profileName: string,
  agents: readonly string[],
): AgentModelConfig | LoadError {
  const document = readMachineProfileDocument(profileName);
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
