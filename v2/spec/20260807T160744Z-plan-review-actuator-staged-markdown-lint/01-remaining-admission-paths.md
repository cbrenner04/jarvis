# Remaining admission paths

## Problem

Subspec `00` wires the shared staged-Markdown lint gate into the primary review landing path (`landReviewedOutputOrFail`). Two other callers reach `landReviewedPublicationOutput` for `plan-tree` / `intent-stage` kinds and would still promote actuator-introduced violations: `finishReviewedLanding` (checkpoint re-entry) and `resumePopulatedIntentPublication` (intent resume). This subspec closes those bypasses.

## Prerequisites

- Subspec `00` merged: `lintReviewedStagedMarkdownOrFail` exists in `reviewed-staged-markdown-lint.ts` and is wired into `landReviewedOutputOrFail` with reprompt + exhaustion; the three feature tests and the shared-classifier mutation checkpoint are green.

## Decision ledger

- Call `lintReviewedStagedMarkdownOrFail` immediately before `landReviewedPublicationOutput` in `finishReviewedLanding` (first-pass semantics: reprompt/exhaustion like the primary path) — rules out a checkpoint-re-entry bypass.
- Call the helper in `resumePopulatedIntentPublication` on **replay-finalization only** (no actuator re-invocation); on violation settle `landing_failed` with preserved stage — rules out resume skipping post-actuator violations already on disk and rules out re-running the actuator during resume.
- Reuse the subspec-`00` helper, reprompt payload, counter, and settlement — no divergent surface.
- **Fixture reconciliation:** reconcile any additional `executeWorkflow review dispatch` tests that reach `finishReviewedLanding` / `resumePopulatedIntentPublication` and break once these paths lint, so `bun run test:v2` stays green.
- Out of scope: durable docs (subspec `02`).

## Work

- Wire the helper into `finishReviewedLanding` (first-pass reprompt/exhaustion) and `resumePopulatedIntentPublication` (replay-only, settle on violation) in `workflow-runner.ts`.
- Add coverage for both paths in `workflow-runner.test.ts`; reconcile any newly-broken review-dispatch fixtures.

## Acceptance criteria

- [ ] `workflow-runner.test.ts` `review actuator staged Markdown lint blocks a checkpoint re-entry landing` drives a `finishReviewedLanding` re-entry whose staged Markdown carries a violation, asserts no durable promotion (reprompt or `landing_failed`, no completion commit), and fails against pre-fix code where checkpoint re-entry promotes the violation.
- [ ] `workflow-runner.test.ts` `intent publication resume re-lints staged Markdown and settles landing_failed on violation` drives `resumePopulatedIntentPublication` with a staged violation, asserts `landing_failed` with preserved stage and **no** actuator re-invocation, and fails against pre-fix code where resume promotes the violation.
- [ ] Mutation checkpoint: in `workflow-runner.test.ts` test `review actuator staged Markdown lint blocks a checkpoint re-entry landing`, a `// @mutate` directive removing the `finishReviewedLanding` gate call (the `lintReviewedStagedMarkdownOrFail` invocation guarding that landing) turns that test RED. Hand-confirm the mutation reddens via a failed assertion, not a compile error, and that no sibling gate masks it on this path.
- [ ] All prior `workflow-runner.test.ts` `executeWorkflow review dispatch` tests stay green.
- [ ] `bun run typecheck`, `bun run check`, and `bun run test:v2` pass.

## Documentation updates

None — durable docs land in `02`.
