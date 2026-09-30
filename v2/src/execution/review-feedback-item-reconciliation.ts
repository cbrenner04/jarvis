import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REVIEW_FEEDBACK_RESPONSE_SIDECAR } from "../../../shared/prompts/review-feedback-write.ts";
import { type PrReviewInputCaptureArtifact, resolvePrReviewInputArtifactPath } from "./pr-review-input-capture.ts";

export type ReviewFeedbackItemReconciliation = {
  reviewFeedbackAddressedItemIds: string[];
  reviewFeedbackDeclinedItemIds: string[];
  reviewFeedbackUnaddressedItemIds: string[];
};

const EMPTY_RECONCILIATION: ReviewFeedbackItemReconciliation = {
  reviewFeedbackAddressedItemIds: [],
  reviewFeedbackDeclinedItemIds: [],
  reviewFeedbackUnaddressedItemIds: [],
};

const ADDRESSED_LINE = /^- (.+): addressed\s*$/;
const DECLINED_LINE = /^- (.+): declined:/;

export function listCapturedReviewFeedbackItemIds(artifact: PrReviewInputCaptureArtifact): string[] {
  const ids: string[] = [];
  for (const thread of artifact.threads) {
    ids.push(thread.threadId);
  }
  for (const comment of artifact.topLevelComments) {
    ids.push(comment.commentId);
  }
  return ids;
}

export function parseReviewFeedbackResponseSidecar(content: string): Map<string, "addressed" | "declined"> {
  const byId = new Map<string, "addressed" | "declined">();
  for (const line of content.split("\n")) {
    const declinedMatch = line.match(DECLINED_LINE);
    if (declinedMatch?.[1] !== undefined) {
      byId.set(declinedMatch[1], "declined");
      continue;
    }
    const addressedMatch = line.match(ADDRESSED_LINE);
    if (addressedMatch?.[1] !== undefined && byId.get(addressedMatch[1]) !== "declined") {
      byId.set(addressedMatch[1], "addressed");
    }
  }
  return byId;
}

export function reconcileReviewFeedbackItems(args: {
  captureArtifact: PrReviewInputCaptureArtifact;
  sidecarContent: string | null;
}): ReviewFeedbackItemReconciliation {
  const capturedIds = listCapturedReviewFeedbackItemIds(args.captureArtifact);
  if (args.sidecarContent === null) {
    return {
      reviewFeedbackAddressedItemIds: [],
      reviewFeedbackDeclinedItemIds: [],
      reviewFeedbackUnaddressedItemIds: [...capturedIds],
    };
  }
  const sidecar = parseReviewFeedbackResponseSidecar(args.sidecarContent);
  const addressed: string[] = [];
  const declined: string[] = [];
  const unaddressed: string[] = [];
  for (const id of capturedIds) {
    const classification = sidecar.get(id);
    if (classification === "declined") {
      declined.push(id);
    } else if (classification === "addressed") {
      addressed.push(id);
    } else {
      unaddressed.push(id);
    }
  }
  return {
    reviewFeedbackAddressedItemIds: addressed,
    reviewFeedbackDeclinedItemIds: declined,
    reviewFeedbackUnaddressedItemIds: unaddressed,
  };
}

function tryReadCaptureArtifact(laneWorktreePath: string): PrReviewInputCaptureArtifact | null {
  try {
    const raw = readFileSync(resolvePrReviewInputArtifactPath(laneWorktreePath), "utf8");
    return JSON.parse(raw) as PrReviewInputCaptureArtifact;
  } catch {
    return null;
  }
}

function tryReadResponseSidecar(laneWorktreePath: string): string | null {
  try {
    return readFileSync(join(laneWorktreePath, REVIEW_FEEDBACK_RESPONSE_SIDECAR), "utf8");
  } catch {
    return null;
  }
}

export function reconcileReviewFeedbackItemsAtLaneWorktree(laneWorktreePath: string): ReviewFeedbackItemReconciliation {
  const artifact = tryReadCaptureArtifact(laneWorktreePath);
  if (artifact === null) {
    return { ...EMPTY_RECONCILIATION };
  }
  return reconcileReviewFeedbackItems({
    captureArtifact: artifact,
    sidecarContent: tryReadResponseSidecar(laneWorktreePath),
  });
}
