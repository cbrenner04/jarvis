import type { RunStatus } from "../persistence/state-store.ts";
import type { WaitRunCompletionResult, WorkflowStepListStatus } from "./daemon.ts";
import type { RunOperatorError } from "./run-operator-error.ts";

/** One workflow step on daemon `list` wire payloads. */
type DaemonWorkflowStepSnapshot = {
  stepId: string;
  role: string;
  status: WorkflowStepListStatus;
  attemptCount: number;
  terminalOutcome?: string;
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
  /** Retained implement review count; absent on non-implement workflow rows. */
  reviewPasses?: number;
  /** Retained implement review behavior; absent on non-implement workflow rows. */
  reviewBehavior?: "debate" | "light";
  workflow?: DaemonWorkflowSnapshot;
  /** Surviving worktree path; present on `blocked` rows so the operator can locate resumable work. */
  worktreePath?: string;
  /** Confirmed PR number when publication succeeded. */
  prNumber?: number;
  /** Confirmed PR URL when publication succeeded. */
  prUrl?: string;
};

/** Successful daemon `list` wire payload. */
export type DaemonListResult = { runs: DaemonListRunRow[] };

/** Parse a daemon `health` success payload; returns `undefined` when malformed. */
export function parseHealthResult(value: unknown): { ok: true } | undefined {
  if (typeof value === "object" && value !== null && (value as { ok?: unknown }).ok === true) {
    return { ok: true };
  }
  return undefined;
}

/** Parse a daemon `status` success payload; returns `undefined` when malformed. */
export function parseStatusResult(value: unknown):
  | {
      state: "running";
      loadedRevision?: string;
      loadedExecutableDigest?: string;
      recovery?: { pending: boolean; reconciled: number; resumed: number };
    }
  | undefined {
  if (typeof value === "object" && value !== null && (value as { state?: unknown }).state === "running") {
    const loadedRevision = (value as { loadedRevision?: unknown }).loadedRevision;
    const loadedExecutableDigest = (value as { loadedExecutableDigest?: unknown }).loadedExecutableDigest;
    const recovery = (value as { recovery?: unknown }).recovery;
    const parsedRecovery =
      typeof recovery === "object" &&
      recovery !== null &&
      typeof (recovery as { pending?: unknown }).pending === "boolean" &&
      typeof (recovery as { reconciled?: unknown }).reconciled === "number" &&
      typeof (recovery as { resumed?: unknown }).resumed === "number"
        ? (recovery as { pending: boolean; reconciled: number; resumed: number })
        : undefined;
    return {
      state: "running",
      ...(typeof loadedRevision === "string" ? { loadedRevision } : {}),
      ...(typeof loadedExecutableDigest === "string" ? { loadedExecutableDigest } : {}),
      ...(parsedRecovery === undefined ? {} : { recovery: parsedRecovery }),
    };
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

/**
 * Parse a daemon `list` success payload; returns `undefined` when malformed.
 *
 * Envelope-thin: the daemon is a trusted same-build process over a local Unix
 * socket, so per-row/per-step fields are not re-validated — see
 * `v2/docs/v2-architecture.md` (`## Interface & IPC`).
 */
export function parseListRuns(value: unknown): DaemonListResult | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const runs = (value as { runs?: unknown }).runs;
  if (!Array.isArray(runs)) return undefined;
  return { runs: runs as DaemonListRunRow[] };
}

/**
 * Parse a daemon `wait` success payload; returns `undefined` when malformed.
 *
 * Envelope-thin: only `runStatus` presence is checked before casting — see
 * `v2/docs/v2-architecture.md` (`## Interface & IPC`).
 */
export function parseWaitCompletion(value: unknown): WaitRunCompletionResult | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  if (record.runStatus === undefined) return undefined;
  return record as unknown as WaitRunCompletionResult;
}
