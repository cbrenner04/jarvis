import { describe, expect, test } from "bun:test";
import type { PrReviewInputCaptureArtifact } from "./pr-review-input-capture.ts";
import { reconcileReviewFeedbackItems } from "./review-feedback-item-reconciliation.ts";

function sampleCapture(): PrReviewInputCaptureArtifact {
  return {
    captureVersion: 1,
    prNumber: 1,
    threads: [
      { threadId: "thread-a", outdated: false, comments: [] },
      { threadId: "thread-b", outdated: false, comments: [] },
    ],
    topLevelComments: [{ commentId: "comment-c", author: "bot", body: "n", createdAt: "2020-01-01T00:00:00Z" }],
  };
}

describe("review-feedback item reconciliation", () => {
  test("classifies addressed, declined, and unaddressed capture ids from the sidecar", () => {
    const sidecar = ["- thread-a: addressed", "- thread-b: declined: wontfix", "- ghost-id: addressed"].join("\n");
    const result = reconcileReviewFeedbackItems({
      captureArtifact: sampleCapture(),
      sidecarContent: sidecar,
    });
    expect(result.reviewFeedbackAddressedItemIds).toEqual(["thread-a"]);
    expect(result.reviewFeedbackDeclinedItemIds).toEqual(["thread-b"]);
    expect(result.reviewFeedbackUnaddressedItemIds).toEqual(["comment-c"]);
    expect(result.reviewFeedbackAddressedItemIds).not.toContain("ghost-id");
    expect(result.reviewFeedbackDeclinedItemIds).not.toContain("ghost-id");
    expect(result.reviewFeedbackUnaddressedItemIds).not.toContain("ghost-id");
  });

  test("classifies every captured id unaddressed when the response sidecar is missing", () => {
    const result = reconcileReviewFeedbackItems({
      captureArtifact: sampleCapture(),
      sidecarContent: null,
    });
    expect(result.reviewFeedbackAddressedItemIds).toEqual([]);
    expect(result.reviewFeedbackDeclinedItemIds).toEqual([]);
    expect(result.reviewFeedbackUnaddressedItemIds).toEqual(["thread-a", "thread-b", "comment-c"]);
  });

  test("treats an id with both addressed and declined lines as declined", () => {
    const sidecar = "- thread-a: addressed\n- thread-a: declined: superseded\n";
    const result = reconcileReviewFeedbackItems({
      captureArtifact: sampleCapture(),
      sidecarContent: sidecar,
    });
    expect(result.reviewFeedbackDeclinedItemIds).toContain("thread-a");
    expect(result.reviewFeedbackAddressedItemIds).not.toContain("thread-a");
  });
});
