import { AiderAgent } from "./aider.ts";
import { ClaudeAgent } from "./claude.ts";
import { CodexAgent } from "./codex.ts";
import { CursorAgent } from "./cursor.ts";
import { OpencodeAgent } from "./opencode.ts";
import type { Agent, AgentName } from "./types.ts";

export type CreateAgentOptions = {
  claude?: {
    outputFormat?: "json" | "text";
  };
};

export function createAgent(
  agentName: AgentName,
  model: string,
  opts: CreateAgentOptions = {},
): Agent {
  switch (agentName) {
    case "claude":
      return new ClaudeAgent({
        model,
        ...(opts.claude?.outputFormat
          ? { outputFormat: opts.claude.outputFormat }
          : {}),
      });
    case "codex":
      return new CodexAgent({ model });
    case "cursor":
      return new CursorAgent({ model });
    case "opencode":
      return new OpencodeAgent({ model });
    case "aider":
      return new AiderAgent({ model });
  }
}
