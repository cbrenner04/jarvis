# PR review gate and capture prelude for review-feedback admission

## Problem

A resolved lane target still needs an open, reviewed PR and a refreshed `.jarvis-pr-review-input.json` before review-feedback write dispatch.

## Prerequisites

- Subspec `00-review-feedback-lane-resolution.md` (provides `ReviewFeedbackLaneTarget`).

## Decisions

- PR identity: `gh pr view <prNumber> --json state,headRefName,url,reviews` with `cwd` = resolved `worktreePath`; persisted `prNumber` selects the PR, `headRefName` must equal resolved `branch`, and `state` must be `OPEN` before capture — rules out binding on merged/closed checks alone while the number points at a different branch or the wrong PR.
- `gh` not found / nonzero exit for that view → `review_feedback_capture_failed` with stderr context; `headRefName` mismatch → `review_feedback_pr_branch_mismatch` — rules out silently refreshing capture against another branch's PR.
- At least one submitted PR review must exist on that view payload (`submittedAt` set on some review); review threads alone without a submitted review → `review_feedback_pr_no_review` — rules out admitting feedback before any reviewer submission.
- Export a shared pure `hasSubmittedPrReview` (or equivalent) from `pr-review-input-capture.ts` implementing the same predicate prelude uses; prelude owns the admission gate and `refreshPrReviewInputCapture` must not skip refresh based on review presence — rules out duplicate predicates drifting apart or capture weakening the gate.
- Merged or closed PR → `review_feedback_pr_merged` or `review_feedback_pr_closed` respectively (distinct codes) — rules out collapsing terminal PR states into one message.
- After gates pass, admission calls `refreshPrReviewInputCapture` from `pr-review-input-capture.ts` with the resolved `worktreePath` and validated `prNumber`; any thrown error (including `PrReviewInputTruncatedError` and `gh` failures) maps to `review_feedback_capture_failed` with stderr context in the operator message — rules out starting a write step with a missing or stale sidecar.
- This subspec exports a single `runReviewFeedbackAdmissionPrelude(target, runner)` (name may vary) returning success or a refusal; it does not register CLI or daemon handlers — rules out duplicating capture logic outside the existing capture module.
- Deferred to first consumer: whether zero actionable captured items after a successful refresh should refuse admission — pin when the review-feedback write prompt is authored (sibling `review-feedback-write-run` intent).

## Tasks

- Add prelude module composing PR/review checks then `refreshPrReviewInputCapture`.
- Add unit tests with mocked `gh` fixtures for open reviewed PR success, head-branch mismatch, no review, merged, closed, and capture failure.
- Wire no CLI/daemon changes in this subspec.

## Acceptance criteria

- [x] `review-feedback-admission-prelude.test.ts` test `succeeds for an open PR with a submitted review and refreshes capture` fails against the pre-fix code and passes after implementation.
- [x] Tests `refuses when the PR has no submitted review`, `refuses when the PR head branch does not match the resolved lane branch`, `refuses when the PR is merged`, `refuses when the PR is closed`, and `refuses when capture throws` each assert the documented refusal code and fail against the pre-fix code.
- [x] `bun run typecheck` passes.
- [x] `bun run test:v2` passes.

## Documentation updates

- None (operator catalog in subspec `02`; capture sidecar remains documented in `write-behavior.md`).
