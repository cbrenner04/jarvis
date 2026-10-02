# Capture submitted PR review bodies in `.jarvis-pr-review-input.json`

## Problem

`refreshPrReviewInputCapture` persists threads and post-review top-level comments but uses `reviews` from `gh pr view` only for `latestSubmittedAt` gating on top-level comments, so findings posted as a submitted review body never appear in `REVIEW_INPUT` and the write agent treats the capture as empty.

## Decisions

- Add top-level `reviewBodies` on `PrReviewInputCaptureArtifact` (`captureVersion` stays `1`) — rules out a second capture file or folding bodies into `topLevelComments`.
- Each item carries `reviewId` (GitHub review `id`), `author`, `body`, `submittedAt`, and `state` — rules out reusing `commentId` or dropping state.
- Populate from the same `gh pr view --json reviews,comments` payload already fetched for top-level comments — rules out a separate GitHub round-trip per refresh.
- Include every qualifying submitted review with a non-empty trimmed body: `submittedAt` set, non-bot author, state `COMMENTED`, `CHANGES_REQUESTED`, or `APPROVED` — rules out `latestSubmittedAt` round gating (used only for top-level comments) and rules out capturing `PENDING`/`DISMISSED` or empty-body reviews.
- Omit reviews whose author login ends with `[bot]` and reviews with empty/whitespace-only bodies — rules out treating bot review spam as actionable items.
- Sort `reviewBodies` by `submittedAt` ascending — rules out interleaving with top-level comment order.
- Extend `listCapturedReviewFeedbackItemIds` and `isCaptureArtifactShape` in `review-feedback-item-reconciliation.ts` so settlement walks `reviewBodies` after `topLevelComments`, using `reviewId` — rules out sidecar lines for review bodies that never enter reconciliation buckets.
- Treat a missing `reviewBodies` key on read as `[]` — rules out breaking reconciliation on artifacts written before this change.
- Deferred to first consumer: explicit refusal when `reviews` length exceeds a GitHub page bound — `gh pr view` returns an unpaginated array today; pin if a caller observes truncation.

## Tasks

- Extend `PrReviewInputCaptureArtifact` and `refreshPrReviewInputCapture` to fetch and persist `reviewBodies` from `reviews` on the existing `pr view` JSON parse.
- Wire `reviewBodies` into reconciliation capture-id listing and artifact shape validation.
- Add/adjust unit tests in `pr-review-input-capture.test.ts`; update reconciliation/capture fixtures that construct artifacts to include `reviewBodies` when required by typing.

## Acceptance criteria

- [x] `pr-review-input-capture.test.ts` adds a case where the PR has only a submitted review body (no threads, no top-level comments) and asserts the artifact holds one `reviewBodies` entry with the expected `reviewId` and body text; fails against current code.
- [x] `review-feedback-item-reconciliation.test.ts` stays green (`classifies addressed, declined, and unaddressed capture ids from the sidecar` and related cases unchanged aside from fixture shape).

## Documentation updates

- `v2/docs/write-behavior.md` § PR review input sidecar: document `reviewBodies`, fields, filters, and sort order alongside threads and top-level comments.
- `v2/docs/v1-behaviors.md`: note v2 capture records submitted review bodies in the lane sidecar (additive vs v1 top-level-only collection).
