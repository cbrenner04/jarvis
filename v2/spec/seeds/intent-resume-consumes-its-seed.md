---
name: intent-resume-consumes-its-seed
---

# Resuming a `landing_failed` intent lands the ready-intents but never consumes the seed

## Problem

A reviewed `intent` workflow that settles `landing_failed` and is recovered with `jarvis run resume <review-row>` publishes its ready-intents, commits, pushes, and opens the PR — but the seed file it split stays on disk. A normal intent landing deletes it (`landing.inputs.paths` consumption). The resume path replays finalization without that step, so the seed survives its own split.

The failure is silent and durable: nothing in the run row, log, or PR says the seed was not consumed. The operator sees a green intent PR whose ready-intents are correct, merges it, and the seed remains in `v2/spec/seeds/` indistinguishable from unstarted work. The next session re-splits it, producing duplicate ready-intents for work already queued or landed.

## Evidence

Observed 2026-09-03, run `f85ed0fc-0eb8-4094-b5e5-35bcbc3a8881`, seed `pipeline-resume-owns-the-plan-lane-preamble`. The review row settled `landing_failed` on a landing-contract violation (`intent: pipeline-resume-lists-fanout-resumable-lanes.md must list prerequisites as one bullet per line`). After hand-editing the staged file and `jarvis run resume` on the review row, the run reported `completed` and PR #3407 landed both ready-intents — with `v2/spec/seeds/pipeline-resume-owns-the-plan-lane-preamble.md` still present in the branch diff. The seed had to be deleted by hand before merge.

Contrast: the same session's `operator-incidents-carry-and-filter-by-project` intent landed on the ordinary path in the same batch and deleted its seed correctly (PR #3406).

## Decisions

- Populated-stage intent finalization resume (`resumePopulatedIntentPublication` / `resolveIntentFinalizationResumeContext`) consumes the same `landing.inputs.paths` the first-pass landing would have. Rules out consumption living only on the non-resume path.
- Consumption is derived from the persisted workflow snapshot, not recomputed from the seed argument, so a resume after a daemon restart still knows which input to consume. Rules out depending on CLI invocation state that resume does not have.
- A resume that cannot resolve its landing inputs fails loudly rather than landing a half-consumed queue. Rules out best-effort silent skip.

## Acceptance criteria

- [ ] A test drives a reviewed intent to `landing_failed` with a populated stage, resumes the review row, and asserts the seed named by the persisted landing inputs is deleted in the resulting commit; it fails against the current resume path.
- [ ] A test asserts the ordinary (non-resume) intent landing still consumes its seed, so the fix does not move consumption off the happy path.
- [ ] A test asserts a resume whose persisted landing inputs cannot be resolved settles a named failure instead of publishing; it fails against a best-effort skip.
- [ ] `bun run typecheck` and the `test:v2` pair pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — § Intent finalization failed with staged files remaining: state that resume consumes the seed, so no manual deletion is needed before merging the intent PR.
- `v2/docs/workflow-runner.md` — publication landing contract: seed consumption is part of finalization on both the first-pass and resume paths.
