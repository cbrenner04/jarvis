# Co-locate and split resume tests

## Problem

Resume-path coverage lives in oversized concern-group files (`workflow-runner-resume.test.ts` beside the step loop, `recoverPlanStage` inside `workflow-runner-plan.test.ts`, review-failed admission beside plan recovery), so resume regressions are harder to localize after the production move.

## Surface

Primary: `v2/src/execution/workflow-runner-resume.test.ts` and any new `workflow-runner-resume-*.test.ts` siblings. In-scope: `workflow-runner-plan.test.ts` (source of moved `describe("recoverPlanStage")` only), `recover-review-failed-plan-draft.test.ts` (source of moved `describe("recoverPlanStage review-failed admission")` only).

## Prerequisites

- Subspec 00 complete: `workflow-runner-resume.ts` exports resume entrypoints and all merge-base consumers already import from it.
- Subspec 01 complete: `workflow-runner-resume-inventory.test.ts` pins merge-base parity buckets.

## Decision ledger

- Co-locate resume-path tests beside `workflow-runner-resume.ts`; rules out leaving moved cases inside `workflow-runner-plan.test.ts` or `recover-review-failed-plan-draft.test.ts` after the move.
- Move all cases from merge-base `workflow-runner-resume.test.ts`, the `describe("recoverPlanStage")` block from `workflow-runner-plan.test.ts`, and the `describe("recoverPlanStage review-failed admission")` block from `recover-review-failed-plan-draft.test.ts`; rules out partial moves that leave inventoried resume-path cases in source files.
- Preserve moved case leaf titles, assertions, fixtures, and `// @mutate` directives byte-for-byte; rules out weakening coverage while thinning source files.
- Split along concern seams (plan recovery vs intent-finalization vs review-mutation) only when `bun run test:cost` over a single post-move file exceeds 150s wall clock (120s for the primary resume-path file per the 2026-08-25 split contract); rules out deferring splits past measured budget violations.
- Deferred to first consumer: proactive split threshold before cost exceeds budget — pin when co-located file cost is measured post-move.
- No test deleted or skipped; rules out earning headroom by dropping cases.

## Task checklist

- Physically re-home merge-base `workflow-runner-resume.test.ts` cases beside `workflow-runner-resume.ts` (imports already target `workflow-runner-resume.ts` from subspec 00).
- Move the `describe("recoverPlanStage")` block from `workflow-runner-plan.test.ts` into a co-located resume test file unchanged.
- Move the `describe("recoverPlanStage review-failed admission")` block from `recover-review-failed-plan-draft.test.ts` into a co-located resume test file unchanged.
- Split into additional `workflow-runner-resume-*.test.ts` siblings only when `bun run test:cost` over a single post-move file exceeds 150s wall clock (120s for the primary resume-path file).

## Acceptance criteria

- [x] `workflow-runner-resume-inventory.test.ts` records merge-base vs branch case counts and unchanged leaf titles for every resume-path test moved from `workflow-runner-resume.test.ts`, `workflow-runner-plan.test.ts`, `workflow-runner-publication.test.ts`, and `recover-review-failed-plan-draft.test.ts`.
- [x] `workflow-runner-plan.test.ts` stays green for remaining plan-dispatch cases after `recoverPlanStage` moves out.
- [x] `recover-review-failed-plan-draft.test.ts` stays green after the review-failed admission block moves out (or is removed when empty).
- [x] `bun run test:cost` over each post-move `workflow-runner-resume*.test.ts` file reports at most 150s wall clock; the primary resume-path file reports at most 120s.
- [x] `bun run test:integration:v2` passes.

## Documentation updates

None — test placement doc lands in subspec 04.
