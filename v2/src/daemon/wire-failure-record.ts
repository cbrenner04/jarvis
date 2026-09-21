import { operatorFailureRecordFromUnknown } from "../../../shared/operator-failure-record.ts";
import type { PipelineSnapshot } from "./pipeline-observation.ts";

const RECORD_KEYS = ["expectation", "observation", "nearMiss", "retryable", "referencedPaths"];

/** Copy of `row` without an invalid `failure` record; other fields and valid records pass through unchanged. */
export function withValidFailureRecord<T extends object>(row: T): T {
  if (!Object.hasOwn(row, "failure")) return row;
  const { failure, ...rest } = row as T & { failure?: unknown };
  return operatorFailureRecordFromUnknown(failure) === undefined ? (rest as T) : row;
}

/**
 * Stage `failureDetail` also carries non-record payloads, so only a value that claims record fields
 * yet fails validation is dropped (to the absent `null`).
 */
function stageFailureDetailFromWire(value: unknown): unknown {
  if (typeof value !== "object" || value === null) return value;
  if (!RECORD_KEYS.some((key) => Object.hasOwn(value, key))) return value;
  return operatorFailureRecordFromUnknown(value) === undefined ? null : value;
}

/** Snapshot with every stage's malformed failure record dropped; siblings and other stage fields survive. */
export function withValidStageFailureRecords(snapshot: PipelineSnapshot): PipelineSnapshot {
  return {
    ...snapshot,
    stages: snapshot.stages.map((stage) => ({
      ...stage,
      failureDetail: stageFailureDetailFromWire(stage.failureDetail),
    })),
  };
}
