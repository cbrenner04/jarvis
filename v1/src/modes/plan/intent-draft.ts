import { readFileSync } from "node:fs";
import { join } from "node:path";
import { collapseToError, executeWithQuotaFallback } from "../../../../shared/invocation/execute.ts";
import { createAgent as defaultCreateAgent } from "../../agents/factory.ts";
import type { Agent, AgentResult } from "../../agents/types.ts";
import type { AgentName, Config } from "../../config.ts";
import { HARNESS_ALL_AGENTS_QUOTA_EXHAUSTED } from "../../quota-harness-messages.ts";
import { emitPlanAgentQuotaFallback } from "./emit-plan-quota-stderr.ts";
import { createPlanInvocationBinding } from "./plan-invocation-binding.ts";
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
  let lastAttemptData: { agentCli: AgentName; configuredModel: string | undefined; durationMs: number } | null = null;

  const bindings = agentOrder.map((entry) =>
    createPlanInvocationBinding({
      agentName: entry.agent,
      configuredModel: entry.model,
      createAgent: resolveAgent,
      config: opts.config,
      worktreePath: opts.worktreePath,
      onQuotaFallbackEmit: (agentName, spawnResult, classified) => {
        emitPlanAgentQuotaFallback(opts.stderr, agentName, spawnResult, classified);
      },
      recordAgentAttempt: (data) => {
        lastAttemptData = {
          agentCli: data.agentCli,
          configuredModel: data.configuredModel,
          durationMs: data.durationMs,
        };
        // Only record non-ok results (per original behavior)
        if (data.result.kind !== "ok") {
          opts.planTelemetry?.recordAgentAttempt({
            phase: "intent",
            agentCli: data.agentCli,
            configuredModel: data.configuredModel,
            durationMs: data.durationMs,
            result: data.result,
          });
        }
      },
    }),
  );

  const execution = await executeWithQuotaFallback({
    prompt,
    cwd: opts.agentCwd,
    bindings,
  });

  let agentLabel: string | null = null;
  if (execution.final?.binding) {
    const binding = execution.final.binding;
    agentLabel = binding.id;
  }

  const finalResult = execution.final?.result;
  if (finalResult?.kind === "ok" && lastAttemptData !== null) {
    return {
      result: finalResult,
      agentLabel,
      successAttempt: lastAttemptData,
    };
  }

  if (finalResult === undefined) {
    return {
      result: {
        kind: "error",
        exitCode: 2,
        stderr: `${HARNESS_ALL_AGENTS_QUOTA_EXHAUSTED} (no agent invocations)`,
      },
      agentLabel,
    };
  }

  return {
    result: collapseToError(finalResult),
    agentLabel,
  };
}
