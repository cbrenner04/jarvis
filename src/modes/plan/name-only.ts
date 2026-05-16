import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ClaudeAgent } from "../../agents/claude.ts";
import { CodexAgent } from "../../agents/codex.ts";
import { CursorAgent } from "../../agents/cursor.ts";
import { OpencodeAgent } from "../../agents/opencode.ts";
import type { Agent, AgentResult } from "../../agents/types.ts";
import type { AgentName, Config } from "../../config.ts";
import { PlaceholderCollisionError } from "./draft.ts";

function createAgent(agentName: AgentName, model: string | undefined): Agent {
  switch (agentName) {
    case "claude":
      return new ClaudeAgent(model ? { model } : {});
    case "codex":
      return new CodexAgent(model ? { model } : {});
    case "cursor":
      return new CursorAgent(model ? { model } : {});
    case "opencode":
      if (!model) {
        throw new Error("opencode agent requires model to be configured");
      }
      return new OpencodeAgent({ model });
  }
}

export function buildNameOnlyPrompt(opts: {
  name: string;
  intent: string;
}): string {
  const collisionError = [opts.name, opts.intent].some(
    (value) => value.includes("<WORKDIR>") || value.includes("<NAME>"),
  );
  if (collisionError) {
    throw new PlaceholderCollisionError("intent", "template placeholder token");
  }

  const promptFile = join(import.meta.dir, "prompts", "name-only.md");
  let template = readFileSync(promptFile, "utf8");
  template = template.replaceAll("<WORKDIR>", opts.name);
  template = template.replaceAll("<NAME>", opts.name);
  template = template.replaceAll("<INTENT>", opts.intent);
  return template;
}

export async function runNameOnlyPhase(opts: {
  worktreePath: string;
  name: string;
  config: Config;
}): Promise<{ result: AgentResult; agentLabel: string | null }> {
  const intentPath = join(opts.worktreePath, "spec", opts.name, "intent.md");
  const intent = readFileSync(intentPath, "utf8");
  const prompt = buildNameOnlyPrompt({ name: opts.name, intent });

  const agentOrder = opts.config.modes.plan.agentOrder;
  let result: AgentResult | null = null;
  let agentLabel: string | null = null;
  for (const entry of agentOrder) {
    const agent = createAgent(entry.agent, entry.model);
    agentLabel =
      agent.attributionLabel?.() ??
      `${entry.agent} (${entry.model ?? "default"})`;
    result = await agent.run(prompt, { cwd: opts.worktreePath });
    if (result.kind === "ok") {
      return { result, agentLabel };
    }
    if (result.kind === "quota") {
      continue;
    }
    if (result.kind === "model_config") {
      return { result, agentLabel };
    }
  }

  if (result === null) {
    return {
      result: {
        kind: "error",
        exitCode: 2,
        stderr: "all agents exhausted (no result produced)",
      },
      agentLabel,
    };
  }
  return { result, agentLabel };
}
