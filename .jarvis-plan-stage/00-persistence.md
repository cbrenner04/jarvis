# Persistence

## Problem

Durable `completion_commit_failed` `loop_finished` events carry generic
`completionCommitError` text (and often `publicationFailure`), but daemon
`composeRunOperatorError` projects only `reason`, `nextAction`, `retryable`, and
`publicationFailure` onto `list` / `wait` rows.

## Decision ledger

- `RunOperatorError.completionCommitError` carries the terminal
  `loop_finished.completionCommitError` string — rules out operators opening
  `jarvis run log` for the generic message alone.
- `publicationFailure` stays alongside `completionCommitError` when both are
  present — rules out replacing structured publication evidence with free text.
- Projection runs in `mapFromLoopFinished` for `completion_commit_failed` only;
  `iteration_commit_failed` stays unchanged — rules out widening every commit
  failure kind in this slice.
- `completionCommitError` is omitted when the terminal row lacks it — rules out
  synthesizing placeholder text.
- Existing terminal-record selection and workflow entry owner adoption rules stay
  unchanged — rules out a second error-precedence path or widening owner search
  to `completion_commit_failed`.

## Task checklist

- Add optional `completionCommitError` to `RunOperatorError`.
- Project it from terminal `loop_finished` in `mapFromLoopFinished` for
  `completion_commit_failed`, preserving `publicationFailure`.
- Extend `run-operator-error.test.ts` composition regressions.
- Extend `daemon-wait-run-completion.test.ts` hidden-shrink
  `completion_commit_failed` list/wait regression (workflow entry + stopping
  `~shrink` sibling fixture).
- Update durable docs.

## Acceptance criteria

- [ ] `run-operator-error.test.ts` adds a regression where
      `composeRunOperatorError` maps persisted `completion_commit_failed`
      `completionCommitError` onto `error.completionCommitError` while retaining
      `publicationFailure`; fails against baseline.
- [ ] `run-operator-error.test.ts` links a `// @mutate` directive in the
      pinning test to the real `completionCommitError` projection guard in
      `run-operator-error.ts`; inverting it turns the test red with no
      production inversion hook.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2`
      pass.


## Documentation updates
