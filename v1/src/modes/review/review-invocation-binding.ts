import { execFileSync } from "node:child_process";
import type { InvocationBinding, InvocationResult } from "../../../../shared/invocation/execute.ts";
import { applyQuotaFallbackWhenAllowed } from "../../agents/quota.ts";
import type { Agent, AgentName, AgentResult } from "../../agents/types.ts";
import type { Config } from "../../config.ts";
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

export type ReviewInvocationBindingOptions<_T extends InvocationResult = InvocationResult> = {
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
  /** Caller-built prompt reused across actuator rungs instead of adapter.buildPrompt. */
  authoritativePrompt?: string | undefined;
  /** Actuator path: always allow quota fallback classification. */
  alwaysAllowQuotaFallback?: boolean | undefined;
  shouldAdvance?: ((result: InvocationResult) => boolean) | undefined;
  /** Actuator path: per-invocation spawn wrapper (watchdog, abort controller, polling). */
  invokeAgent?: ((args: { agent: Agent; prompt: string; cwd: string }) => Promise<AgentResult>) | undefined;
  /** Actuator path: retain raw spawn result for post-execution fallback stderr. */
  recordSpawnResult?: ((spawnResult: AgentResult) => void) | undefined;
};

export function createReviewInvocationBinding<T extends InvocationResult = InvocationResult>(
  opts: ReviewInvocationBindingOptions<T>,
): InvocationBinding<T> {
  // Load agent to get real attribution label
  const agent = opts.loadAgent({
    name: opts.agentEntry.agent,
    model: opts.agentEntry.model,
  });
  const agentLabel = agent.attributionLabel
    ? agent.attributionLabel()
    : `${opts.agentEntry.agent} (${opts.agentEntry.model})`;

  const binding: InvocationBinding<T> = {
    id: agentLabel,
    metadata: { agent: opts.agentEntry.agent, model: opts.agentEntry.model },
    invoke: async (args) => {
      const prompt =
        opts.authoritativePrompt ??
        (await opts.adapter.buildPrompt({
          ...opts.roleContext,
          agentEntry: opts.agentEntry,
        }));

      const loadedAgent = agent;

      const porcelainBefore = readPorcelainSnapshot(opts.cwd);
      const _now = opts.now ?? Date.now;
      const startedAt = _now();

      const spawnResult = opts.invokeAgent
        ? await opts.invokeAgent({ agent: loadedAgent, prompt, cwd: args.cwd })
        : await loadedAgent.run(prompt, {
            cwd: args.cwd,
            ...(args.signal !== undefined ? { signal: args.signal } : {}),
            ...(opts.additionalReadDirs !== undefined ? { additionalReadDirs: opts.additionalReadDirs } : {}),
          });

      opts.recordSpawnResult?.(spawnResult);

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
        opts.alwaysAllowQuotaFallback === true ? true : noDiskChangeDuringInvocation,
      );

      opts.onQuotaFallbackEmit?.(opts.agentEntry.agent, spawnResult, classified);

      const attempt: ReviewAttemptContext = {
        ...opts.roleContext,
        agent: loadedAgent,
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

  if (opts.shouldAdvance !== undefined) {
    binding.shouldAdvance = opts.shouldAdvance as (result: T) => boolean;
  }

  return binding;
}
