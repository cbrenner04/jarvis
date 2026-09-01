# 00 - Compute intent-resume resumable from outcome kinds

## Primary implementation surface

`v2/src/execution/workflow-runner.ts` (`settleIntentResumeFailure`)

## Problem

`settleIntentResumeFailure` emits `loop_finished` with a hardcoded `resumable: true` for every intent-finalization landing failure it settles (outcome kinds seen at its callers include `completion_commit_failed` and `invocation_failure`). Its review-mutation twin `settleReviewMutationResumeFailure` instead computes `resumable: REVIEW_MUTATION_RESUMABLE_OUTCOME_KINDS.has(loopOutcomeKind)`. An intent-finalization failure whose outcome kind the resume admission (`resolveIntentFinalizationResumeContext`) will not re-admit is thus reported `resumable: true` / `nextAction: "resume"`, and a follow-up `jarvis run resume` then refuses — the terminal-honesty lie.

## Decisions

- Introduce an exported `INTENT_FINALIZATION_RESUMABLE_OUTCOME_KINDS` set naming exactly the outcome kinds an intent-finalization row can resume from, consistent with what `resolveIntentFinalizationResumeContext` re-admits (populated-stage landing replay). Mirror the twin's shape.
- `settleIntentResumeFailure` computes `resumable` from that set instead of the literal `true`. No other field changes.
- Scope is this one function's `resumable` computation only. The twin-merge into one parameterized helper and the resume-machine extraction stay owned by `split-workflow-runner-resume-machines` / `merge-publication-resume-twins-compute-resumable`; do not merge the twins or move code here.
- The set membership must agree with resume admission: a kind that `resolveIntentFinalizationResumeContext` refuses must not be in the set (and vice versa), so `resumable` and the actual `nextAction`/admission never disagree.

## Tasks

- Add the resumable-outcome-kind set; derive membership from the resume-admission path.
- Replace the hardcoded `resumable: true` with the set lookup.
- Add killing tests.

## Acceptance criteria

- [ ] `v2/src/execution/workflow-runner.test.ts` (or the co-located settlement test file) asserts `settleIntentResumeFailure` emits `loop_finished.resumable: false` for an outcome kind absent from `INTENT_FINALIZATION_RESUMABLE_OUTCOME_KINDS`; the test fails against the pre-fix hardcoded `true`.
- [ ] The same test file asserts `settleIntentResumeFailure` emits `loop_finished.resumable: true` for an outcome kind in the set.
- [ ] A test asserts every kind in `INTENT_FINALIZATION_RESUMABLE_OUTCOME_KINDS` is one `resolveIntentFinalizationResumeContext` admits (and no admitted kind is omitted), so the projected `resumable` cannot disagree with resume admission.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:v2` passes.

## Documentation updates

- `v2/docs/workflow-runner.md` (or the resume/settlement doc) — note intent-finalization `resumable` is computed from admitted outcome kinds, matching the review-mutation twin.
