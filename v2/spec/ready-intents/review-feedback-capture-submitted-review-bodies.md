---
name: review-feedback-capture-submitted-review-bodies
---

# Review-feedback capture includes submitted review bodies

## Problem

`refreshPrReviewInputCapture` persists threads and post-review top-level comments in `.jarvis-pr-review-input.json` but reads `reviews` only for `submittedAt` gating, so findings posted as a submitted review body never appear in `REVIEW_INPUT` and the write agent treats the capture as empty.

## Decisions

- Extend the capture artifact with review-body items: GitHub review `id`, author, body, `submittedAt`, and review state; omit empty bodies and bot-authored reviews.
- Include every qualifying submitted review with a non-empty body (not `latestSubmittedAt` round gating used for top-level comments); states `COMMENTED` or `CHANGES_REQUESTED`, and `APPROVED` when the body is non-empty; same non-bot and truncation/pagination refusal patterns as existing capture paths.
- Update `review-feedback.prompt.write` so the captured-input and response-sidecar sections treat review-body ids like thread and top-level comment ids.

## Acceptance criteria

- [ ] `pr-review-input-capture.test.ts`: a PR with only a submitted review body (no threads, no top-level comments) captures one review-body item with its id and text; fails against current code.
- [ ] `shared/prompts/review-feedback-write.test.ts`: rendered write prompt names review-body ids in the response sidecar contract alongside thread and comment ids; fails against current code.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md`: `.jarvis-pr-review-input.json` lists captured submitted review bodies and their stable review ids.
- `v2/docs/prompts.md`: review-feedback write step sidecar contract includes review-body ids.
- `v2/docs/workflow-runner.md`: `review-feedback` workflow sidecar line contract includes review-body ids (not only `threadId|commentId`).
- `v2/docs/v1-behaviors.md`: v2 capture records submitted review bodies in the lane sidecar (additive vs v1 top-level-only collection).

## Prerequisites
