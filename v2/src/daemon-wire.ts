import type { WaitRunCompletionResult } from "./daemon.ts";
import type { RunOperatorError, RunOperatorErrorReason, RunOperatorNextAction } from "./run-operator-error.ts";
import type { RunStatus } from "./state-store-types.ts";
import type { WriteLoopOutcomeKind } from "./write-loop.ts";

/** One durable run row on daemon `list` wire payloads. */
export type DaemonListRunRow = {
  runId: string;
  project: string;
  branch: string;
  status: RunStatus;
  isLive: boolean;
  error?: RunOperatorError;
};

/** Successful daemon `list` wire payload. */
export type DaemonListResult = { runs: DaemonListRunRow[] };

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

/** Known operator error reasons on daemon `list` / `wait` wire payloads. */
const RUN_OPERATOR_ERROR_REASONS = new Set<RunOperatorErrorReason>([
  "resumable_pause",
  "resumable_budget",
  "resumable_kill",
  "agent_blocked",
  "contract_miss",
  "invalid_token",
  "quota_exhausted",
  "model_config",
  "no_binding",
  "invocation_error",
  "harness_failure",
]);

/** Known operator next actions on daemon `list` / `wait` wire payloads. */
const RUN_OPERATOR_NEXT_ACTIONS = new Set<RunOperatorNextAction>([
  "resume",
  "inspect_spec",
  "fix_config",
  "retry_later",
  "stop",
]);

export function isRunStatus(value: unknown): value is RunStatus {
  return typeof value === "string" && RUN_STATUSES.has(value as RunStatus);
}

function isRunOperatorError(value: unknown): value is RunOperatorError {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.reason === "string" &&
    RUN_OPERATOR_ERROR_REASONS.has(record.reason as RunOperatorErrorReason) &&
    typeof record.retryable === "boolean" &&
    typeof record.nextAction === "string" &&
    RUN_OPERATOR_NEXT_ACTIONS.has(record.nextAction as RunOperatorNextAction)
  );
}

function isDaemonListRunRow(value: unknown): value is DaemonListRunRow {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  if (row.error !== undefined && !isRunOperatorError(row.error)) return false;
  return (
    typeof row.runId === "string" &&
    typeof row.project === "string" &&
    typeof row.branch === "string" &&
    isRunStatus(row.status) &&
    typeof row.isLive === "boolean"
  );
}

/** Parse a daemon `health` success payload; returns `undefined` when malformed. */
export function parseHealthResult(value: unknown): { ok: true } | undefined {
  if (typeof value === "object" && value !== null && (value as { ok?: unknown }).ok === true) {
    return { ok: true };
  }
  return undefined;
}

/** Parse a daemon `status` success payload; returns `undefined` when malformed. */
export function parseStatusResult(value: unknown): { state: "running" } | undefined {
  if (typeof value === "object" && value !== null && (value as { state?: unknown }).state === "running") {
    return { state: "running" };
  }
  return undefined;
}

/** Parse a daemon `start` success payload; returns `undefined` when malformed. */
export function parseStartResult(value: unknown): { runId: string } | undefined {
  if (typeof value === "object" && value !== null && typeof (value as { runId?: unknown }).runId === "string") {
    return { runId: (value as { runId: string }).runId };
  }
  return undefined;
}

/** Parse a daemon `list` success payload; returns `undefined` when malformed. */
export function parseListRuns(value: unknown): DaemonListResult | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const runs = (value as { runs?: unknown }).runs;
  if (!Array.isArray(runs) || !runs.every(isDaemonListRunRow)) return undefined;
  return { runs };
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

  const error = record.error;
  if (error !== undefined) {
    if (!isRunOperatorError(error)) return undefined;
    result.error = error;
  }

  return result;
}
