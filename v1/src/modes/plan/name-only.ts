import { readFileSync } from "node:fs";
import { join } from "node:path";
import { collapseToError, executeWithQuotaFallback } from "../../../../shared/invocation/execute.ts";
import { createAgent } from "../../agents/factory.ts";
import type { AgentResult } from "../../agents/types.ts";
import type { Config } from "../../config.ts";
import { HARNESS_ALL_AGENTS_QUOTA_EXHAUSTED } from "../../quota-harness-messages.ts";
import { emitPlanAgentQuotaFallback } from "./emit-plan-quota-stderr.ts";
import { createPlanInvocationBinding } from "./plan-invocation-binding.ts";
import type { PlanTelemetryWriter } from "./plan-telemetry.ts";
import { renderTemplate, TemplateRenderingError } from "./template-renderer.ts";

export function buildNameOnlyPrompt(opts: { name: string; intent: string }): string {
  const promptFile = join(import.meta.dir, "..", "..", "..", "..", "prompts", "plan", "name-only.md");
  let template = readFileSync(promptFile, "utf8");

  try {
    template = renderTemplate(template, new Set(["WORKDIR", "NAME", "INTENT"]), {
      WORKDIR: opts.name,
      NAME: opts.name,
      INTENT: opts.intent,
    });
  } catch (err) {
    if (err instanceof TemplateRenderingError) {
      throw new Error(`name-only prompt configuration error: ${err.details}`);
    }
    throw err;
  }

  return template;
}

export async function runNameOnlyPhase(opts: {
  worktreePath: string;
  name: string;
  config: Config;
  stderr?: (s: string) => void;
  planTelemetry?: PlanTelemetryWriter | undefined;
  /**
   * For no-commit specs, the external spec root where the spec is stored.
   * If provided, spec reads/writes happen here instead of under worktreePath/spec/.
   */
  externalSpecRoot?: string;
  /** Committed spec root (defaults to "spec" for backwards compatibility). */
  targetDir?: string;
  /** Logs the built prompt before invoking the agent (mirrors patch-mode outbound logging). */
  onOutboundPrompt?: (prompt: string) => void;
}): Promise<{ result: AgentResult; agentLabel: string | null }> {
  const targetDir = opts.targetDir ?? "spec";
  const intentPath = opts.externalSpecRoot
    ? join(opts.externalSpecRoot, opts.name, "intent.md")
    : join(opts.worktreePath, targetDir, opts.name, "intent.md");
  const intent = readFileSync(intentPath, "utf8");
  const prompt = buildNameOnlyPrompt({ name: opts.name, intent });
  opts.onOutboundPrompt?.(prompt);

  const agentOrder = opts.config.modes.plan.agentOrder;
  if (agentOrder.length === 0) {
    return {
      result: {
        kind: "error",
        exitCode: 2,
        stderr: `${HARNESS_ALL_AGENTS_QUOTA_EXHAUSTED} (no agent invocations)`,
      },
      agentLabel: null,
    };
  }

  const bindings = agentOrder.map((entry) =>
    createPlanInvocationBinding({
      agentName: entry.agent,
      configuredModel: entry.model,
      createAgent,
      config: opts.config,
      worktreePath: opts.worktreePath,
      onQuotaFallbackEmit: (agentName, spawnResult, classified) => {
        emitPlanAgentQuotaFallback(opts.stderr, agentName, spawnResult, classified);
      },
      recordAgentAttempt: (data) => {
        opts.planTelemetry?.recordAgentAttempt({
          phase: "name-only",
          agentCli: data.agentCli,
          configuredModel: data.configuredModel,
          durationMs: data.durationMs,
          result: data.result,
        });
      },
      shouldAdvance: (result) => result.kind === "quota" || result.kind === "error" || result.kind === "model_config",
    }),
  );

  const execution = await executeWithQuotaFallback({
    prompt,
    cwd: opts.worktreePath,
    bindings,
  });

  let agentLabel: string | null = null;
  if (execution.final?.binding) {
    const binding = execution.final.binding;
    agentLabel = binding.id;
  }

  const finalResult = execution.final?.result;
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
