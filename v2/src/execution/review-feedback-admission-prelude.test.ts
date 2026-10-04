import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { AsyncSubprocessError, type AsyncSubprocessRunner } from "../shared/subprocess.ts";
import { trackedMkdtempSync } from "../shared/tracked-temp-dir.test-support.ts";
import type { ReviewFeedbackLaneTarget } from "../persistence/review-feedback-lane-resolution.ts";
import { PrReviewInputTruncatedError, resolvePrReviewInputArtifactPath } from "./pr-review-input-capture.ts";
import { runReviewFeedbackAdmissionPrelude } from "./review-feedback-admission-prelude.ts";

const LANE_BRANCH = "feature/lane";
const PR_NUMBER = 42;

function sampleTarget(worktreePath: string): ReviewFeedbackLaneTarget {
  return {
    laneKind: "intent",
    project: "jarvis",
    branch: LANE_BRANCH,
    worktreePath,
    prNumber: PR_NUMBER,
    prUrl: "https://github.com/owner/repo/pull/42",
    entryRunId: "intent-entry",
    entrySpecPath: "ready-intents",
    baseRef: "main",
    provenance: { kind: "bare" },
  };
}

type AdmissionPrView = {
  state: string;
  headRefName: string;
  url: string;
  isDraft: boolean;
  reviews: Array<{ submittedAt?: string | null }>;
};

function emptyCaptureGraphql(): string {
  return JSON.stringify({
    data: { repository: { pullRequest: { reviewThreads: { nodes: [] } } } },
  });
}

function createRunner(options: { admissionView: AdmissionPrView; captureThrows?: Error }): AsyncSubprocessRunner {
  return {
    runAsync: async (cmd, args, cwd) => {
      if (cmd !== "gh") throw new Error(`unexpected command ${cmd}`);
      if (args[0] === "pr" && args[1] === "view" && args.some((arg) => arg.includes("isDraft"))) {
        return JSON.stringify(options.admissionView);
      }
      if (options.captureThrows != null) throw options.captureThrows;
      if (args[0] === "repo" && args[1] === "view") return "owner/repo\n";
      if (args[0] === "api" && args[1] === "graphql") return emptyCaptureGraphql();
      if (args[0] === "pr" && args[1] === "view" && args.includes("reviews,comments")) {
        return JSON.stringify({ reviews: options.admissionView.reviews, comments: [] });
      }
      throw new Error(`unexpected gh invocation: ${args.join(" ")} in ${cwd}`);
    },
  };
}

function openReviewedAdmissionView(overrides: Partial<AdmissionPrView> = {}): AdmissionPrView {
  return {
    state: "OPEN",
    headRefName: LANE_BRANCH,
    url: "https://github.com/owner/repo/pull/42",
    isDraft: true,
    reviews: [{ submittedAt: "2026-05-10T00:00:00Z" }],
    ...overrides,
  };
}

