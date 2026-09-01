# Intent-finalization resume computes resumable from outcome kinds

`settleIntentResumeFailure` hardcodes `loop_finished.resumable: true` while its twin `settleReviewMutationResumeFailure` computes `resumable` from `REVIEW_MUTATION_RESUMABLE_OUTCOME_KINDS`. Non-resumable intent-finalization failures therefore advertise retryability the resume admission predicate will refuse — the terminal-honesty bug called out by `merge-publication-resume-twins-compute-resumable`, fixed here in place as a targeted point-fix (the twin-merge/extraction refactor is deferred to the `split-workflow-runner-resume-machines` chain).

- [ ] [00 - Compute intent-resume resumable from outcome kinds](./00-compute-intent-resume-resumable-from-outcome-kinds.md)
