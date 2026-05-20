import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createAgent as defaultCreateAgent } from "../../agents/factory.ts";
import { applyQuotaFallbackWhenAllowed } from "../../agents/quota.ts";
import type { Agent, AgentResult } from "../../agents/types.ts";
import type { AgentName, Config } from "../../config.ts";
import { HARNESS_ALL_AGENTS_QUOTA_EXHAUSTED } from "../../quota-harness-messages.ts";
import { emitPlanAgentQuotaFallback } from "./emit-plan-quota-stderr.ts";
import { readGitPorcelainSnapshot } from "./git-porcelain.ts";

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
  intentPath: string;
  config: Config;
  stderr?: (s: string) => void;
  /** For tests only; defaults to real CLI agents. */
  createAgent?: (agentName: AgentName, model: string | undefined) => Agent;
}): Promise<{ result: AgentResult; agentLabel: string | null }> {
  const agentOrder = opts.config.modes.plan.agentOrder;
  if (agentOrder.length === 0) {
    return {
      result: {
        kind: "model_config",
        stderr: "plan: modes.plan.agentOrder is empty",
      },
      agentLabel: null,
    };
  }

  let prompt: string;
  try {
    prompt = buildInlineDraftPrompt({
      workdir: opts.worktreePath,
      intentPath: opts.intentPath,
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

  const resolveAgent = opts.createAgent ?? defaultCreateAgent;
  let result: AgentResult | null = null;
  let agentLabel: string | null = null;

  for (const entry of agentOrder) {
    const agent = resolveAgent(entry.agent, entry.model);
    agentLabel =
      agent.attributionLabel?.() ?? `${entry.agent} (${entry.model})`;

    const porcelainBefore = readGitPorcelainSnapshot(opts.worktreePath);
    const spawnResult = await agent.run(prompt, { cwd: opts.worktreePath });
    const porcelainAfter = readGitPorcelainSnapshot(opts.worktreePath);
    const noDiskChangeDuringInvocation =
      porcelainBefore !== null &&
      porcelainAfter !== null &&
      porcelainBefore === porcelainAfter;
    result = applyQuotaFallbackWhenAllowed(
      entry.agent,
      spawnResult,
      {
        quotaFallback: opts.config.quotaFallback,
        weakQuotaExitCodes: opts.config.weakQuotaExitCodes,
      },
      noDiskChangeDuringInvocation,
    );
    emitPlanAgentQuotaFallback(opts.stderr, entry.agent, spawnResult, result);

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
        stderr: `${HARNESS_ALL_AGENTS_QUOTA_EXHAUSTED} (no agent invocations)`,
      },
      agentLabel,
    };
  }
  return { result, agentLabel };
}
