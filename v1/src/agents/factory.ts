import { AiderAgent } from "./aider.ts";
import { ClaudeAgent } from "./claude.ts";
import { CodexAgent } from "./codex.ts";
import { CursorAgent } from "./cursor.ts";
import { OpencodeAgent } from "./opencode.ts";
import type { Agent, AgentName } from "./types.ts";

export function createAgent(agentName: AgentName, model?: string): Agent {
  switch (agentName) {
    case "claude":
      return new ClaudeAgent(model !== undefined ? { model } : {});
    case "codex":
      return new CodexAgent(model !== undefined ? { model } : {});
    case "cursor":
      return new CursorAgent(model !== undefined ? { model } : {});
    case "opencode": {
      if (model === undefined) {
        throw new Error("opencode requires a model to be configured");
      }
      return new OpencodeAgent({ model });
    }
    case "aider": {
      if (model === undefined) {
        throw new Error("aider requires a model to be configured");
      }
      return new AiderAgent({ model });
    }
  }
}
