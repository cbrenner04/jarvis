import { applyQuotaFallbackWhenAllowed } from "../../agents/quota.ts";
import type { Agent, AgentName, AgentResult } from "../../agents/types.ts";
import type { Config } from "../../config.ts";
import { type InvocationBinding, type InvocationResult } from "../../../../shared/invocation/execute.ts";
import { readGitPorcelainSnapshot } from "./git-porcelain.ts";

export type PlanAgentAttemptData = {
  agentCli: AgentName;
  configuredModel: string | undefined;
  durationMs: number;
  result: AgentResult;
};

export type PlanInvocationBindingOptions<T extends InvocationResult = InvocationResult> = {
  agentName: AgentName;
  configuredModel: string | undefined;
  createAgent: (agentName: AgentName, model: string) => Agent;
  config: Config;
  worktreePath: string;

  onQuotaFallbackEmit?: (agentName: AgentName, spawnResult: AgentResult, classified: AgentResult) => void;
  recordAgentAttempt?: (data: PlanAgentAttemptData) => void;
  spawnOptions?: { additionalReadDirs?: string[] } | undefined;
  preSpinHook?: () => void;
  shouldAdvance?: ((result: T) => boolean) | undefined;
};

export function createPlanInvocationBinding<T extends InvocationResult = InvocationResult>(
  opts: PlanInvocationBindingOptions<T>,
): InvocationBinding<T> {
  const model = opts.configuredModel ?? "";
  const agent = opts.createAgent(opts.agentName, model);
  const agentLabel = agent.attributionLabel ? agent.attributionLabel() : `${opts.agentName} (${opts.configuredModel})`;

  const binding: InvocationBinding<T> = {
    id: agentLabel,
    invoke: async (args) => {
      opts.preSpinHook?.();

      const porcelainBefore = readGitPorcelainSnapshot(opts.worktreePath);
      const invocationStartedAt = Date.now();

      const spawnResult = await agent.run(args.prompt, {
        cwd: args.cwd,
        ...(args.signal !== undefined ? { signal: args.signal } : {}),
        ...(opts.spawnOptions?.additionalReadDirs !== undefined
          ? { additionalReadDirs: opts.spawnOptions.additionalReadDirs }
          : {}),
      });

      const porcelainAfter = readGitPorcelainSnapshot(opts.worktreePath);
      const noDiskChangeDuringInvocation =
        porcelainBefore !== null && porcelainAfter !== null && porcelainBefore === porcelainAfter;

      const classified = applyQuotaFallbackWhenAllowed(
        opts.agentName,
        spawnResult,
        {
          quotaFallback: opts.config.quotaFallback,
          weakQuotaExitCodes: opts.config.weakQuotaExitCodes,
        },
        noDiskChangeDuringInvocation,
      );

      opts.onQuotaFallbackEmit?.(opts.agentName, spawnResult, classified);
      opts.recordAgentAttempt?.({
        agentCli: opts.agentName,
        configuredModel: opts.configuredModel,
        durationMs: Date.now() - invocationStartedAt,
        result: classified,
      });

      return classified as T;
    },
  };

  if (opts.shouldAdvance !== undefined) {
    binding.shouldAdvance = opts.shouldAdvance;
  }

  return binding;
}
