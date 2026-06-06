import type { Agent } from "../../agents/types.ts";
import type { Config } from "../../config.ts";
import { resolveReviewAgentOrder, resolveReviewPasses } from "../../config.ts";
import { HARNESS_ALL_AGENTS_QUOTA_EXHAUSTED } from "../../quota-harness-messages.ts";
import type { ReviewAdapter, ReviewAttemptContext, ReviewAttemptOutcome } from "./types.ts";

/** Inputs for the shared review runner. */
export type RunReviewOptions = {
  config: Config;
  cwd: string;
  adapter: ReviewAdapter;
  reviewPassesOverride?: number;
  loadAgent: (args: { name: string; model: string }) => Agent;
  onAllAgentsQuotaExhausted?: (message: string) => void;
  now?: () => number;
};

function outcomeForError(result: ReviewAttemptContext["result"]): ReviewAttemptOutcome {
  switch (result.kind) {
    case "quota":
      return "quota";
    case "model_config":
      return "model_config";
    case "error":
      return "error";
    case "ok":
      return "ok";
  }
}

/** Run the shared review pass loop. */
export async function runReview(opts: RunReviewOptions): Promise<number> {
  const totalPasses = resolveReviewPasses(opts.config, opts.reviewPassesOverride);
  const remainingAgents = [...resolveReviewAgentOrder(opts.config)];
  const now = opts.now ?? Date.now;

  for (let passNumber = 1; passNumber <= totalPasses; passNumber += 1) {
    while (true) {
      const agentEntry = remainingAgents[0];
      if (agentEntry === undefined) {
        opts.onAllAgentsQuotaExhausted?.(HARNESS_ALL_AGENTS_QUOTA_EXHAUSTED);
        return 2;
      }

      const agent = opts.loadAgent(agentEntry);
      const prompt = await opts.adapter.buildPrompt({
        passNumber,
        totalPasses,
        agentEntry,
      });

      const startedAt = now();
      const result = await agent.run(prompt, { cwd: opts.cwd });
      const attempt: ReviewAttemptContext = {
        passNumber,
        totalPasses,
        agent,
        agentEntry,
        agentLabel: agent.attributionLabel(),
        prompt,
        durationMs: Math.max(0, now() - startedAt),
        result,
      };

      if (result.kind === "ok") {
        await opts.adapter.enforceWriteBoundary(attempt);
        const blocker = await opts.adapter.readBlocker(attempt);
        if (blocker !== null) {
          const exitCode = await opts.adapter.handleBlocker({ ...attempt, blocker });
          await opts.adapter.recordTelemetry({
            ...attempt,
            outcome: "blocked",
            exitCode,
          });
          return exitCode;
        }

        await opts.adapter.commitPass(attempt);
        await opts.adapter.recordTelemetry({
          ...attempt,
          outcome: "ok",
        });
        break;
      }

      const outcome = outcomeForError(result);
      const exitCode = result.kind === "model_config" ? 3 : result.kind === "error" ? result.exitCode : undefined;
      await opts.adapter.recordTelemetry({
        ...attempt,
        outcome,
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
  }

  return 0;
}
