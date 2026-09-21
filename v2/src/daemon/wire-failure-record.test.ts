import { expect, test } from "bun:test";
import type { PipelineSnapshot } from "./pipeline-observation.ts";
import { withValidFailureRecord, withValidStageFailureRecords } from "./wire-failure-record.ts";

const RECORD = { expectation: "e", observation: "o", retryable: false, referencedPaths: [] };

function snapshotWith(...details: unknown[]): PipelineSnapshot {
  return {
    pipelineId: "p",
    name: "n",
    state: "failed",
    terminalPublicationSucceededAt: null,
    terminalPublicationFailure: null,
    createdAt: 1,
    finishedAtMs: null,
    dismissedAt: null,
    stages: details.map((failureDetail, position) => ({
      id: `s${position}`,
      stageId: `stage${position}`,
      branchKey: "default",
      position,
      status: "failed",
      workflowInvocationId: null,
      startedAt: null,
      endedAt: null,
      decidedAt: null,
      artifact: null,
      failureDetail,
    })),
  };
}

test("withValidFailureRecord keeps rows without a failure and rows with a valid record", () => {
  const bare = { a: 1 };
  expect(withValidFailureRecord(bare)).toBe(bare);
  const valid = { a: 1, failure: RECORD };
  expect(withValidFailureRecord(valid)).toBe(valid);
});

test("withValidFailureRecord drops an invalid failure, including an explicit undefined", () => {
  expect(withValidFailureRecord({ a: 1, failure: { expectation: "e" } }) as unknown).toEqual({ a: 1 });
  expect("failure" in withValidFailureRecord({ a: 1, failure: undefined })).toBeFalse();
});

test("withValidStageFailureRecords drops only record-shaped details that fail validation", () => {
  const legacy = { code: "reopen_refused", message: "m" };
  const stages = withValidStageFailureRecords(
    snapshotWith(RECORD, { ...RECORD, retryable: "yes" }, { observation: "o" }, legacy, null, "text"),
  ).stages;
  expect(stages.map((stage) => stage.failureDetail)).toEqual([RECORD, null, null, legacy, null, "text"]);
  expect(stages.map((stage) => stage.stageId)).toEqual(["stage0", "stage1", "stage2", "stage3", "stage4", "stage5"]);
});
