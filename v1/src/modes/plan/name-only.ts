import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createAgent } from "../../agents/factory.ts";
import { applyQuotaFallbackWhenAllowed } from "../../agents/quota.ts";
import type { AgentResult } from "../../agents/types.ts";
import type { Config } from "../../config.ts";
import { HARNESS_ALL_AGENTS_QUOTA_EXHAUSTED } from "../../quota-harness-messages.ts";
import { PlaceholderCollisionError } from "./draft.ts";
import { emitPlanAgentQuotaFallback } from "./emit-plan-quota-stderr.ts";
import { readGitPorcelainSnapshot } from "./git-porcelain.ts";
import type { PlanTelemetryWriter } from "./plan-telemetry.ts";

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
  stderr?: (s: string) => void;
  planTelemetry?: PlanTelemetryWriter | undefined;
  /**
   * For no-commit specs, the external spec root where the spec is stored.
   * If provided, spec reads/writes happen here instead of under worktreePath/spec/.
   */
  externalSpecRoot?: string;
  /** Committed spec root (defaults to "spec" for backwards compatibility). */
  targetDir?: string;
}): Promise<{ result: AgentResult; agentLabel: string | null }> {
  const targetDir = opts.targetDir ?? "spec";
  const intentPath = opts.externalSpecRoot
    ? join(opts.externalSpecRoot, opts.name, "intent.md")
    : join(opts.worktreePath, targetDir, opts.name, "intent.md");
  const intent = readFileSync(intentPath, "utf8");
  const prompt = buildNameOnlyPrompt({ name: opts.name, intent });

  const agentOrder = opts.config.modes.plan.agentOrder;
  let result: AgentResult | null = null;
  let agentLabel: string | null = null;
  for (const entry of agentOrder) {
    const agent = createAgent(entry.agent, entry.model);
    agentLabel =
      agent.attributionLabel?.() ?? `${entry.agent} (${entry.model})`;
    const porcelainBefore = readGitPorcelainSnapshot(opts.worktreePath);
    const invocationStartedAt = Date.now();
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
    opts.planTelemetry?.recordAgentAttempt({
      phase: "name-only",
      agentCli: entry.agent,
      configuredModel: entry.model,
      durationMs: Date.now() - invocationStartedAt,
      result,
    });
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
