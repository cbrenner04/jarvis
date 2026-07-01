import type { WaitRunCompletionResult } from "./daemon.ts";
import type { RunStatus } from "./state-store-types.ts";
import type { WriteLoopOutcomeKind } from "./write-loop.ts";

/** Known durable run statuses on daemon run-control wire payloads. */
export const RUN_STATUSES = new Set<RunStatus>([
  "in-progress",
  "completed",
  "blocked",
  "budget-soft-stopped",
  "paused",
  "failed",
  "killed",
]);

/** Known loop outcome kinds on daemon `wait` wire payloads. */
export const LOOP_OUTCOME_KINDS = new Set<WriteLoopOutcomeKind>([
  "complete",
  "progress",
  "blocked",
  "contract_miss",
  "invocation_failure",
  "budget-exhausted",
  "paused",
]);

export function isRunStatus(value: unknown): value is RunStatus {
  return typeof value === "string" && RUN_STATUSES.has(value as RunStatus);
}

function isLoopOutcomeKind(value: unknown): value is WriteLoopOutcomeKind {
  return typeof value === "string" && LOOP_OUTCOME_KINDS.has(value as WriteLoopOutcomeKind);
}

/** Parse a daemon `wait` success payload; returns `undefined` when malformed. */
export function parseWaitCompletion(value: unknown): WaitRunCompletionResult | undefined {
  if (typeof value !== "object" || value === null) return undefined;

  const record = value as Record<string, unknown>;
  if (!isRunStatus(record.runStatus)) return undefined;

  const result: WaitRunCompletionResult = { runStatus: record.runStatus };

  if (record.loopOutcomeKind !== undefined) {
    if (!isLoopOutcomeKind(record.loopOutcomeKind)) return undefined;
    result.loopOutcomeKind = record.loopOutcomeKind;
  }

  const iterationsConsumed = record.iterationsConsumed;
  if (iterationsConsumed !== undefined) {
    if (typeof iterationsConsumed !== "number" || !Number.isFinite(iterationsConsumed)) return undefined;
    result.iterationsConsumed = iterationsConsumed;
  }

  const resumable = record.resumable;
  if (resumable !== undefined) {
    if (typeof resumable !== "boolean") return undefined;
    result.resumable = resumable;
  }

  return result;
}
