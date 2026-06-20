import type { Agent, AgentResult } from "../../agents/types.ts";
import type { AgentName, Config } from "../../config.ts";
import { resolveReviewAgentOrder, resolveReviewPasses } from "../../config.ts";
import { HARNESS_ALL_AGENTS_QUOTA_EXHAUSTED } from "../../quota-harness-messages.ts";
import type { ReviewAdapter, ReviewAttemptContext, ReviewPassContext } from "./types.ts";
import { ReviewTerminalError } from "./types.ts";
import { buildReviewBindings } from "./review-binding-factory.ts";

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

  const bindings = buildReviewBindings(
    {
      cwd: opts.cwd,
      config: opts.config,
      createAgent: (name, model) => opts.loadAgent({ name, model }),
      spawnOptions: opts.additionalReadDirs !== undefined ? { additionalReadDirs: opts.additionalReadDirs } : {},
      buildPrompt: async (entry) => {
        return adapter.buildPrompt({
          ...roleContext,
          agentEntry: entry,
        });
      },
      ...(opts.onQuotaRotation !== undefined ? { onQuotaRotation: opts.onQuotaRotation } : {}),
      ...(opts.now !== undefined ? { now: opts.now } : {}),
    },
    agentOrder,
  );

  // Review only advances on quota; error/model_config stop immediately
  // Manually loop through bindings instead of using executor (which advances on error)
  for (const binding of bindings) {
    const result = await binding.invoke({
      prompt: "", // unused; binding builds its own
      cwd: opts.cwd,
    });

    // Extract agent from binding id: "review:{agent}:{model}"
    const bindingIdParts = binding.id.split(":");
    if (bindingIdParts.length < 3) {
      throw new Error(`Invalid binding id: ${binding.id}`);
    }
    const agentName = bindingIdParts[1] as AgentName;
    const model = bindingIdParts[2];

    const agentEntry = agentOrder.find((a) => a.agent === agentName && a.model === model);
    if (!agentEntry) {
      throw new Error(`Agent not found in agentOrder: ${agentName} / ${model}`);
    }

    // Use agent from result (created by binding) to avoid double-loading
    const agent = (result as any).agent;
    if (!agent) {
      throw new Error("Agent not returned in result");
    }

    const attempt: ReviewAttemptContext = {
      ...roleContext,
      agent,
      agentEntry,
      agentLabel: (result as any).attributionLabel || "",
      prompt: (result as any).builtPrompt || "",
      durationMs: (result as any).durationMs || 0,
      result,
    };

    // Record telemetry for quota results and continue to next agent
    if (result.kind === "quota") {
      await adapter.recordTelemetry({
        ...attempt,
        outcome: "quota",
      });
      continue;
    }

    // For non-quota results (ok, model_config, error), handle the outcome
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
        const spawnResultKind = (result as any).spawnResultKind;
        const artifact = spawnResultKind === "ok" ? result.stdout : null;
        return { artifact, attempt };
      } catch (err) {
        if (err instanceof ReviewTerminalError) {
          throw err;
        }
        throw err;
      }
    }

    // model_config or error: record telemetry and throw
    const exitCode = result.kind === "model_config" ? 3 : result.kind === "error" ? result.exitCode : undefined;
    await adapter.recordTelemetry({
      ...attempt,
      outcome: result.kind,
      ...(exitCode !== undefined ? { exitCode } : {}),
    });

    if (result.kind === "model_config") {
      throw new ReviewTerminalError("model configuration error", 3, { telemetryRecorded: true });
    }

    throw new ReviewTerminalError(`role ${role} failed: ${result.kind}`, normalizeErrorExitCode(result.exitCode), {
      telemetryRecorded: true,
    });
  }

  // All agents exhausted on quota
  opts.onAllAgentsQuotaExhausted?.(HARNESS_ALL_AGENTS_QUOTA_EXHAUSTED);
  throw new ReviewTerminalError(HARNESS_ALL_AGENTS_QUOTA_EXHAUSTED, 2, { telemetryRecorded: true });
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
