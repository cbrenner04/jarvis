import type { InvocationBinding, InvocationResult } from "../../../../shared/invocation/execute.ts";
import { applyQuotaFallbackWhenAllowed } from "../../agents/quota.ts";
import type { Agent, AgentName, AgentResult } from "../../agents/types.ts";
import type { Config } from "../../config.ts";

export type ShrinkAgentAttemptData = {
  agentName: AgentName;
  configuredModel: string | undefined;
  durationMs: number;
  result: AgentResult;
};

export type ShrinkInvocationBindingOptions<T extends InvocationResult = InvocationResult> = {
  agentName: AgentName;
  configuredModel: string | undefined;
  createAgent: (agentName: AgentName, model: string) => Agent;
  config: Config;
  cwd: string;

  onQuotaFallbackEmit?: (agentName: AgentName, spawnResult: AgentResult, classified: AgentResult) => void;
  recordAttempt?: (data: ShrinkAgentAttemptData) => void;
  abortKillGraceMs?: number;
};

export function createShrinkInvocationBinding<T extends InvocationResult = InvocationResult>(
  opts: ShrinkInvocationBindingOptions<T>,
): InvocationBinding<T> {
  const model = opts.configuredModel ?? "";
  const agent = opts.createAgent(opts.agentName, model);

  const binding: InvocationBinding<T> = {
    id: opts.agentName,
    invoke: async (args) => {
      const invocationStartedAt = Date.now();

      const spawnResult = await agent.run(args.prompt, {
        cwd: args.cwd,
        ...(args.signal !== undefined ? { signal: args.signal } : {}),
        ...(opts.abortKillGraceMs !== undefined ? { abortKillGraceMs: opts.abortKillGraceMs } : {}),
      });

      const classified = applyQuotaFallbackWhenAllowed(
        opts.agentName,
        spawnResult,
        {
          quotaFallback: opts.config.quotaFallback,
          weakQuotaExitCodes: opts.config.weakQuotaExitCodes,
        },
        true,
      );

      opts.onQuotaFallbackEmit?.(opts.agentName, spawnResult, classified);
      opts.recordAttempt?.({
        agentName: opts.agentName,
        configuredModel: opts.configuredModel,
        durationMs: Date.now() - invocationStartedAt,
        result: classified,
      });

      return classified as T;
    },
  };

  return binding;
}
