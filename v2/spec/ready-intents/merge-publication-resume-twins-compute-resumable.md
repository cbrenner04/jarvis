---
name: merge-publication-resume-twins-compute-resumable
---

# Merge publication resume twins and compute resumable from outcome kinds

## Primary implementation surface

Execution loop — intent-finalization and review-mutation publication resume settlement in `v2/src/execution/`

Unsplit rationale: Merging the twin settlement helpers and correcting intent-finalization `resumable` projection are one publication-resume settlement contract on `workflow-runner-resume.ts`; no other module-boundary surface owns either twin.

## Problem

Intent-finalization and review-mutation publication resume are copy-paste twins; `settleIntentResumeFailure` hardcoded `loop_finished.resumable: true` while the review-mutation twin computes it from admitted outcome kinds. **The `resumable` bug half landed as a point fix (#3327, 2026-09-01) — what remains here is the pure dedup**: merge the twins onto one parameterized helper so the fixed projection cannot re-diverge. Demoted accordingly; slot with execution-loop hygiene, not bug work.

## Behavior

One parameterized publication-resume settlement helper serves both intent-finalization and review-mutation callers; `resumable` is computed from outcome kinds for both. Dead single-use `message` aliases introduced by the paste are removed. No other settlement semantics change.

## Decision ledger

- Compute `resumable` from outcome kinds for both callers; rules out preserving the intent path's blanket `true`.
- Merge onto one parameterized implementation; rules out keeping duplicate settlement helpers.
- Pure refactor plus the `resumable` fix only; rules out scope creep into pipeline settlement semantics ([[pipeline-settlement-derives-from-run-rows]] owns that).

## Acceptance criteria

- [ ] A regression test drives intent-finalization resume to a non-resumable outcome kind and asserts `loop_finished.resumable` is false; it fails against the pre-fix hardcoded `true`.
- [ ] `settleReviewMutationResumeFailure` call sites are absent — settlement goes through the shared helper; a structural assertion fails if a duplicate remains.
- [ ] `workflow-runner-resume.test.ts` review-mutation and intent-finalization resume tests stay green except where updated to pin the corrected `resumable` contract.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/workflow-runner.md` — document shared publication-resume settlement and outcome-kind-derived `resumable`.
- `v2/docs/v1-behaviors.md` — record corrected intent-finalization resume `resumable` projection.

## Prerequisites

- Review-debate step landing orchestration lives in a sibling module wired from workflow-runner step dispatch.
- Plan recovery, intent-finalization resume, and review-mutation resume live in `workflow-runner-resume.ts` with co-located tests and a recorded inventory match to the pre-extraction baseline.
