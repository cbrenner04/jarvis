import { execFileSync } from "node:child_process";
import { applyQuotaFallbackWhenAllowed } from "../../agents/quota.ts";
import type { Agent, AgentResult } from "../../agents/types.ts";
import type { AgentName, Config } from "../../config.ts";
import { resolveReviewAgentOrder, resolveReviewPasses } from "../../config.ts";
import { HARNESS_ALL_AGENTS_QUOTA_EXHAUSTED } from "../../quota-harness-messages.ts";
import type { ReviewAdapter, ReviewAttemptContext, ReviewPassContext } from "./types.ts";
import { ReviewTerminalError } from "./types.ts";

// Exit codes the harness reserves for specific review outcomes. A raw agent
// error code that collides with one would be misread by callers (e.g. plan
// maps 2 -> quota-exhausted, 3 -> model_config; patch propagates 7 as blocker,
// 130 as interrupt). Normalize a colliding error code to 1. The true code is
// still recorded in telemetry, so the diagnostic is never lost.
const RESERVED_REVIEW_EXIT_CODES = new Set([0, 2, 3, 7, 130]);

function normalizeErrorExitCode(exitCode: number): number {
  return RESERVED_REVIEW_EXIT_CODES.has(exitCode) ? 1 : exitCode;
}

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
  onQuotaRotation?: (agent: AgentName, spawnResult: AgentResult, classified: AgentResult) => void;
  now?: () => number;
};

async function recordAdapterFailure(
  adapter: ReviewAdapter,
  attempt: ReviewAttemptContext,
  err: ReviewTerminalError,
): Promise<number> {
  if (!err.telemetryRecorded) {
    await adapter.recordTelemetry({
      ...attempt,
      outcome: "error",
      exitCode: err.exitCode,
    });
  }
  return err.exitCode;
}

/** Run the shared review pass loop. */
export async function runReview(opts: RunReviewOptions): Promise<number> {
  if (opts.adapter === undefined && opts.adapterForPass === undefined) {
    throw new Error("runReview requires adapter or adapterForPass");
  }

  const passCount = resolveReviewPasses(opts.config, opts.reviewPassesOverride);
  const startPassNumber = opts.startPassNumber ?? 1;
  const displayTotalPasses = startPassNumber + passCount - 1;
  const agentOrder = resolveReviewAgentOrder(opts.config);
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

    const remainingAgents = [...agentOrder];

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

      const porcelainBefore = readPorcelainSnapshot(opts.cwd);
      const startedAt = now();
      const spawnResult = await agent.run(prompt, { cwd: opts.cwd });
      const porcelainAfter = readPorcelainSnapshot(opts.cwd);
      const noDiskChangeDuringInvocation =
        porcelainBefore !== null && porcelainAfter !== null && porcelainBefore === porcelainAfter;
      const result = applyQuotaFallbackWhenAllowed(
        agentEntry.agent,
        spawnResult,
        {
          quotaFallback: opts.config.quotaFallback,
          weakQuotaExitCodes: opts.config.weakQuotaExitCodes,
        },
        noDiskChangeDuringInvocation,
      );
      opts.onQuotaRotation?.(agentEntry.agent, spawnResult, result);

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
        try {
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
        } catch (err) {
          if (err instanceof ReviewTerminalError) {
            return await recordAdapterFailure(adapter, attempt, err);
          }
          throw err;
        }
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

      // Telemetry above keeps the true exit code; the returned value is
      // normalized so a raw agent code can't masquerade as a reserved outcome.
      return normalizeErrorExitCode(result.exitCode);
    }

    if (opts.isInterrupted?.()) {
      return 130;
    }
  }

  return 0;
}