describe("runReviewFeedbackAdmissionPrelude", () => {
  test("succeeds for an open PR with a submitted review and refreshes capture", async () => {
    const worktreePath = trackedMkdtempSync("review-feedback-admission-ok-");
    try {
      const outcome = await runReviewFeedbackAdmissionPrelude(
        sampleTarget(worktreePath),
        createRunner({ admissionView: openReviewedAdmissionView() }),
      );
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      expect(outcome.artifact.prNumber).toBe(PR_NUMBER);
      const artifactPath = resolvePrReviewInputArtifactPath(worktreePath);
      expect(outcome.artifactPath).toBe(artifactPath);
      expect(existsSync(artifactPath)).toBe(true);
      expect(JSON.parse(readFileSync(artifactPath, "utf8")).prNumber).toBe(PR_NUMBER);
    } finally {
      rmSync(worktreePath, { recursive: true, force: true });
    }
  });

  test("refuses when the PR has no submitted review", async () => {
    const worktreePath = trackedMkdtempSync("review-feedback-admission-no-review-");
    try {
      const outcome = await runReviewFeedbackAdmissionPrelude(
        sampleTarget(worktreePath),
        createRunner({
          admissionView: openReviewedAdmissionView({ reviews: [{ submittedAt: null }, {}] }),
        }),
      );
      expect(outcome).toMatchObject({ ok: false, code: "review_feedback_pr_no_review" });
      expect(existsSync(resolvePrReviewInputArtifactPath(worktreePath))).toBe(false);
    } finally {
      rmSync(worktreePath, { recursive: true, force: true });
    }
  });

  test("refuses a non-draft PR without harness ready-flip evidence and admits draft or evidenced non-draft PRs", async () => {
    const worktreePath = trackedMkdtempSync("review-feedback-admission-not-draft-");
    const runner = createRunner({ admissionView: openReviewedAdmissionView({ isDraft: false }) });
    try {
      const refused = await runReviewFeedbackAdmissionPrelude(sampleTarget(worktreePath), runner);
      expect(refused).toMatchObject({ ok: false, code: "review_feedback_pr_not_draft" });

      const draftOk = await runReviewFeedbackAdmissionPrelude(
        sampleTarget(worktreePath),
        createRunner({ admissionView: openReviewedAdmissionView({ isDraft: true }) }),
      );
      expect(draftOk.ok).toBe(true);

      const evidencedOk = await runReviewFeedbackAdmissionPrelude(sampleTarget(worktreePath), runner, {
        findHarnessReadyFlipEvidenceInLineage: (args) =>
          args.branch === LANE_BRANCH && args.baseRef === "main" && args.prNumber === PR_NUMBER,
      });
      expect(evidencedOk.ok).toBe(true);
    } finally {
      rmSync(worktreePath, { recursive: true, force: true });
    }
  });

  test("refuses when the PR head branch does not match the resolved lane branch", async () => {
    const worktreePath = trackedMkdtempSync("review-feedback-admission-branch-");
    try {
      const outcome = await runReviewFeedbackAdmissionPrelude(
        sampleTarget(worktreePath),
        createRunner({
          admissionView: openReviewedAdmissionView({ headRefName: "other-branch" }),
        }),
      );
      expect(outcome).toMatchObject({ ok: false, code: "review_feedback_pr_branch_mismatch" });
      expect(existsSync(resolvePrReviewInputArtifactPath(worktreePath))).toBe(false);
    } finally {
      rmSync(worktreePath, { recursive: true, force: true });
    }
  });

  test("refuses when the PR is merged", async () => {
    const worktreePath = trackedMkdtempSync("review-feedback-admission-merged-");
    try {
      const outcome = await runReviewFeedbackAdmissionPrelude(
        sampleTarget(worktreePath),
        createRunner({ admissionView: openReviewedAdmissionView({ state: "MERGED" }) }),
      );
      expect(outcome).toMatchObject({ ok: false, code: "review_feedback_pr_merged" });
      expect(existsSync(resolvePrReviewInputArtifactPath(worktreePath))).toBe(false);
    } finally {
      rmSync(worktreePath, { recursive: true, force: true });
    }
  });

  test("refuses when the PR is closed", async () => {
    const worktreePath = trackedMkdtempSync("review-feedback-admission-closed-");
    try {
      const outcome = await runReviewFeedbackAdmissionPrelude(
        sampleTarget(worktreePath),
        createRunner({ admissionView: openReviewedAdmissionView({ state: "CLOSED" }) }),
      );
      expect(outcome).toMatchObject({ ok: false, code: "review_feedback_pr_closed" });
      expect(existsSync(resolvePrReviewInputArtifactPath(worktreePath))).toBe(false);
    } finally {
      rmSync(worktreePath, { recursive: true, force: true });
    }
  });

  test("refuses when capture throws", async () => {
    const worktreePath = trackedMkdtempSync("review-feedback-admission-capture-");
    try {
      const outcome = await runReviewFeedbackAdmissionPrelude(
        sampleTarget(worktreePath),
        createRunner({
          admissionView: openReviewedAdmissionView(),
          captureThrows: new PrReviewInputTruncatedError("review threads"),
        }),
      );
      expect(outcome).toMatchObject({ ok: false, code: "review_feedback_capture_failed" });
      if (outcome.ok) return;
      expect(outcome.message).toContain("review threads");
      expect(existsSync(resolvePrReviewInputArtifactPath(worktreePath))).toBe(false);
    } finally {
      rmSync(worktreePath, { recursive: true, force: true });
    }
  });

  test("refuses when gh pr view fails", async () => {
    const worktreePath = trackedMkdtempSync("review-feedback-admission-gh-view-");
    const runner: AsyncSubprocessRunner = {
      runAsync: async (cmd, args) => {
        if (cmd === "gh" && args[0] === "pr" && args[1] === "view") {
          throw new AsyncSubprocessError("gh failed", 1, "", "gh: not found", undefined);
        }
        throw new Error(`unexpected gh invocation: ${args.join(" ")}`);
      },
    };
    try {
      const outcome = await runReviewFeedbackAdmissionPrelude(sampleTarget(worktreePath), runner);
      expect(outcome).toMatchObject({ ok: false, code: "review_feedback_capture_failed" });
      if (outcome.ok) return;
      expect(outcome.message).toContain("gh: not found");
    } finally {
      rmSync(worktreePath, { recursive: true, force: true });
    }
  });
});
