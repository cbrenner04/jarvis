import { execFileSync } from "node:child_process";
import type { InvocationBinding, InvocationResult } from "../../../../shared/invocation/execute.ts";
import { applyQuotaFallbackWhenAllowed } from "../../agents/quota.ts";
import type { Agent, AgentName, AgentResult, AgentRunOptions } from "../../agents/types.ts";
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

export type ReviewInvocationBindingOptions = {
  agentEntry: { agent: AgentName; model: string };
  config: Config;
  cwd: string;
  adapter: ReviewAdapter;
  roleContext: ReviewPassContext;
  loadAgent: (args: { name: string; model: string }) => Agent;

  onQuotaFallbackEmit?: ((agentName: AgentName, spawnResult: AgentResult, classified: AgentResult) => void) | undefined;
  recordAttemptTelemetry?: ((data: ReviewAttemptContext) => void | Promise<void>) | undefined;
  additionalReadDirs?: string[] | undefined;
  onSpawned?: AgentRunOptions["onSpawned"] | undefined;
  lastOutputAtMs?: AgentRunOptions["lastOutputAtMs"] | undefined;
  lastOutputNowMs?: AgentRunOptions["lastOutputNowMs"] | undefined;
  abortKillGraceMs?: number | undefined;
  onControllerReady?: ((ctx: { controller: AbortController }) => undefined | (() => void)) | undefined;
  now?: (() => number) | undefined;
};

export function createReviewInvocationBinding<T extends InvocationResult = InvocationResult>(
  opts: ReviewInvocationBindingOptions,
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
    invoke: async (args) => {
      // Build the prompt via adapter
      const prompt = await opts.adapter.buildPrompt({
        ...opts.roleContext,
        agentEntry: opts.agentEntry,
      });

      // Reuse loaded agent
      const loadedAgent = agent;

      // Snapshot git porcelain and run the agent
      const porcelainBefore = readPorcelainSnapshot(args.cwd);
      const _now = opts.now ?? Date.now;
      const startedAt = _now();
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
      });

      let spawnResult: AgentResult;
      try {
        spawnResult = await loadedAgent.run(prompt, {
          cwd: args.cwd,
          signal: controller.signal,
          ...(opts.additionalReadDirs !== undefined ? { additionalReadDirs: opts.additionalReadDirs } : {}),
          ...(opts.onSpawned !== undefined ? { onSpawned: opts.onSpawned } : {}),
          ...(opts.lastOutputAtMs !== undefined ? { lastOutputAtMs: opts.lastOutputAtMs } : {}),
          ...(opts.lastOutputNowMs !== undefined ? { lastOutputNowMs: opts.lastOutputNowMs } : {}),
          ...(opts.abortKillGraceMs !== undefined ? { abortKillGraceMs: opts.abortKillGraceMs } : {}),
        });
      } finally {
        if (parentSignal !== undefined && !parentSignal.aborted) {
          parentSignal.removeEventListener("abort", abortFromParent);
        }
        controllerCleanup?.();
      }

      const porcelainAfter = readPorcelainSnapshot(args.cwd);
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

  return binding;
}
