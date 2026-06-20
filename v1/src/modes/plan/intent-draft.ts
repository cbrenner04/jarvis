import { readFileSync } from "node:fs";
import { join } from "node:path";
import { executeWithQuotaFallback } from "../../../../shared/invocation/execute.ts";
import { createAgent as defaultCreateAgent } from "../../agents/factory.ts";
import type { Agent, AgentResult } from "../../agents/types.ts";
import type { Config } from "../../config.ts";
import { type AgentName } from "../../agents/types.ts";
import { HARNESS_ALL_AGENTS_QUOTA_EXHAUSTED } from "../../quota-harness-messages.ts";
import { buildPlanBindings } from "./plan-binding-factory.ts";
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

  // Capture porcelain state for classification guard
  let porcelainState = readGitPorcelainSnapshot(opts.worktreePath);
  let successAttempt: IntentDraftSuccessAttempt | undefined;

  const bindings = buildPlanBindings(
    {
      phase: "intent",
      createAgent: resolveAgent,
      quotaConfig: {
        quotaFallback: opts.config.quotaFallback,
        weakQuotaExitCodes: opts.config.weakQuotaExitCodes,
      },
      spawnOptions: {},
      ...(opts.stderr !== undefined ? { onRotationStderr: opts.stderr } : {}),
      onAttempt: (attempt) => {
        // Record telemetry only for non-ok results (matching original behavior)
        if (attempt.result.kind !== "ok") {
          opts.planTelemetry?.recordAgentAttempt(attempt);
        } else {
          // Capture success attempt info for return value
          successAttempt = {
            agentCli: attempt.agentCli,
            configuredModel: attempt.configuredModel,
            durationMs: attempt.durationMs,
          };
        }
      },
      classificationGuard: () => {
        const porcelainAfter = readGitPorcelainSnapshot(opts.worktreePath);
        const guard = porcelainState !== null && porcelainAfter !== null && porcelainState === porcelainAfter;
        porcelainState = porcelainAfter;
        return guard;
      },
    },
    agentOrder,
  );

  const execution = await executeWithQuotaFallback({
    prompt,
    cwd: opts.agentCwd,
    bindings,
  });

  if (execution.final === null) {
    return {
      result: {
        kind: "error",
        exitCode: 2,
        stderr: `${HARNESS_ALL_AGENTS_QUOTA_EXHAUSTED} (no agent invocations)`,
      },
      agentLabel: null,
    };
  }

  const result = execution.final.result;
  const finalAgentCli = execution.final.binding.id.split(":")[1] as AgentName;
  const finalEntry = agentOrder.find((e) => e.agent === finalAgentCli);
  const agentLabel = (() => {
    if (finalEntry) {
      const agent = resolveAgent(finalEntry.agent, finalEntry.model);
      return agent.attributionLabel?.() ?? `${finalEntry.agent} (${finalEntry.model})`;
    }
    return null;
  })();

  return {
    result,
    agentLabel,
    ...(successAttempt !== undefined ? { successAttempt } : {}),
  };
}
