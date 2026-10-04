# Unit composition

## Problem

`composeRunOperatorError` projects `reason`, `nextAction`, `retryable`, and
`publicationFailure` from terminal `completion_commit_failed` `loop_finished`
rows but omits their `completionCommitError` text.

## Decision ledger

- Optional `RunOperatorError.completionCommitError` carries the terminal
  `loop_finished.completionCommitError` string projected without
  re-normalization — same pattern as `publicationFailure` — rules out operators
  opening `jarvis run log` for the generic message alone.
- `publicationFailure` stays alongside `completionCommitError` when both are
  present — rules out replacing structured publication evidence with free text.
- Projection runs in `mapFromLoopFinished` for `completion_commit_failed` only;
  `iteration_commit_failed` stays unchanged — rules out widening every commit
  failure kind in this slice.
- `completionCommitError` is omitted when the terminal row lacks it — rules out
  synthesizing placeholder text.

## Prerequisites

- Durable `completion_commit_failed` `loop_finished` records retain optional
  `completionCommitError` without a `runs` table migration.
- Every execution-loop completion-commit failure writes the returned message to
  its terminal `loop_finished` record while preserving normalized publication
  evidence — operator gate: upstream emit/write-loop work merged before
  implementation.

## Task checklist

- Add optional `completionCommitError` to `RunOperatorError`.
- Project it from terminal `loop_finished` in `mapFromLoopFinished` for
  `completion_commit_failed`, preserving `publicationFailure`.
- Extend `run-operator-error.test.ts` composition regressions (coexistence,
  omit-when-absent).

## Acceptance criteria

- [x] `run-operator-error.test.ts` adds a regression where
      `composeRunOperatorError` maps the terminal `loop_finished.completionCommitError`
      string onto `error.completionCommitError` without re-normalization while
      retaining `publicationFailure`; fails against baseline.
- [x] `run-operator-error.test.ts` adds a regression where
      `composeRunOperatorError` omits `error.completionCommitError` when the
      terminal `loop_finished` row has no such field; fails against baseline.
- [x] `run-operator-error.test.ts` links a `// @mutate` directive in the
      pinning coexistence test to the real `completionCommitError` projection
      guard in `run-operator-error.ts`; inverting it turns the test red with no
      production inversion hook.
- [x] `run-operator-error.test.ts` `"composeRunOperatorError maps ready gate, surviving mutation, and flip failures from loop_finished"` stays green (`iteration_commit_failed` composition unchanged).

## Documentation updates
