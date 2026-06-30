import { agentHasPricedModels, resolveAgentPriceKey } from "./agents/price-keys.ts";
import type { AgentEntry } from "./config.ts";

export const AGENT_NAMES = ["claude", "codex", "cursor", "opencode"] as const;
export type AgentName = (typeof AGENT_NAMES)[number];

export function isAgentName(value: string): value is AgentName {
  return (AGENT_NAMES as readonly string[]).includes(value);
}

/** Same contract as config `validateAgentOrder` for parsed entries. */
export function validateAgentOrderEntries(entries: readonly AgentEntry[], fieldName: string): string | null {
  if (entries.length === 0) {
    return `${fieldName} must be a non-empty array`;
  }
  const seen = new Set<string>();
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    if (!isAgentName(entry.agent)) {
      return `${fieldName}[${i}].agent: unknown agent ${JSON.stringify(entry.agent)} (allowed: ${AGENT_NAMES.join(", ")})`;
    }
    if (entry.model.trim() === "") {
      return `${fieldName}[${i}].model must be a non-empty string`;
    }
    if (seen.has(entry.agent)) {
      return `${fieldName}: duplicate agent ${JSON.stringify(entry.agent)}`;
    }
    seen.add(entry.agent);
    if (agentHasPricedModels(entry.agent) && resolveAgentPriceKey(entry.agent, entry.model) === null) {
      return `${fieldName}[${i}].model: ${JSON.stringify(entry.model)} is not a known priced model for agent ${JSON.stringify(entry.agent)}`;
    }
  }
  return null;
}
