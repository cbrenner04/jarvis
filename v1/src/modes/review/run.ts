import type { Agent, AgentResult } from "../../agents/types.ts";
import type { AgentName, Config } from "../../config.ts";
import { resolveReviewAgentOrder, resolveReviewPasses } from "../../config.ts";
import { HARNESS_ALL_AGENTS_QUOTA_EXHAUSTED } from "../../quota-harness-messages.ts";
import { executeWithQuotaFallback } from "../../../../shared/invocation/execute.ts";
import { createReviewInvocationBinding } from "./review-invocation-binding.ts";
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
  /** Optional actuator invoked once per cycle after the adjudicator with the verdict. */
  actuator?: (verdict: string, ctx: ReviewPassContext) => Promise<void>;
  /** Additional read directories passed to agent (for external spec storage). */
  additionalReadDirs?: string[];
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

/** Run one debate role attempt (adversary, advocate, or adjudicator). */
async function runRoleAttempt(
  role: "adversary" | "advocate" | "adjudicator",
  passContext: ReviewPassContext,
  adapter: ReviewAdapter,
  agentOrder: Array<{ agent: AgentName; model: string }>,
  opts: RunReviewOptions,
): Promise<{ artifact: string | null; attempt: ReviewAttemptContext }> {
  const roleContext: ReviewPassContext = { ...passContext, role };

  // Track attempt contexts by binding id for later retrieval
  const attemptContextByBindingId = new Map<string, ReviewAttemptContext>();

  // Create bindings for all agents in the order
  const bindings = await Promise.all(
    agentOrder.map((agentEntry) =>
      createReviewInvocationBinding({
        agentEntry,
        config: opts.config,
        cwd: opts.cwd,
        adapter,
        roleContext,
        loadAgent: opts.loadAgent,
        onQuotaFallbackEmit: opts.onQuotaRotation,
        additionalReadDirs: opts.additionalReadDirs,
        now: opts.now,
        recordAttemptTelemetry: async (attempt) => {
          // Store context for later retrieval
          const agentLabel = `${agentEntry.agent} (${agentEntry.model})`;
          attemptContextByBindingId.set(agentLabel, attempt);

          // Record telemetry for non-ok cases; ok cases handled below after blocker check
          if (attempt.result.kind !== "ok") {
            const exitCode = attempt.result.kind === "model_config" ? 3 : attempt.result.kind === "error" ? attempt.result.exitCode : undefined;
            await adapter.recordTelemetry({
              ...attempt,
              outcome: attempt.result.kind,
              ...(exitCode !== undefined ? { exitCode } : {}),
            });
          }
        },
      }),
    ),
  );

  // Run all agents with quota fallback
  const execution = await executeWithQuotaFallback({
    prompt: "", // Review builds its own prompt via adapter
    cwd: opts.cwd,
    bindings,
  });

  // Check if all agents were exhausted
  if (execution.final === null || execution.final.result.kind === "quota") {
    opts.onAllAgentsQuotaExhausted?.(HARNESS_ALL_AGENTS_QUOTA_EXHAUSTED);
    throw new ReviewTerminalError(HARNESS_ALL_AGENTS_QUOTA_EXHAUSTED, 2, { telemetryRecorded: true });
  }

  // Retrieve the attempt context that was stored during invoke
  const attempt = attemptContextByBindingId.get(execution.final.binding.id);
  if (attempt === undefined) {
    throw new Error("Internal error: attempt context not found");
  }

  const result = attempt.result;

  if (result.kind === "ok") {
    try {
      await adapter.enforceWriteBoundary(attempt);
      let blocker: string | null = null;
      try {
        blocker = await adapter.readBlocker(attempt);
      } catch (err) {
        if (err instanceof ReviewTerminalError) {
          await adapter.recordTelemetry({
            ...attempt,
            outcome: "error",
            exitCode: err.exitCode,
          });
        }
        throw err;
      }
      if (blocker !== null) {
        const exitCode = await adapter.handleBlocker({ ...attempt, blocker });
        await adapter.recordTelemetry({
          ...attempt,
          outcome: "blocked",
          exitCode,
        });
        throw new ReviewTerminalError(blocker, exitCode, { telemetryRecorded: true });
      }

      await adapter.commitPass(attempt);
      await adapter.recordTelemetry({
        ...attempt,
        outcome: "ok",
      });
      return { artifact: attempt.result.kind === "ok" ? attempt.result.stdout : null, attempt };
    } catch (err) {
      if (err instanceof ReviewTerminalError) {
        throw err;
      }
      throw err;
    }
  }

  if (result.kind === "model_config") {
    throw new ReviewTerminalError("model configuration error", 3, { telemetryRecorded: true });
  }

  const exitCode = result.kind === "error" ? result.exitCode : 1;
  throw new ReviewTerminalError(`role ${role} failed: ${result.kind}`, normalizeErrorExitCode(exitCode), {
    telemetryRecorded: true,
  });
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
  const _now = opts.now ?? Date.now;

  let priorVerdict: string | undefined;

  for (let passIndex = 0; passIndex < passCount; passIndex += 1) {
    if (opts.isInterrupted?.()) {
      return 130;
    }

    const passNumber = startPassNumber + passIndex;
    opts.onPassStart?.(passNumber, displayTotalPasses);
    const passContext: ReviewPassContext = {
      passNumber,
      totalPasses: displayTotalPasses,
      ...(priorVerdict !== undefined ? { priorVerdict } : {}),
    };
    const adapter = (await opts.adapterForPass?.(passContext)) ?? opts.adapter;
    if (adapter === undefined) {
      throw new Error("runReview adapter resolved to undefined");
    }

    try {
      const adversaryResult = await runRoleAttempt("adversary", passContext, adapter, agentOrder, opts);
      if (opts.isInterrupted?.()) {
        return 130;
      }

      const advocateContext: ReviewPassContext = {
        ...passContext,
        ...(adversaryResult.artifact ? { priorArtifact: adversaryResult.artifact } : {}),
      };
      const advocateResult = await runRoleAttempt("advocate", advocateContext, adapter, agentOrder, opts);
      if (opts.isInterrupted?.()) {
        return 130;
      }

      const adjudicatorContext: ReviewPassContext = {
        ...passContext,
        ...(advocateResult.artifact ? { priorArtifact: advocateResult.artifact } : {}),
      };
      const adjudicatorResult = await runRoleAttempt("adjudicator", adjudicatorContext, adapter, agentOrder, opts);
      const verdict = adjudicatorResult.artifact;

      if (verdict?.trim()) {
        priorVerdict = verdict;
        if (opts.actuator) {
          try {
            await opts.actuator(verdict, passContext);
          } catch (err) {
            if (err instanceof ReviewTerminalError) {
              return await recordAdapterFailure(adapter, adjudicatorResult.attempt, err);
            }
            const message = err instanceof Error ? err.message : String(err);
            throw new ReviewTerminalError(`actuator failed: ${message}`, 1);
          }
        }
      }
    } catch (err) {
      if (err instanceof ReviewTerminalError) {
        return err.exitCode;
      }
      throw err;
    }

    if (opts.isInterrupted?.()) {
      return 130;
    }
  }

  return 0;
}
