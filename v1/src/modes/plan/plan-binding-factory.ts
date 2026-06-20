import type { AgentRunOptions, AgentResult } from "../../agents/types.ts";
import type { AgentName, Config } from "../../config.ts";
import { applyQuotaFallbackWhenAllowed } from "../../agents/quota.ts";
import type { Agent } from "../../agents/types.ts";
import type { InvocationBinding } from "../../../../shared/invocation/execute.ts";
import { emitPlanAgentQuotaFallback } from "./emit-plan-quota-stderr.ts";

export type PlanBindingFactoryOptions<PhaseLabel extends string = string> = {
  phase: PhaseLabel;
  createAgent: (agentName: AgentName, model?: string) => Agent;
  quotaConfig: { quotaFallback: "strict" | "lenient"; weakQuotaExitCodes: readonly number[] };
  spawnOptions: Omit<AgentRunOptions, "cwd" | "signal">;
  onRotationStderr?: (s: string) => void;
  onAttempt?: (attempt: {
    phase: PhaseLabel;
    agentCli: AgentName;
    configuredModel: string | undefined;
    durationMs: number;
    result: AgentResult;
  }) => void;
  preSpawnHook?: () => void | Promise<void>;
  classificationGuard: () => boolean;
};

/**
 * Build InvocationBindings for a plan phase, wrapping agent spawn and classification.
 * Each binding handles spawn, classification via the supplied guard, stderr emission, and telemetry.
 *
 * The binding's invoke runs:
 * 1. pre-spawn hook (if supplied)
 * 2. agent.run (spawn)
 * 3. applyQuotaFallbackWhenAllowed (classification via guard)
 * 4. stderr/telemetry emission
 */
export function buildPlanBindings<PhaseLabel extends string = string>(
  opts: PlanBindingFactoryOptions<PhaseLabel>,
  agentOrder: readonly { agent: AgentName; model: string | undefined }[],
): InvocationBinding[] {
  return agentOrder.map((entry) => ({
    id: `${opts.phase}:${entry.agent}:${entry.model ?? "default"}`,
    invoke: async (args: { prompt: string; cwd: string; signal?: AbortSignal }) => {
      if (opts.preSpawnHook) {
        await opts.preSpawnHook();
      }

      const agent = opts.createAgent(entry.agent, entry.model);
      const invocationStartedAt = Date.now();
      const spawnResult = await agent.run(args.prompt, {
        ...opts.spawnOptions,
        cwd: args.cwd,
        ...(args.signal !== undefined ? { signal: args.signal } : {}),
      });

      const classificationGuard = opts.classificationGuard();
      const classified = applyQuotaFallbackWhenAllowed(
        entry.agent,
        spawnResult,
        opts.quotaConfig,
        classificationGuard,
      );

      emitPlanAgentQuotaFallback(opts.onRotationStderr, entry.agent, spawnResult, classified);

      opts.onAttempt?.({
        phase: opts.phase,
        agentCli: entry.agent,
        configuredModel: entry.model,
        durationMs: Date.now() - invocationStartedAt,
        result: classified,
      });

      return classified;
    },
  }));
}
