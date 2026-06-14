import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createAgent as defaultCreateAgent } from "../../agents/factory.ts";
import { applyQuotaFallbackWhenAllowed } from "../../agents/quota.ts";
import type { Agent, AgentResult } from "../../agents/types.ts";
import type { AgentName, Config } from "../../config.ts";
import { HARNESS_ALL_AGENTS_QUOTA_EXHAUSTED } from "../../quota-harness-messages.ts";
import { emitPlanAgentQuotaFallback } from "./emit-plan-quota-stderr.ts";
import { readGitPorcelainSnapshot } from "./git-porcelain.ts";
import type { PlanTelemetryWriter } from "./plan-telemetry.ts";
import { renderTemplate, TemplateRenderingError } from "./template-renderer.ts";

export type IntentDraftSuccessAttempt = {
  agentCli: AgentName;
  configuredModel: string | undefined;
  durationMs: number;
};

export function buildIntentDraftPrompt(opts: { workdir: string; intentPath: string; seededIntent: string }): string {
  const promptFile = join(import.meta.dir, "..", "..", "..", "..", "prompts", "plan", "intent-draft.md");
  let template = readFileSync(promptFile, "utf8");

  try {
    template = renderTemplate(template, new Set(["WORKDIR", "INTENT_PATH", "SEEDED_INTENT"]), {
      WORKDIR: opts.workdir,
      INTENT_PATH: opts.intentPath,
      SEEDED_INTENT: opts.seededIntent,
    });
  } catch (err) {
    if (err instanceof TemplateRenderingError) {
      throw new Error(`intent-draft prompt configuration error: ${err.details}`);
    }
    throw err;
  }

  return template;
}

export async function runIntentDraftTurn(opts: {
  agentCwd: string;
  worktreePath: string;
  intentPath: string;
  seededIntent: string;
  config: Config;
  stderr?: (s: string) => void;
  planTelemetry?: PlanTelemetryWriter | undefined;
  createAgent?: (agentName: AgentName, model: string | undefined) => Agent;
  onOutboundPrompt?: (prompt: string) => void;
}): Promise<{ result: AgentResult; agentLabel: string | null; successAttempt?: IntentDraftSuccessAttempt }> {
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
    prompt = buildIntentDraftPrompt({
      workdir: opts.agentCwd,
      intentPath: opts.intentPath,
      seededIntent: opts.seededIntent,
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
    agentLabel = agent.attributionLabel?.() ?? `${entry.agent} (${entry.model})`;

    const porcelainBefore = readGitPorcelainSnapshot(opts.worktreePath);
    const invocationStartedAt = Date.now();
    const spawnResult = await agent.run(prompt, { cwd: opts.agentCwd });
    const durationMs = Date.now() - invocationStartedAt;
    const porcelainAfter = readGitPorcelainSnapshot(opts.worktreePath);
    const noDiskChangeDuringInvocation =
      porcelainBefore !== null && porcelainAfter !== null && porcelainBefore === porcelainAfter;
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
      return {
        result,
        agentLabel,
        successAttempt: {
          agentCli: entry.agent,
          configuredModel: entry.model,
          durationMs,
        },
      };
    }

    opts.planTelemetry?.recordAgentAttempt({
      phase: "intent",
      agentCli: entry.agent,
      configuredModel: entry.model,
      durationMs,
      result,
    });

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
