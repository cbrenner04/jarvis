import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createAgent as defaultCreateAgent } from "../../agents/factory.ts";
import { applyQuotaFallbackWhenAllowed } from "../../agents/quota.ts";
import type { Agent, AgentResult } from "../../agents/types.ts";
import type { AgentName, Config } from "../../config.ts";
import { HARNESS_ALL_AGENTS_QUOTA_EXHAUSTED } from "../../quota-harness-messages.ts";
import { emitPlanAgentQuotaFallback } from "./emit-plan-quota-stderr.ts";
import { readGitPorcelainSnapshot } from "./git-porcelain.ts";
import { renderTemplate, TemplateRenderingError } from "./template-renderer.ts";

export function buildInlineDraftPrompt(opts: {
  workdir: string;
  intentPath: string;
  inlineIntent: string;
}): string {
  const promptFile = join(
    import.meta.dir,
    "..",
    "..",
    "..",
    "..",
    "prompts",
    "plan",
    "inline-draft.md",
  );
  let template = readFileSync(promptFile, "utf8");

  try {
    template = renderTemplate(
      template,
      new Set(["WORKDIR", "INTENT_PATH", "INLINE_INTENT"]),
      {
        WORKDIR: opts.workdir,
        INTENT_PATH: opts.intentPath,
        INLINE_INTENT: opts.inlineIntent,
      },
    );
  } catch (err) {
    if (err instanceof TemplateRenderingError) {
      throw new Error(
        `inline-draft prompt configuration error: ${err.details}`,
      );
    }
    throw err;
  }

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
  /** Logs the built prompt before invoking the agent (mirrors patch-mode outbound logging). */
  onOutboundPrompt?: (prompt: string) => void;
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
    if (err instanceof Error) {
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

  opts.onOutboundPrompt?.(prompt);

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
