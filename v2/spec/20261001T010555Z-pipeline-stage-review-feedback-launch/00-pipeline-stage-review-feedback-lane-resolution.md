# Resolve review-feedback lanes from pipeline stage identity

## Problem

`resolveReviewFeedbackLane` pipeline mode requires the operator to supply `--branch` alongside `--pipeline` and `--stage`. A daemon launch keyed only by `(pipelineId, stageId[, branchKey])` has no branch flag to pass.

## Prerequisites

- Subspec `00-review-feedback-lane-resolution.md` from `20260930T051311Z-review-feedback-lane-admission` (pipeline disambiguators, `selectPipelineStageRow`, completed-stage checks).

## Decisions

- Add a `pipeline_stage` lane request `{ pipelineId, stageId, branchKey? }` resolved by loading the pipeline, selecting the stage row (`selectPipelineStageRow` semantics unchanged), then taking `project` and `branch` from that row's linked entry run — rules out requiring `branch` on the RPC or duplicating fan-out row selection.
- Fan-out stages with multiple rows still require `branchKey` when omitted; reuse the existing `review_feedback_lane_unmatched` refusal from `selectPipelineStageRow` — rules out picking an arbitrary sibling branch.
- After deriving `project`/`branch`, delegate to the same completed-lane, in-flight, eligibility, and publication-evidence checks as CLI pipeline disambiguation — rules out a second refusal table or weaker admission.
- Export a single resolver entry point callable from daemon admission (and later CLI) that returns the same `ReviewFeedbackLaneTarget` / refusal union as `resolveReviewFeedbackLane` — rules out inlining resolution only inside the RPC handler.

## Tasks

- Extend `review-feedback-lane-resolution.ts` with the `pipeline_stage` request shape and resolver.
- Add unit coverage for succeeded intent, plan, and implement stages (open reviewed PR path deferred to subspec `01` prelude), plus unknown stage, non-`succeeded` stage, and fan-out omission without `branchKey`.
- Thread the resolver into shared review-feedback admission preparation (replace hand-built CLI `branch` when the caller supplies stage identity only).

## Acceptance criteria

- [ ] `review-feedback-lane-resolution.test.ts` tests `resolves pipeline_stage for succeeded intent, plan, and implement rows from entry-run project and branch` and `refuses unknown stage, non-succeeded stage, and fan-out without branchKey` each fail against the pre-fix code and pass after implementation.

## Documentation updates

- None (RPC contract lands in subspec `01`).
