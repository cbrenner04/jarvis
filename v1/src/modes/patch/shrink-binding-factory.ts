import type { AgentRunOptions, AgentResult, Agent } from "../../agents/types.ts";
import type { AgentName, Config } from "../../config.ts";
import { applyQuotaFallbackWhenAllowed } from "../../agents/quota.ts";
import type { InvocationBinding, InvocationResult } from "../../../../shared/invocation/execute.ts";
import { HARNESS_QUOTA_FALLBACK_STRICT, harnessQuotaFallbackLenientLine } from "../../quota-harness-messages.ts";

export type ShrinkInvocationResult = InvocationResult & {
  durationMs?: number;
  agent?: Agent;
  attributionLabel?: string;
  spawnResultKind?: "ok" | "error" | "model_config" | "quota";
};

export type ShrinkRotationEmitter = (message: string) => void;

export type ShrinkBindingFactoryOptions = {
  cwd: string;
  config: Config;
  createAgent: (agentName: AgentName, model: string | undefined) => Agent;
  spawnOptions: Omit<AgentRunOptions, "cwd" | "signal">;
  onRotationStderr?: ShrinkRotationEmitter;
  onAttempt?: (attempt: {
    agent: AgentName;
    configuredModel: string | undefined;
    durationMs: number;
    result: AgentResult;
  }) => void;
  classificationGuard: () => boolean;
  now?: () => number;
};

/**
 * Build InvocationBindings for shrink phase, wrapping agent spawn and classification.
 * Each binding handles spawn, classification via guard, and returns enriched results.
 */
export function buildShrinkBindings(
  opts: ShrinkBindingFactoryOptions,
  agentOrder: readonly { agent: AgentName; model: string | undefined }[],
): InvocationBinding<ShrinkInvocationResult>[] {
  return agentOrder.map((entry) => ({
    id: `shrink:${entry.agent}:${entry.model ?? "default"}`,
    invoke: async (args: { prompt: string; cwd: string; signal?: AbortSignal }) => {
      const agent = opts.createAgent(entry.agent, entry.model);
      const now = opts.now ?? Date.now;
      const startedAt = now();
      const spawnResult = await agent.run(args.prompt, {
        ...opts.spawnOptions,
        cwd: args.cwd,
        ...(args.signal !== undefined ? { signal: args.signal } : {}),
      });

      const classificationGuard = opts.classificationGuard();
      const classified = applyQuotaFallbackWhenAllowed(
        entry.agent,
        spawnResult,
        {
          quotaFallback: opts.config.quotaFallback,
          weakQuotaExitCodes: opts.config.weakQuotaExitCodes,
        },
        classificationGuard,
      );

      const durationMs = Math.max(0, now() - startedAt);

      // Emit rotation message for quota results
      if (classified.kind === "quota" && opts.onRotationStderr) {
        if (spawnResult.kind === "quota") {
          // Strict quota
          opts.onRotationStderr(`${entry.agent}: ${HARNESS_QUOTA_FALLBACK_STRICT}\n`);
        } else if (spawnResult.kind === "error") {
          // Lenient probable-quota
          opts.onRotationStderr(`${entry.agent}: ${harnessQuotaFallbackLenientLine(spawnResult.exitCode)}\n`);
        }
      }

      opts.onAttempt?.({
        agent: entry.agent,
        configuredModel: entry.model,
        durationMs,
        result: classified,
      });

      // Return classified result with metadata for caller
      return {
        ...classified,
        durationMs,
        agent,
        attributionLabel: agent.attributionLabel(),
        spawnResultKind: spawnResult.kind,
      };
    },
  }));
}
