import { applyQuotaFallbackWhenAllowed } from "../../agents/quota.ts";
import type { Agent, AgentName, AgentResult, AgentRunOptions } from "../../agents/types.ts";
import type { Config } from "../../config.ts";

export type PatchInvocationBindingOptions = {
  agentName: AgentName;
  configuredModel: string | undefined;
  createAgent: (agentName: AgentName, model: string) => Agent;
  config: Config;
  abortKillGraceMs?: number;
};

export type PatchInvocationBinding = {
  spawn: (args: {
    prompt: string;
    cwd: string;
    signal?: AbortSignal;
    additionalReadDirs?: string[];
    lastOutputAtMs?: { current: number | null };
    onSpawned?: (child: { pid: number }) => void;
  }) => Promise<AgentResult>;
  classify: (
    result: AgentResult,
    allowLenientWeakQuotaFallback: boolean,
  ) => AgentResult;
};

export function createPatchInvocationBinding(
  opts: PatchInvocationBindingOptions,
): PatchInvocationBinding {
  const model = opts.configuredModel ?? "";
  const agent = opts.createAgent(opts.agentName, model);

  return {
    spawn: async (args) => {
      const runOpts: AgentRunOptions = {
        cwd: args.cwd,
        ...(args.signal !== undefined ? { signal: args.signal } : {}),
        ...(args.additionalReadDirs !== undefined
          ? { additionalReadDirs: args.additionalReadDirs }
          : {}),
        ...(opts.abortKillGraceMs !== undefined
          ? { abortKillGraceMs: opts.abortKillGraceMs }
          : {}),
        ...(args.lastOutputAtMs !== undefined ? { lastOutputAtMs: args.lastOutputAtMs } : {}),
        ...(args.onSpawned !== undefined ? { onSpawned: args.onSpawned } : {}),
      };
      return await agent.run(args.prompt, runOpts);
    },
    classify: (result, allowLenientWeakQuotaFallback) => {
      return applyQuotaFallbackWhenAllowed(
        opts.agentName,
        result,
        {
          quotaFallback: opts.config.quotaFallback,
          weakQuotaExitCodes: opts.config.weakQuotaExitCodes,
        },
        allowLenientWeakQuotaFallback,
      );
    },
  };
}
