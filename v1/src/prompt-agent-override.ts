import { AGENT_NAMES, isAgentName, type AgentName } from "./agent-order-validation.ts";
import { type AgentEntry, defaultAgentModel } from "./config.ts";

export type PromptAgentPin = {
  agent: AgentName;
  inlineModel?: string;
  cliModel?: string;
};

export type ParsePromptAgentFlagResult =
  | { ok: true; pin: PromptAgentPin }
  | { ok: false; message: string };

function splitPromptAgentFlagValue(value: string): { agent: string; inlineModel?: string } {
  const colonIndex = value.indexOf(":");
  if (colonIndex === -1) {
    return { agent: value };
  }
  return {
    agent: value.slice(0, colonIndex),
    inlineModel: value.slice(colonIndex + 1),
  };
}

export function parsePromptAgentFlagValue(value: string): ParsePromptAgentFlagResult {
  const { agent, inlineModel } = splitPromptAgentFlagValue(value);
  if (agent === "") {
    return { ok: false, message: `--agent: invalid value ${JSON.stringify(value)}` };
  }
  if (inlineModel !== undefined && inlineModel === "") {
    return { ok: false, message: `--agent: invalid value ${JSON.stringify(value)}` };
  }
  if (!isAgentName(agent)) {
    return {
      ok: false,
      message: `--agent ${JSON.stringify(value)}: unknown agent ${JSON.stringify(agent)} (allowed: ${AGENT_NAMES.join(", ")})`,
    };
  }
  const pin: PromptAgentPin = { agent };
  if (inlineModel !== undefined) {
    pin.inlineModel = inlineModel;
  }
  return { ok: true, pin };
}

function resolvePinnedModel(pin: PromptAgentPin, configAgentOrder: readonly AgentEntry[]): string {
  if (pin.inlineModel !== undefined) {
    return pin.inlineModel;
  }
  if (pin.cliModel !== undefined) {
    return pin.cliModel;
  }
  const configEntry = configAgentOrder.find((entry) => entry.agent === pin.agent);
  if (configEntry !== undefined) {
    return configEntry.model;
  }
  return defaultAgentModel(pin.agent);
}

export function buildEffectivePromptAgentEntries(
  pin: PromptAgentPin | undefined,
  configAgentOrder: readonly AgentEntry[],
): AgentEntry[] {
  const seen = new Set<AgentName>();
  const entries: AgentEntry[] = [];

  if (pin !== undefined) {
    entries.push({ agent: pin.agent, model: resolvePinnedModel(pin, configAgentOrder) });
    seen.add(pin.agent);
  }

  for (const entry of configAgentOrder) {
    if (!seen.has(entry.agent)) {
      entries.push(entry);
      seen.add(entry.agent);
    }
  }

  return entries;
}
