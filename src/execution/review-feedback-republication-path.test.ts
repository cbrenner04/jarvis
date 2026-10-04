import { describe, expect, test } from "bun:test";
import { REVIEW_FEEDBACK_RESPONSE_SIDECAR } from "../shared/prompts/review-feedback-write.ts";
import { resolveWorkflowCompletionPublicationSpecPath } from "./workflow-runner.ts";

describe("resolveWorkflowCompletionPublicationSpecPath", () => {
  test("review-feedback republication uses entry spec path instead of write sidecar", () => {
    const entrySpecPath = "spec/lane/index.md";
    expect(
      resolveWorkflowCompletionPublicationSpecPath({
        writeStepRunSpecPath: REVIEW_FEEDBACK_RESPONSE_SIDECAR,
        completionStepSpecPath: REVIEW_FEEDBACK_RESPONSE_SIDECAR,
        reviewFeedbackLane: {
          laneKind: "implement",
          entryRunId: "entry-1",
          entrySpecPath,
          prNumber: 7,
          prUrl: "https://example.test/7",
        },
      }),
    ).toBe(entrySpecPath);
  });

  test("non-review-feedback workflows keep write-step spec fallback", () => {
    expect(
      resolveWorkflowCompletionPublicationSpecPath({
        writeStepRunSpecPath: REVIEW_FEEDBACK_RESPONSE_SIDECAR,
        completionStepSpecPath: "spec.md",
      }),
    ).toBe(REVIEW_FEEDBACK_RESPONSE_SIDECAR);
  });
});
