# Document module map entry

## Problem

After extraction, review-debate landing ownership is implicit in file placement; the workflow-runner doc has no module map entry pointing operators and agents at the new boundary.

## Surface

Primary: `v2/docs/workflow-runner.md`.

## Decisions

- Add a `## Module map` section when absent; rules out burying ownership only in inline comments.
- Document `workflow-runner-debate-landing.ts` as owner of review-debate step landing orchestration, actuator-only retry, and shared `landReviewedOutputOrFail` / `finishReviewedLanding` helpers; rules out claiming resume-machine or `landReviewedPublicationOutput` ownership in this slice.
- Document that `workflow-runner.ts` imports `landReviewedOutputOrFail` and `finishReviewedLanding` from `workflow-runner-debate-landing.ts` for light-review and checkpoint re-entry — the filename is a seam label, not a debate-only boundary; rules out module-map prose that implies debate-only ownership.

## Task checklist

- Add `## Module map` to `v2/docs/workflow-runner.md` when missing.
- Record that `workflow-runner-debate-landing.ts` owns `runReviewDebateStep`, post-debate landing, actuator-only retry, and the shared `landReviewedOutputOrFail` / `finishReviewedLanding` helpers.
- Record that `workflow-runner.ts` imports `landReviewedOutputOrFail` and `finishReviewedLanding` from `workflow-runner-debate-landing.ts` for light-review landing and checkpoint re-entry, and imports `runReviewDebateStep` for step dispatch.
- Note that `landReviewedPublicationOutput` and resume machines remain in `workflow-runner.ts` until the follow-on resume extraction.

## Acceptance criteria

- [ ] `v2/docs/workflow-runner.md` documents review-debate landing ownership in a module map entry for `workflow-runner-debate-landing.ts`, including that `workflow-runner.ts` imports `landReviewedOutputOrFail` and `finishReviewedLanding` for light-review and checkpoint re-entry (not debate-only).

## Documentation updates

- `v2/docs/workflow-runner.md` — module map entry for review-debate landing ownership.
