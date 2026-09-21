import type { OperatorFailureRecord } from "../../../shared/operator-failure-record.ts";

/** Terminal stage failure record for a path with no inspected file: expectation, observed error text, honest retryability. */
export function buildStageFailureRecord(
  expectation: string,
  observed: unknown,
  retryable: boolean,
): OperatorFailureRecord {
  return {
    expectation,
    observation: observed instanceof Error ? observed.message : String(observed),
    retryable,
    referencedPaths: [],
  };
}
