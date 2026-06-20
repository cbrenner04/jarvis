import { execFileSync } from "node:child_process";
import type { AgentRunOptions, AgentResult, Agent } from "../../agents/types.ts";
import type { AgentName, Config } from "../../config.ts";
import { applyQuotaFallbackWhenAllowed } from "../../agents/quota.ts";
import type { InvocationBinding, InvocationResult } from "../../../../shared/invocation/execute.ts";

function readPorcelainSnapshot(cwd: string): string | null {
  try {
    return execFileSync("git", ["status", "--porcelain"], {
      cwd,
      encoding: "utf8",
    });
  } catch {
    return null;
  }
}

export type ReviewInvocationResult = InvocationResult & {
  spawnResultKind?: "ok" | "error" | "model_config" | "quota";
  durationMs?: number;
  builtPrompt?: string;
  attributionLabel?: string;
  agent?: Agent;
};

export type ReviewBindingFactoryOptions = {
  cwd: string;
  config: Config;
  createAgent: (agentName: AgentName, model: string) => Agent;
  spawnOptions: Omit<AgentRunOptions, "cwd" | "signal">;
  buildPrompt: (entry: { agent: AgentName; model: string }) => string | Promise<string>;
  onQuotaRotation?: (agent: AgentName, spawnResult: AgentResult, classified: AgentResult) => void;
  now?: () => number;
};

/**
 * Build InvocationBindings for review roles, wrapping agent spawn and classification.
 * Each binding builds its agent-specific prompt, fires onQuotaRotation callback, and returns.
 * Returns richer results that include spawnResultKind for artifact extraction.
 */
export function buildReviewBindings(
  opts: ReviewBindingFactoryOptions,
  agentOrder: readonly { agent: AgentName; model: string }[],
): InvocationBinding<ReviewInvocationResult>[] {
  return agentOrder.map((entry) => ({
    id: `review:${entry.agent}:${entry.model}`,
    invoke: async (args: { prompt: string; cwd: string; signal?: AbortSignal }) => {
      const builtPrompt = await opts.buildPrompt(entry);
      const agent = opts.createAgent(entry.agent, entry.model);
      const porcelainBefore = readPorcelainSnapshot(args.cwd);
      const now = opts.now ?? Date.now;
      const startedAt = now();
      const spawnResult = await agent.run(builtPrompt, {
        ...opts.spawnOptions,
        cwd: args.cwd,
        ...(args.signal !== undefined ? { signal: args.signal } : {}),
      });

      const porcelainAfter = readPorcelainSnapshot(args.cwd);
      const noDiskChangeDuringInvocation =
        porcelainBefore !== null && porcelainAfter !== null && porcelainBefore === porcelainAfter;

      const classified = applyQuotaFallbackWhenAllowed(
        entry.agent,
        spawnResult,
        {
          quotaFallback: opts.config.quotaFallback,
          weakQuotaExitCodes: opts.config.weakQuotaExitCodes,
        },
        noDiskChangeDuringInvocation,
      );

      opts.onQuotaRotation?.(entry.agent, spawnResult, classified);

      // Return classified result with metadata for caller
      return {
        ...classified,
        spawnResultKind: spawnResult.kind,
        durationMs: Math.max(0, now() - startedAt),
        builtPrompt,
        attributionLabel: agent.attributionLabel(),
        agent,
      };
    },
  }));
}
