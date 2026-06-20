import { execFileSync } from "node:child_process";
import { applyQuotaFallbackWhenAllowed } from "../../agents/quota.ts";
import type { Agent, AgentName, AgentResult } from "../../agents/types.ts";
import type { Config } from "../../config.ts";
import type { InvocationBinding, InvocationResult } from "../../../../shared/invocation/execute.ts";
import type { ReviewAdapter, ReviewAttemptContext, ReviewPassContext } from "./types.ts";

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

export type ReviewInvocationBindingOptions<T extends InvocationResult = InvocationResult> = {
  agentEntry: { agent: AgentName; model: string };
  config: Config;
  cwd: string;
  adapter: ReviewAdapter;
  roleContext: ReviewPassContext;
  loadAgent: (args: { name: string; model: string }) => Agent;

  onQuotaFallbackEmit?: ((agentName: AgentName, spawnResult: AgentResult, classified: AgentResult) => void) | undefined;
  recordAttemptTelemetry?: ((data: ReviewAttemptContext) => void | Promise<void>) | undefined;
  additionalReadDirs?: string[] | undefined;
  now?: (() => number) | undefined;
};

export async function createReviewInvocationBinding<T extends InvocationResult = InvocationResult>(
  opts: ReviewInvocationBindingOptions<T>,
): Promise<InvocationBinding<T>> {
  const agentLabel = `${opts.agentEntry.agent} (${opts.agentEntry.model})`;

  const binding: InvocationBinding<T> = {
    id: agentLabel,
    invoke: async (args) => {
      // Build the prompt via adapter
      const prompt = await opts.adapter.buildPrompt({
        ...opts.roleContext,
        agentEntry: opts.agentEntry,
      });

      // Load agent and run it
      const agent = opts.loadAgent({
        name: opts.agentEntry.agent,
        model: opts.agentEntry.model,
      });

      // Snapshot git porcelain and run the agent
      const porcelainBefore = readPorcelainSnapshot(opts.cwd);
      const _now = opts.now ?? Date.now;
      const startedAt = _now();

      const spawnResult = await agent.run(prompt, {
        cwd: args.cwd,
        ...(args.signal !== undefined ? { signal: args.signal } : {}),
        ...(opts.additionalReadDirs !== undefined ? { additionalReadDirs: opts.additionalReadDirs } : {}),
      });

      const porcelainAfter = readPorcelainSnapshot(opts.cwd);
      const noDiskChangeDuringInvocation =
        porcelainBefore !== null && porcelainAfter !== null && porcelainBefore === porcelainAfter;

      const classified = applyQuotaFallbackWhenAllowed(
        opts.agentEntry.agent,
        spawnResult,
        {
          quotaFallback: opts.config.quotaFallback,
          weakQuotaExitCodes: opts.config.weakQuotaExitCodes,
        },
        noDiskChangeDuringInvocation,
      );

      opts.onQuotaFallbackEmit?.(opts.agentEntry.agent, spawnResult, classified);

      const attempt: ReviewAttemptContext = {
        ...opts.roleContext,
        agent,
        agentEntry: opts.agentEntry,
        agentLabel,
        prompt,
        durationMs: Math.max(0, _now() - startedAt),
        result: classified,
      };

      opts.recordAttemptTelemetry?.(attempt);

      return classified as T;
    },
  };

  return binding;
}
