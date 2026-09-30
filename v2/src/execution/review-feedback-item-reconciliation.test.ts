import { describe, expect, test } from "bun:test";
import { rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { trackedMkdtempSync } from "../../../shared/tracked-temp-dir.test-support.ts";
import { type PrReviewInputCaptureArtifact, resolvePrReviewInputArtifactPath } from "./pr-review-input-capture.ts";
import {
  reconcileReviewFeedbackItems,
  reconcileReviewFeedbackItemsAtLaneWorktree,
} from "./review-feedback-item-reconciliation.ts";

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

  test("reconcileReviewFeedbackItemsAtLaneWorktree returns empty buckets when capture artifact is absent", () => {
    const laneWorktreePath = trackedMkdtempSync(join(tmpdir(), "review-feedback-reconcile-no-artifact-"));
    try {
      const result = reconcileReviewFeedbackItemsAtLaneWorktree(laneWorktreePath);
      expect(result).toEqual({
        reviewFeedbackAddressedItemIds: [],
        reviewFeedbackDeclinedItemIds: [],
        reviewFeedbackUnaddressedItemIds: [],
      });
    } finally {
      rmSync(laneWorktreePath, { recursive: true, force: true });
    }
  });

  test("reconcileReviewFeedbackItemsAtLaneWorktree reads capture artifact from the lane worktree", () => {
    const laneWorktreePath = trackedMkdtempSync(join(tmpdir(), "review-feedback-reconcile-with-artifact-"));
    try {
      writeFileSync(resolvePrReviewInputArtifactPath(laneWorktreePath), `${JSON.stringify(sampleCapture())}\n`, "utf8");
      const result = reconcileReviewFeedbackItemsAtLaneWorktree(laneWorktreePath);
      expect(result.reviewFeedbackUnaddressedItemIds).toEqual(["thread-a", "thread-b", "comment-c"]);
    } finally {
      rmSync(laneWorktreePath, { recursive: true, force: true });
    }
  });
});
