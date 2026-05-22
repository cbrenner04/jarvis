import { AIDER_HAS_PRICED_MODELS, resolveAiderPriceKey } from "./aider.ts";
import { CLAUDE_HAS_PRICED_MODELS, resolveClaudePriceKey } from "./claude.ts";
import { CODEX_HAS_PRICED_MODELS, resolveCodexPriceKey } from "./codex.ts";
import { CURSOR_HAS_PRICED_MODELS, resolveCursorPriceKey } from "./cursor.ts";
import {
  OPENCODE_HAS_PRICED_MODELS,
  resolveOpencodePriceKey,
} from "./opencode.ts";
import type { AgentName } from "./types.ts";

export function resolveAgentPriceKey(
  agent: AgentName,
  model: string | undefined,
): string | null {
  switch (agent) {
    case "claude":
      return resolveClaudePriceKey(model);
    case "codex":
      return resolveCodexPriceKey(model);
    case "cursor":
      return resolveCursorPriceKey(model);
    case "opencode":
      return resolveOpencodePriceKey(model);
    case "aider":
      return resolveAiderPriceKey(model);
  }
}

export function agentHasPricedModels(agent: AgentName): boolean {
  switch (agent) {
    case "claude":
      return CLAUDE_HAS_PRICED_MODELS;
    case "codex":
      return CODEX_HAS_PRICED_MODELS;
    case "cursor":
      return CURSOR_HAS_PRICED_MODELS;
    case "opencode":
      return OPENCODE_HAS_PRICED_MODELS;
    case "aider":
      return AIDER_HAS_PRICED_MODELS;
  }
}
