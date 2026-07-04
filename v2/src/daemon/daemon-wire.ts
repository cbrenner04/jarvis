import { isWriteLoopOutcomeKind } from "../execution/write-loop.ts";
import { isRunStatus, type RunStatus } from "../persistence/state-store-types.ts";
import type { WaitRunCompletionResult } from "./daemon.ts";
import { isRunOperatorError, type RunOperatorError } from "./run-operator-error.ts";

const DAEMON_WORKFLOW_STEP_STATUSES = ["pending", "in_progress", "completed", "stopped"] as const;
const DAEMON_WORKFLOW_STEP_STOP_OUTCOMES = [
  "blocked",
  "contract_miss",
  "invocation_failure",
  "budget-exhausted",
  "paused",
  "killed",
] as const;

export type DaemonWorkflowStepStatus = (typeof DAEMON_WORKFLOW_STEP_STATUSES)[number];
export type DaemonWorkflowStepTerminalOutcome = "complete" | (typeof DAEMON_WORKFLOW_STEP_STOP_OUTCOMES)[number];

/** One workflow step on daemon `list` wire payloads. */
export type DaemonWorkflowStepSnapshot = {
  stepId: string;
  role: string;
  status: DaemonWorkflowStepStatus;
  attemptCount: number;
  terminalOutcome?: DaemonWorkflowStepTerminalOutcome;
};

/** Optional workflow metadata on daemon `list` rows. */
export type DaemonWorkflowSnapshot = {
  steps: DaemonWorkflowStepSnapshot[];
};

/** One durable run row on daemon `list` wire payloads. */
export type DaemonListRunRow = {
  runId: string;
  project: string;
  branch: string;
  status: RunStatus;
  isLive: boolean;
  error?: RunOperatorError;
  workflow?: DaemonWorkflowSnapshot;
};

/** Successful daemon `list` wire payload. */
export type DaemonListResult = { runs: DaemonListRunRow[] };

function isDaemonListRunRow(value: unknown): value is DaemonListRunRow {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  if (row.error !== undefined && !isRunOperatorError(row.error)) return false;
  if (row.workflow !== undefined && !isDaemonWorkflowSnapshot(row.workflow)) return false;
  return (
    typeof row.runId === "string" &&
    typeof row.project === "string" &&
    typeof row.branch === "string" &&
    isRunStatus(row.status) &&
    typeof row.isLive === "boolean"
  );
}

function isDaemonWorkflowSnapshot(value: unknown): value is DaemonWorkflowSnapshot {
  if (typeof value !== "object" || value === null) return false;
  const steps = (value as { steps?: unknown }).steps;
  return Array.isArray(steps) && steps.every(isDaemonWorkflowStepSnapshot);
}

function isDaemonWorkflowStepSnapshot(value: unknown): value is DaemonWorkflowStepSnapshot {
  if (typeof value !== "object" || value === null) return false;
  const step = value as Record<string, unknown>;
  if (
    typeof step.stepId !== "string" ||
    typeof step.role !== "string" ||
    !isDaemonWorkflowStepStatus(step.status) ||
    !isNonNegativeInteger(step.attemptCount)
  ) {
    return false;
  }

  const terminalOutcome = step.terminalOutcome;
  if (step.status === "pending" || step.status === "in_progress") {
    return terminalOutcome === undefined;
  }
  if (step.status === "completed") {
    return terminalOutcome === "complete";
  }
  return isDaemonWorkflowStoppedOutcome(terminalOutcome);
}

function isDaemonWorkflowStepStatus(value: unknown): value is DaemonWorkflowStepStatus {
  return typeof value === "string" && DAEMON_WORKFLOW_STEP_STATUSES.includes(value as DaemonWorkflowStepStatus);
}

function isDaemonWorkflowStoppedOutcome(value: unknown): value is (typeof DAEMON_WORKFLOW_STEP_STOP_OUTCOMES)[number] {
  return (
    typeof value === "string" &&
    DAEMON_WORKFLOW_STEP_STOP_OUTCOMES.includes(value as (typeof DAEMON_WORKFLOW_STEP_STOP_OUTCOMES)[number])
  );
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
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

/** Parse a daemon `wait` success payload; returns `undefined` when malformed. */
export function parseWaitCompletion(value: unknown): WaitRunCompletionResult | undefined {
  if (typeof value !== "object" || value === null) return undefined;

  const record = value as Record<string, unknown>;
  if (!isRunStatus(record.runStatus)) return undefined;

  const result: WaitRunCompletionResult = { runStatus: record.runStatus };

  if (record.loopOutcomeKind !== undefined) {
    if (!isWriteLoopOutcomeKind(record.loopOutcomeKind)) return undefined;
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
