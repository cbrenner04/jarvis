---
name: review-feedback-matches-linked-implement-lanes
---

# Review-feedback matches linked implement lanes

## Problem

`jarvis run workflow review-feedback --branch <lane>` refuses `review_feedback_lane_unmatched` on a completed linked-implement lane whose PR is open with a submitted review. `resolveBareReviewFeedbackLane` (`v2/src/persistence/review-feedback-lane-resolution.ts` ~:177) only considers `isEntryRunRow` rows and needs PR evidence on the matched entry; on a linked lane the rows are `implement~link-N`, `implement~shrink`, and `implement-review`, and only the review row carries `pr_number`/`pr_url`.

## Evidence

- 2026-10-02, PR #4440 (branch `20261002T061748Z-workflow-terminal-waits-for-all-rows`): rows `0f5274bf implement~link-0 completed (no PR)`, `0dbac1bb implement~shrink completed`, `6b0a4108 implement-review completed pr=4440 (ready-flip evidence)`. Review posted; `review-feedback --branch` refused `review_feedback_lane_unmatched`; operator hand-applied the four review items.

## Decisions

- Lane resolution treats a linked implement invocation as one lane: entry identity is the invocation's first durable row (`implement~link-0` when no plain `implement` row exists), and PR evidence is taken from any completed row of the same invocation (latest wins).
- Dispatch and republication target the same worktree and PR as today; no new flags.

## Acceptance criteria

- [ ] `review-feedback-lane-resolution.test.ts`: a completed linked lane (`~link-0` + `~shrink` + `implement-review` carrying `prNumber`/`prUrl`) resolves to one target with that PR; fails against current code (`review_feedback_lane_unmatched`).
- [ ] Same file: two completed invocations on one branch still refuse `review_feedback_lane_ambiguous`.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Review-feedback workflow: `review_feedback_lane_unmatched` row no longer applies to linked lanes.
