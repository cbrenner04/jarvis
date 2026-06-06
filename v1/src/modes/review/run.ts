import type { Agent } from "../../agents/types.ts";
import type { Config } from "../../config.ts";
import { resolveReviewAgentOrder, resolveReviewPasses } from "../../config.ts";
import { HARNESS_ALL_AGENTS_QUOTA_EXHAUSTED } from "../../quota-harness-messages.ts";
import type { ReviewAdapter, ReviewAttemptContext, ReviewPassContext } from "./types.ts";

/** Inputs for the shared review runner. */
export type RunReviewOptions = {
  config: Config;
  cwd: string;
  adapter?: ReviewAdapter;
  /** Build a fresh adapter per pass (e.g. plan review snapshots intent before each pass). */
  adapterForPass?: (ctx: ReviewPassContext) => ReviewAdapter | Promise<ReviewAdapter>;
  reviewPassesOverride?: number;
  /** First pass number for display and prompt context (default 1). */
  startPassNumber?: number;
  isInterrupted?: () => boolean;
  onPassStart?: (passNumber: number, totalPasses: number) => void;
  loadAgent: (args: { name: string; model: string }) => Agent;
  onAllAgentsQuotaExhausted?: (message: string) => void;
  now?: () => number;
};

/** Run the shared review pass loop. */
export async function runReview(opts: RunReviewOptions): Promise<number> {
  if (opts.adapter === undefined && opts.adapterForPass === undefined) {
    throw new Error("runReview requires adapter or adapterForPass");
  }

  const passCount = resolveReviewPasses(opts.config, opts.reviewPassesOverride);
  const startPassNumber = opts.startPassNumber ?? 1;
  const displayTotalPasses = startPassNumber + passCount - 1;
  const remainingAgents = [...resolveReviewAgentOrder(opts.config)];
  const now = opts.now ?? Date.now;

  for (let passIndex = 0; passIndex < passCount; passIndex += 1) {
    if (opts.isInterrupted?.()) {
      return 130;
    }

    const passNumber = startPassNumber + passIndex;
    opts.onPassStart?.(passNumber, displayTotalPasses);
    const passContext: ReviewPassContext = { passNumber, totalPasses: displayTotalPasses };
    const adapter = (await opts.adapterForPass?.(passContext)) ?? opts.adapter;
    if (adapter === undefined) {
      throw new Error("runReview adapter resolved to undefined");
    }

    while (true) {
      const agentEntry = remainingAgents[0];
      if (agentEntry === undefined) {
        opts.onAllAgentsQuotaExhausted?.(HARNESS_ALL_AGENTS_QUOTA_EXHAUSTED);
        return 2;
      }

      const agent = opts.loadAgent({
        name: agentEntry.agent,
        model: agentEntry.model,
      });
      const prompt = await adapter.buildPrompt({
        passNumber,
        totalPasses: displayTotalPasses,
        agentEntry,
      });

      const startedAt = now();
      const result = await agent.run(prompt, { cwd: opts.cwd });
      const attempt: ReviewAttemptContext = {
        passNumber,
        totalPasses: displayTotalPasses,
        agent,
        agentEntry,
        agentLabel: agent.attributionLabel(),
        prompt,
        durationMs: Math.max(0, now() - startedAt),
        result,
      };

      if (result.kind === "ok") {
        await adapter.enforceWriteBoundary(attempt);
        const blocker = await adapter.readBlocker(attempt);
        if (blocker !== null) {
          const exitCode = await adapter.handleBlocker({ ...attempt, blocker });
          await adapter.recordTelemetry({
            ...attempt,
            outcome: "blocked",
            exitCode,
          });
          return exitCode;
        }

        await adapter.commitPass(attempt);
        await adapter.recordTelemetry({
          ...attempt,
          outcome: "ok",
        });
        break;
      }

      const exitCode = result.kind === "model_config" ? 3 : result.kind === "error" ? result.exitCode : undefined;
      await adapter.recordTelemetry({
        ...attempt,
        outcome: result.kind,
        ...(exitCode !== undefined ? { exitCode } : {}),
      });

      if (result.kind === "quota") {
        remainingAgents.shift();
        continue;
      }

      if (result.kind === "model_config") {
        return 3;
      }

      return result.exitCode;
    }

    if (opts.isInterrupted?.()) {
      return 130;
    }
  }

  return 0;
}
