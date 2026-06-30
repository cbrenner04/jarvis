import { AGENT_NAMES, type AgentName, isAgentName, validateAgentOrderEntries } from "./agent-order-validation.ts";
import { type AgentEntry, defaultAgentModel } from "./config.ts";

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

export function prefixAgentFlagError(mode: "run" | "plan" | "prompt", message: string): string {
  return `${mode}: ${message}`;
}

export type PromptAgentOverride = {
  agent: AgentName;
  model: string;
};

export function parsePromptAgentOverride(
  agentFlag: string,
  modelFlag: string | undefined,
  promptAgentOrder: readonly AgentEntry[],
): { ok: true; pinned: PromptAgentOverride } | { ok: false; message: string } {
  const { agent, model: inlineModel } = splitAgentFlagValue(agentFlag);
  if (agent === "") {
    return { ok: false, message: `${FIELD_NAME}: invalid value ${JSON.stringify(agentFlag)}` };
  }
  if (!isAgentName(agent)) {
    return {
      ok: false,
      message: `${FIELD_NAME} ${JSON.stringify(agentFlag)}: unknown agent ${JSON.stringify(agent)} (allowed: ${AGENT_NAMES.join(", ")})`,
    };
  }

  let model: string;
  if (inlineModel !== undefined) {
    model = inlineModel;
  } else if (modelFlag !== undefined) {
    model = modelFlag;
  } else {
    const configEntry = promptAgentOrder.find((entry) => entry.agent === agent);
    model = configEntry?.model ?? defaultAgentModel(agent);
  }

  return { ok: true, pinned: { agent, model } };
}

export function buildEffectivePromptAgentEntries(
  pinned: PromptAgentOverride | undefined,
  promptAgentOrder: readonly AgentEntry[],
): AgentEntry[] {
  if (pinned === undefined) {
    return [...promptAgentOrder];
  }
  const entries: AgentEntry[] = [{ agent: pinned.agent, model: pinned.model }];
  for (const entry of promptAgentOrder) {
    if (entry.agent !== pinned.agent) {
      entries.push(entry);
    }
  }
  return entries;
}
