import {
  AsyncSubprocessError,
  type AsyncSubprocessRunner,
  networkSubprocessOptions,
} from "../../../shared/subprocess.ts";
import type { ReviewFeedbackLaneTarget } from "../persistence/review-feedback-lane-resolution.ts";
import {
  hasSubmittedPrReview,
  type PrReviewInputCaptureArtifact,
  refreshPrReviewInputCapture,
  resolvePrReviewInputArtifactPath,
} from "./pr-review-input-capture.ts";

export type ReviewFeedbackAdmissionRefusalCode =
  | "review_feedback_pr_branch_mismatch"
  | "review_feedback_pr_no_review"
  | "review_feedback_pr_merged"
  | "review_feedback_pr_closed"
  | "review_feedback_capture_failed";

export type ReviewFeedbackAdmissionPreludeResult =
  | { ok: true; artifact: PrReviewInputCaptureArtifact; artifactPath: string }
  | { ok: false; code: ReviewFeedbackAdmissionRefusalCode; message: string };

type GhPrAdmissionView = {
  state?: string;
  headRefName?: string;
  url?: string;
  reviews?: Array<{ submittedAt?: string | null }>;
};

function refuse(code: ReviewFeedbackAdmissionRefusalCode, message: string): ReviewFeedbackAdmissionPreludeResult {
  return { ok: false, code, message };
}

function captureFailedMessage(context: string, error: unknown): string {
  if (error instanceof AsyncSubprocessError) {
    const detail = error.stderr.trim() || error.stdout.trim() || error.message;
    return `${context}: ${detail}`;
  }
  if (error instanceof Error) return `${context}: ${error.message}`;
  return `${context}: ${String(error)}`;
}

async function fetchPrAdmissionView(
  runner: AsyncSubprocessRunner,
  worktreePath: string,
  prNumber: number,
): Promise<GhPrAdmissionView> {
  const stdout = await runner.runAsync(
    "gh",
    ["pr", "view", String(prNumber), "--json", "state,headRefName,url,reviews"],
    worktreePath,
    networkSubprocessOptions(),
  );
  return JSON.parse(stdout) as GhPrAdmissionView;
}

export async function runReviewFeedbackAdmissionPrelude(
  target: ReviewFeedbackLaneTarget,
  runner: AsyncSubprocessRunner,
): Promise<ReviewFeedbackAdmissionPreludeResult> {
  let view: GhPrAdmissionView;
  try {
    view = await fetchPrAdmissionView(runner, target.worktreePath, target.prNumber);
  } catch (error) {
    return refuse(
      "review_feedback_capture_failed",
      captureFailedMessage(`gh pr view ${target.prNumber} failed`, error),
    );
  }

  const state = view.state ?? "";
  if (state === "MERGED") {
    return refuse("review_feedback_pr_merged", `PR #${target.prNumber} is merged`);
  }
  if (state === "CLOSED") {
    return refuse("review_feedback_pr_closed", `PR #${target.prNumber} is closed`);
  }
  if (state !== "OPEN") {
    return refuse(
      "review_feedback_capture_failed",
      `PR #${target.prNumber} is not open (state=${JSON.stringify(state)})`,
    );
  }

  if (view.headRefName !== target.branch) {
    return refuse(
      "review_feedback_pr_branch_mismatch",
      `PR #${target.prNumber} head branch ${JSON.stringify(view.headRefName)} does not match lane branch ${JSON.stringify(target.branch)}`,
    );
  }

  if (!hasSubmittedPrReview(view.reviews ?? [])) {
    return refuse("review_feedback_pr_no_review", `PR #${target.prNumber} has no submitted review`);
  }

  try {
    const artifact = await refreshPrReviewInputCapture({
      laneWorktreePath: target.worktreePath,
      prNumber: target.prNumber,
      runner,
    });
    return {
      ok: true,
      artifact,
      artifactPath: resolvePrReviewInputArtifactPath(target.worktreePath),
    };
  } catch (error) {
    return refuse("review_feedback_capture_failed", captureFailedMessage("review feedback capture failed", error));
  }
}
