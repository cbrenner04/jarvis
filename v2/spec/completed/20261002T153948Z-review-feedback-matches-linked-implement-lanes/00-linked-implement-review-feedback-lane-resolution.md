# Linked implement lanes in review-feedback resolution

## Problem

Bare `resolveBareReviewFeedbackLane` only considers runs where `isEntryRunRow` is true (`stepId === workflowSnapshot.steps[0].stepId`). Linked implement's first durable row is `implement~link-0`, so completed linked lanes with PR evidence on `implement-review` never match and admission returns `review_feedback_lane_unmatched`. Pipeline `resolvePipelineStageIdentifiedReviewFeedbackLane` loads `stageRow.workflowInvocationId` (often the same `implement~link-0` id) and refuses when `!isEntryRunRow(entryRun)` with the same code.

## Decisions

- Invocation entry-run identity matches `resolveInvocationEntryRunId` in `stage-settlement-owner.ts`: sibling row whose `stepId` equals `workflowSnapshot.steps[0].stepId`, else earliest-created row from `findRunsByInvocationId` — rules out a second ordering or keeping `isEntryRunRow` as the sole admission gate for linked invocations.
- Implement entry-run resolution in one shared persistence helper imported by `review-feedback-lane-resolution.ts` and `stage-settlement-owner.ts` (extract from settlement owner and re-export there if needed) — rules out a copied predicate in lane resolution alone that can drift from settlement.
- Bare `--branch`: collect distinct `invocationId` values on `(project, branch)`, resolve each invocation's entry run once, then apply existing `bareLaneKindFromFirstStep`, `completedLaneMatch`, and ambiguity rules — rules out enumerating only rows that pass `isEntryRunRow` today.
- Pipeline `--pipeline` / `--stage` / `pipeline_stage`: after `loadRun(stageRow.workflowInvocationId)`, canonicalize to that invocation's entry run via the same predicate before `completedLaneMatch`; drop the `!isEntryRunRow(entryRun)` refusal — rules out rejecting succeeded implement stages whose stage row id is any invocation sibling (e.g. `implement~link-0` or `implement-review`).
- `resolvePrEvidenceAcrossInvocation`, dispatch worktree/PR targeting, and refusal codes outside this gap stay unchanged — rules out new flags or alternate republication paths.
- Two completed eligible linked-implement invocations on one bare branch still refuse `review_feedback_lane_ambiguous` — rules out picking an arbitrary invocation when both qualify.
- Bare `--branch` with two eligible invocations (e.g. one plain `implement` and one completed linked implement) returns `review_feedback_lane_ambiguous` — rules out silently preferring one lane kind.

## Tasks

- Extract shared invocation entry-run resolution into persistence (e.g. alongside lane/settlement helpers); import from `review-feedback-lane-resolution.ts` and replace inline logic in `stage-settlement-owner.ts` (re-export from settlement owner if existing importers need the symbol); align with `resolveInvocationEntryRunId` coverage in `stage-settlement-owner.test.ts`.
- Update bare lane enumeration and pipeline stage admission in `review-feedback-lane-resolution.ts` to use canonical entry runs.
- Extend `review-feedback-lane-resolution.test.ts` with linked-implement fixtures (`implement~link-0`, shrink/review siblings, PR fields on the review row); assert `entryRunId` and `entrySpecPath` on success targets, not only PR fields.
- Update operator docs for `review_feedback_lane_unmatched`, mixed-invocation bare ambiguity, and v1 parity catalog entry for linked implement eligibility.

## Acceptance criteria

- [x] `review-feedback-lane-resolution.test.ts` bare-mode test for a completed linked implement lane (`implement~link-0` plus siblings with PR evidence on the review row) resolves to one target with that PR, canonical `entryRunId` `implement~link-0`, and the invocation's entry spec path; it fails against the pre-fix code with `review_feedback_lane_unmatched`.
- [x] `review-feedback-lane-resolution.test.ts` pipeline-mode test for a succeeded implement stage whose `workflowInvocationId` is the linked `implement~link-0` row (snapshot first step `implement`) resolves with that PR, canonical `entryRunId` `implement~link-0`, and entry spec path; it fails against the pre-fix code with `review_feedback_lane_unmatched`.
- [x] `review-feedback-lane-resolution.test.ts` pipeline-mode test for a succeeded implement stage whose `workflowInvocationId` is a non–`link-0` sibling (e.g. `implement-review`) resolves with the same PR and canonical `entryRunId` `implement~link-0`; it fails against the pre-fix code with `review_feedback_lane_unmatched`.
- [x] `review-feedback-lane-resolution.test.ts` `refuses ambiguous bare branch` stays green.
- [x] `review-feedback-lane-resolution.test.ts` `refuses non intent-plan-implement workflow kind` stays green.
- [x] `review-feedback-lane-resolution.test.ts` adds coverage where two completed linked-implement invocations on one branch refuse `review_feedback_lane_ambiguous`; it fails against the pre-fix code.
- [x] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Review-feedback workflow: clarify that `review_feedback_lane_unmatched` no longer applies to a completed linked implement lane (bare or pipeline) when rollup and PR evidence resolve across the invocation; state that bare `--branch` with two eligible invocations (e.g. one plain `implement` and one completed linked implement) returns `review_feedback_lane_ambiguous`.
- `v2/docs/v1-behaviors.md` § Review-feedback command: record that linked implement lanes are eligible for v2 review-feedback lane resolution, that `review_feedback_lane_unmatched` does not cover a completed linked lane with PR evidence on a sibling row, and the same bare mixed-invocation ambiguity rule as the runbook.
