import type { InvocationBinding, InvocationResult } from "../../../../shared/invocation/execute.ts";
import { applyQuotaFallbackWhenAllowed } from "../../agents/quota.ts";
import type { Agent, AgentName, AgentResult, AgentRunOptions } from "../../agents/types.ts";
import type { Config } from "../../config.ts";

export type ShrinkAgentAttemptData = {
  agent: Agent;
  agentName: AgentName;
  configuredModel: string | undefined;
  durationMs: number;
  result: AgentResult;
};

export type ShrinkInvocationBindingOptions<_T extends InvocationResult = InvocationResult> = {
  agentName: AgentName;
  configuredModel: string | undefined;
  createAgent: (agentName: AgentName, model: string) => Agent;
  config: Config;
  cwd: string;

  onQuotaFallbackEmit?: (agentName: AgentName, spawnResult: AgentResult, classified: AgentResult) => void;
  recordAttempt?: (data: ShrinkAgentAttemptData) => void;
  abortKillGraceMs?: number;
  lastOutputAtMs?: { current: number | null } | undefined;
  onControllerReady?:
    | ((ctx: { controller: AbortController; signal: AbortSignal }) => undefined | (() => void))
    | undefined;
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
      const controller = new AbortController();
      const parentSignal = args.signal;
      const abortFromParent = () => {
        controller.abort(parentSignal?.reason);
      };
      if (parentSignal !== undefined) {
        if (parentSignal.aborted) {
          abortFromParent();
        } else {
          parentSignal.addEventListener("abort", abortFromParent, { once: true });
        }
      }
      const controllerCleanup = opts.onControllerReady?.({
        controller,
        signal: controller.signal,
      });

      const spawnResult = await agent
        .run(args.prompt, {
          cwd: args.cwd,
          signal: controller.signal,
          ...(opts.abortKillGraceMs !== undefined ? { abortKillGraceMs: opts.abortKillGraceMs } : {}),
          ...(opts.lastOutputAtMs !== undefined ? { lastOutputAtMs: opts.lastOutputAtMs } : {}),
        } satisfies AgentRunOptions)
        .finally(() => {
          if (parentSignal !== undefined && !parentSignal.aborted) {
            parentSignal.removeEventListener("abort", abortFromParent);
          }
          controllerCleanup?.();
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
        agent,
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
