---
name: review-feedback-matches-linked-implement-lanes
---

# Review-feedback matches linked implement lanes

Unsplit rationale: bare and pipeline review-feedback lane admission both resolve through `review-feedback-lane-resolution.ts` only; PR evidence already uses `resolvePrEvidenceAcrossInvocation` from pipeline settlement with no seed-mandated change there.

## Problem

`jarvis run workflow review-feedback --branch <lane>` refuses `review_feedback_lane_unmatched` on a completed linked-implement lane whose PR is open with a submitted review. Pipeline `--pipeline` / `--stage` admission hits the same gap: `resolvePipelineStageIdentifiedReviewFeedbackLane` rejects the stage's `workflowInvocationId` row when `isEntryRunRow` is false (`implement~link-0` vs snapshot `steps[0].stepId` `implement`). Bare `resolveBareReviewFeedbackLane` never considers those invocations because it only enumerates `isEntryRunRow` rows; PR evidence on `implement-review` is invisible when no plain `implement` row exists.

## Decisions

- Entry run identity matches `resolveInvocationEntryRunId` in `stage-settlement-owner.ts`: sibling whose `stepId` equals `workflowSnapshot.steps[0].stepId`, else earliest-created row from `findRunsByInvocationId` (linked implement's first row is `<firstStepId>~link-0`; `~link-1+` and tail steps are not separate lane entries). Share or mirror that predicate in lane resolution; do not invent a second ordering.
- Bare `--branch`: enumerate distinct invocation entry runs on the branch (one per `invocationId`), then existing completed-lane + `resolvePrEvidenceAcrossInvocation` rules; ambiguous when more than one such lane qualifies.
- Pipeline: keep loading `store.loadRun(stageRow.workflowInvocationId)`; replace the `isEntryRunRow(entryRun)` refusal with the same entry predicate so stages linked to `implement~link-0` admit when rollup and PR evidence succeed.
- Dispatch and republication target the same worktree and PR as today; no new flags.

## Acceptance criteria

- [ ] `review-feedback-lane-resolution.test.ts` bare mode: completed linked implement (`implement~link-0`, `implement~shrink`, `implement-review` with `prNumber`/`prUrl` on the review row) resolves to one target with that PR; fails against pre-fix (`review_feedback_lane_unmatched`).
- [ ] Same file pipeline mode: succeeded implement stage whose `workflowInvocationId` is the `implement~link-0` row (snapshot `steps[0].stepId` `implement`) resolves with that PR; fails against pre-fix (`review_feedback_lane_unmatched`).
- [ ] `review-feedback-lane-resolution.test.ts` `refuses ambiguous bare branch` stays green; same file adds two completed linked-implement invocations on one branch → `review_feedback_lane_ambiguous`.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Review-feedback workflow: `review_feedback_lane_unmatched` row no longer applies to linked implement lanes (bare or pipeline).
- `v2/docs/v1-behaviors.md`: linked implement lanes are eligible for review-feedback lane resolution; `review_feedback_lane_unmatched` no longer covers a completed linked lane with PR evidence on a sibling row.

## Primary implementation surface

- `v2/src/persistence/review-feedback-lane-resolution.ts`

## Prerequisites
