import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createAgent } from "../../agents/factory.ts";
import type { AgentResult } from "../../agents/types.ts";
import type { Config } from "../../config.ts";

class PlaceholderCollisionError extends Error {
  constructor(
    public field: string,
    public token: string,
  ) {
    super(
      `${field} contains the literal token \`${token}\`; this would corrupt the prompt`,
    );
    this.name = "PlaceholderCollisionError";
  }
}

const PLACEHOLDER_TOKENS = [
  "<WORKDIR>",
  "<INTENT_PATH>",
  "<INLINE_INTENT>",
  "<<<INLINE_INTENT_BEGIN>>>",
  "<<<INLINE_INTENT_END>>>",
];

function validatePlaceholders(
  values: Record<string, string>,
): PlaceholderCollisionError | null {
  for (const [field, value] of Object.entries(values)) {
    for (const token of PLACEHOLDER_TOKENS) {
      if (value.includes(token)) {
        return new PlaceholderCollisionError(field, token);
      }
    }
  }
  return null;
}

export function buildInlineDraftPrompt(opts: {
  workdir: string;
  intentPath: string;
  inlineIntent: string;
}): string {
  const collisionError = validatePlaceholders({
    workdir: opts.workdir,
    intentPath: opts.intentPath,
    inlineIntent: opts.inlineIntent,
  });
  if (collisionError !== null) {
    throw collisionError;
  }

  const promptFile = join(import.meta.dir, "prompts", "inline-draft.md");
  let template = readFileSync(promptFile, "utf8");
  template = template.replaceAll("<WORKDIR>", opts.workdir);
  template = template.replaceAll("<INTENT_PATH>", opts.intentPath);
  template = template.replaceAll("<INLINE_INTENT>", opts.inlineIntent);
  return template;
}

export async function runInlineDraftTurn(opts: {
  worktreePath: string;
  inlineIntent: string;
  config: Config;
}): Promise<{ result: AgentResult; agentLabel: string | null }> {
  const entry = opts.config.modes.plan.agentOrder[0];
  if (entry === undefined) {
    return {
      result: {
        kind: "model_config",
        stderr: "plan: modes.plan.agentOrder is empty",
      },
      agentLabel: null,
    };
  }

  const intentPath = join(opts.worktreePath, "intent.md");
  let prompt: string;
  try {
    prompt = buildInlineDraftPrompt({
      workdir: opts.worktreePath,
      intentPath,
      inlineIntent: opts.inlineIntent,
    });
  } catch (err) {
    if (err instanceof PlaceholderCollisionError) {
      return {
        result: {
          kind: "model_config",
          stderr: err.message,
        },
        agentLabel: null,
      };
    }
    throw err;
  }

  const agent = createAgent(entry.agent, entry.model);
  const agentLabel =
    agent.attributionLabel?.() ?? `${entry.agent} (${entry.model})`;
  const result = await agent.run(prompt, { cwd: opts.worktreePath });
  return { result, agentLabel };
}
