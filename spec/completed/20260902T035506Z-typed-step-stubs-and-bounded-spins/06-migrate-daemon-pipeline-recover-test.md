# Migrate daemon-pipeline-recover tests

## Problem

`daemon-pipeline-recover.test.ts` defines `planReviewStep` with `as unknown as AnyWorkflowStep` even though `realPlanReviewStep` in the same file already returns a properly typed `ReviewWorkflowStep`. Minimal `planReviewStep` is used at four sites; `realPlanReviewStep` at one conditional site.

## Surface

`v2/src/daemon/daemon-pipeline-recover.test.ts`.

## Decisions

- Retype minimal `planReviewStep` to `ReviewWorkflowStep` following the typed minimal pattern in `pipeline-stage-recovery.test.ts` (~840: stub binding, per-role `agents` map, `verdictPath`, etc.) while keeping only the landing shape resolution requires; leave `realPlanReviewStep` call sites unchanged; rules out blanket replacement with `realPlanReviewStep` and rules out adding a review-step factory module.
- This file has no unbounded microtask spins; rules out introducing spin-helper edits here.
- Preserve every existing assertion; rules out production recovery changes.

## Task checklist

- Retype `planReviewStep` per the `pipeline-stage-recovery.test.ts` minimal pattern so no `as unknown as AnyWorkflowStep` cast remains; leave `realPlanReviewStep` call sites unchanged.
- Leave deadline-bound polling patterns unchanged.

## Acceptance criteria

- [x] `daemon-pipeline-recover.test.ts` stays green (behavior unchanged by the scaffolding extraction).
- [x] `daemon-pipeline-recover.test.ts` contains zero `as unknown as AnyWorkflowStep` casts (reachable on main today via `planReviewStep`).

## Documentation updates

None — `v2/docs/test-writing.md` lands in subspec 08.
