import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { Attempt, OutcomeKind, Run, RunStatus } from "../persistence/state-store.ts";

export type WorkBoundaryRecordedRecord = {
  schema_version: 1;
  record_kind: "work_boundary_recorded";
  ts: string;
  run_id: string;
  attempt_id: string;
  outcome_kind: OutcomeKind;
  run_status: RunStatus;
  commit_sha: string;
  files_changed: number;
};

export const DEFAULT_TELEMETRY_SINK_PATH = join(homedir(), ".jarvis", "telemetry.jsonl");

export type BoundaryTelemetryContext = {
  sinkPath?: string;
};

export type BoundaryStamp = {
  runId: string;
  attemptId: string;
  outcomeKind: OutcomeKind;
  runStatus: RunStatus;
};

/** Append one `work_boundary_recorded` row to the JSONL sink at `sinkPath`. */
export function appendWorkBoundaryRecorded(
  sinkPath: string,
  record: Omit<WorkBoundaryRecordedRecord, "schema_version" | "record_kind" | "ts">,
): void {
  mkdirSync(dirname(sinkPath), { recursive: true });
  const line: WorkBoundaryRecordedRecord = {
    schema_version: 1,
    record_kind: "work_boundary_recorded",
    ts: new Date().toISOString(),
    ...record,
  };
  appendFileSync(sinkPath, `${JSON.stringify(line)}\n`, "utf8");
}

export function resolveTelemetrySinkPath(sinkPath?: string): string {
  return sinkPath ?? DEFAULT_TELEMETRY_SINK_PATH;
}

/** Join keys from the last committed attempt on a stored run. */
export function boundaryStampFromStoredRun(
  run: Run & { attempts: Attempt[] },
): Pick<BoundaryStamp, "attemptId" | "outcomeKind" | "runStatus"> | undefined {
  const lastAttempt = run.attempts.at(-1);
  if (lastAttempt?.outcomeKind === null || lastAttempt?.outcomeKind === undefined) {
    return undefined;
  }
  return {
    attemptId: lastAttempt.id,
    outcomeKind: lastAttempt.outcomeKind,
    runStatus: run.status,
  };
}

/**
 * Append a boundary row when telemetry is attached. Returns an error message on
 * append failure without throwing.
 */
export function emitWorkBoundaryRecorded(
  telemetry: BoundaryTelemetryContext | undefined,
  stamp: BoundaryStamp,
  commit: { commitSha: string; filesChanged: number },
): string | undefined {
  if (telemetry === undefined) return undefined;
  try {
    appendWorkBoundaryRecorded(resolveTelemetrySinkPath(telemetry.sinkPath), {
      run_id: stamp.runId,
      attempt_id: stamp.attemptId,
      outcome_kind: stamp.outcomeKind,
      run_status: stamp.runStatus,
      commit_sha: commit.commitSha,
      files_changed: commit.filesChanged,
    });
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}
