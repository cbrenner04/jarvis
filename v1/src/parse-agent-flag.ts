import { AGENT_NAMES, isAgentName, validateAgentOrderEntries } from "./agent-order-validation.ts";
import type { AgentEntry } from "./config.ts";

export type ParseAgentFlagResult = { ok: true; agentOrder: AgentEntry[] } | { ok: false; message: string };

const FIELD_NAME = "--agent";

function splitAgentFlagValue(value: string): { agent: string; model?: string } {
  const colonIndex = value.indexOf(":");
  if (colonIndex === -1) {
    return { agent: value };
  }
  return {
    agent: value.slice(0, colonIndex),
    model: value.slice(colonIndex + 1),
  };
}

export function parseAgentFlagValues(
  values: readonly string[],
  fallbackAgentOrder: readonly AgentEntry[],
): ParseAgentFlagResult {
  const entries: AgentEntry[] = [];
  for (const rawValue of values) {
    const { agent, model } = splitAgentFlagValue(rawValue);
    if (agent === "") {
      return { ok: false, message: `${FIELD_NAME}: invalid value ${JSON.stringify(rawValue)}` };
    }
    if (!isAgentName(agent)) {
      return {
        ok: false,
        message: `${FIELD_NAME} ${JSON.stringify(rawValue)}: unknown agent ${JSON.stringify(agent)} (allowed: ${AGENT_NAMES.join(", ")})`,
      };
    }

    let resolvedModel: string;
    if (model === undefined) {
      const fallback = fallbackAgentOrder.find((entry) => entry.agent === agent);
      if (!fallback) {
        return { ok: false, message: `${FIELD_NAME} ${JSON.stringify(agent)} requires :model` };
      }
      resolvedModel = fallback.model;
    } else {
      resolvedModel = model;
    }

    entries.push({ agent, model: resolvedModel });
  }

  const validationError = validateAgentOrderEntries(entries, FIELD_NAME);
  if (validationError !== null) {
    return { ok: false, message: validationError };
  }
  return { ok: true, agentOrder: entries };
}

export function prefixAgentFlagError(mode: "run" | "plan" | "intent", message: string): string {
  return `${mode}: ${message}`;
}
