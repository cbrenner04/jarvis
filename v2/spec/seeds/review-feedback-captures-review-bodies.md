---
name: review-feedback-captures-review-bodies
---

# Review-feedback captures submitted review bodies

## Problem

`v2/src/execution/pr-review-input-capture.ts` captures inline review threads (`fetchReviewThreads`) and top-level PR comments, and reads `reviews` only for `submittedAt` gating (~:208-250). The body of a submitted review (`gh pr review --comment|--request-changes --body …`, the normal way to post findings) is dropped. Admission passes (`hasSubmittedPrReview`), the agent sees "no threads and no top-level comments", answers `no-work` with an empty response sidecar, and the round completes having addressed nothing.

## Evidence

- 2026-10-02 PR #4459: operator posted 3 findings as a review body (deadlock fix, memo, rebase); `jarvis pipeline resume 63656c6a… --address-review implement` → run `d3d1fe76` completed `no-work` in 9 s ("Captured review has no threads or comments"); operator hand-applied the fixes.

## Decisions

- Capture non-empty bodies of submitted reviews (state `COMMENTED`/`CHANGES_REQUESTED`, plus `APPROVED` with a body) as review-level items with a stable id (review id), alongside threads and comments; same truncation/pagination guards.
- Reconciliation (addressed/declined/unaddressed) treats review-body items like top-level comments.

## Acceptance criteria

- [ ] `pr-review-input-capture.test.ts`: a PR with only a submitted review body (no threads, no comments) captures one review-body item with its id and text; fails against current code.
- [ ] `review-feedback-item-reconciliation.test.ts` (or nearest): a review-body item appears in the addressed/unaddressed buckets by its id.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Review-feedback workflow: review bodies are captured.
