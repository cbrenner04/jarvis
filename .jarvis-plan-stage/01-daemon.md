# Daemon

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

- [ ] `daemon-wait-run-completion.test.ts` extends the hidden-shrink
      `completion_commit_failed` fixture so the sibling row that owns the
      terminal `loop_finished` exposes the same `completionCommitError` text on
      both `list` and `wait`; fails against baseline.
- [ ] `daemon-wait-run-completion.test.ts` links a `// @mutate` directive in
      the pinning test to that same guard; inverting it turns the test red with
      no production inversion hook.

## Documentation updates

- `v2/docs/daemon-host.md` — document optional `error.completionCommitError` on
  `completion_commit_failed` `list` / `wait` rows, sourced from the terminal
  `loop_finished` row; may coexist with `error.publicationFailure`.
- `v2/docs/v1-behaviors.md` — v2 parity delta for daemon row projection of
  `completionCommitError`.
