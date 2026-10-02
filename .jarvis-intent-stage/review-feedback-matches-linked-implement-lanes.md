---
name: review-feedback-matches-linked-implement-lanes
---

# Review-feedback matches linked implement lanes

Unsplit rationale: bare and pipeline review-feedback lane admission both resolve through `review-feedback-lane-resolution.ts` only; PR evidence already uses `resolvePrEvidenceAcrossInvocation` from pipeline settlement with no seed-mandated change there.

## Problem

`jarvis run workflow review-feedback --branch <lane>` refuses `review_feedback_lane_unmatched` on a completed linked-implement lane whose PR is open with a submitted review. `resolveBareReviewFeedbackLane` only considers `isEntryRunRow` rows; linked invocations persist `implement~link-0`, `implement~shrink`, and `implement-review`, and only the review row carries `prNumber`/`prUrl` when `implement~link-0` does not pass the entry-row filter.

## Decisions

- Lane resolution treats a linked implement invocation as one lane: entry identity is the invocation's first durable row (`implement~link-0` when no plain `implement` row exists), and PR evidence is taken from any completed row of the same invocation via existing `resolvePrEvidenceAcrossInvocation` ordering (entry, then siblings with both `prNumber` and `prUrl`).
- Dispatch and republication target the same worktree and PR as today; no new flags.

## Acceptance criteria

- [ ] `review-feedback-lane-resolution.test.ts`: a completed linked lane (`~link-0` + `~shrink` + `implement-review` carrying `prNumber`/`prUrl`) resolves to one target with that PR; fails against current code (`review_feedback_lane_unmatched`).
- [ ] Same file: two completed invocations on one branch still refuse `review_feedback_lane_ambiguous`.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Review-feedback workflow: `review_feedback_lane_unmatched` row no longer applies to linked lanes.

## Primary implementation surface

- `v2/src/persistence/review-feedback-lane-resolution.ts`

## Prerequisites
