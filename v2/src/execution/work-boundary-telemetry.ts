import { join } from "node:path";
import { errorMessage } from "../../../shared/error-message.ts";
import { jarvisHome } from "../paths.ts";
import type { Attempt, OutcomeKind, Run, RunStatus } from "../persistence/state-store.ts";
import { appendTelemetryJsonlLine } from "./telemetry-sink.ts";

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

/** Resolved per-call so the test preload's `JARVIS_HOME` is honored. */
export function defaultTelemetrySinkPath(): string {
  return join(jarvisHome(), "telemetry.jsonl");
}

type BoundaryTelemetryContext = {
  sinkPath?: string;
  clock?: () => Date;
};

export type BoundaryStamp = {
  runId: string;
  attemptId: string;
  outcomeKind: OutcomeKind;
  runStatus: RunStatus;
};

/** Append one `work_boundary_recorded` row to the JSONL sink at `sinkPath`. */
function appendWorkBoundaryRecorded(
  sinkPath: string,
  record: Omit<WorkBoundaryRecordedRecord, "schema_version" | "record_kind" | "ts">,
  injectableClock?: () => Date,
): void {
  const clock = injectableClock ?? (() => new Date());
  appendTelemetryJsonlLine(
    sinkPath,
    JSON.stringify({
      schema_version: 1,
      record_kind: "work_boundary_recorded",
      ts: clock().toISOString(),
      ...record,
    } satisfies WorkBoundaryRecordedRecord),
    { clock },
  );
}

function resolveTelemetrySinkPath(sinkPath?: string): string {
  return sinkPath ?? defaultTelemetrySinkPath();
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
    appendWorkBoundaryRecorded(
      resolveTelemetrySinkPath(telemetry.sinkPath),
      {
        run_id: stamp.runId,
        attempt_id: stamp.attemptId,
        outcome_kind: stamp.outcomeKind,
        run_status: stamp.runStatus,
        commit_sha: commit.commitSha,
        files_changed: commit.filesChanged,
      },
      telemetry.clock,
    );
    return undefined;
  } catch (error) {
    return errorMessage(error);
  }
}
