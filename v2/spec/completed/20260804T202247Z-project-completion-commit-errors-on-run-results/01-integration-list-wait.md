# Integration list/wait

## Problem

`jarvis run list` and `jarvis run wait` compose operator errors through
`composeRunOperatorError` but do not surface `completionCommitError` on runs
whose terminal `loop_finished` row carries it.

## Decision ledger

- `list` and `wait` on the run id that owns the terminal `loop_finished` row
  expose `error.completionCommitError` as the stored terminal string without
  re-normalization — rules out separate command-specific lookups.
- Hidden-shrink fixture topology: workflow entry row rolls up `status: failed`
  while the stopping `implement~shrink` sibling owns the terminal
  `completion_commit_failed` row — contract is on the owning sibling run id, not
  entry-row error adoption.
- Workflow entry rows do not inherit sibling `completion_commit_failed` operator
  error detail under existing owner-adoption rules — rules out widening owner
  search to `completion_commit_failed` in this slice.
- `publicationFailure` stays alongside `completionCommitError` when both are
  present on the owning sibling — rules out dropping structured evidence.

## Prerequisites

- Same emit/write-loop gate as [00 - Unit composition](./00-unit-composition.md).
- Unit composition subspec merged — `mapFromLoopFinished` projects
  `completionCommitError` for `completion_commit_failed`.

## Task checklist

- Extend `daemon-wait-run-completion.test.ts` hidden-shrink
  `completion_commit_failed` fixture: terminal row carries both
  `completionCommitError` and `publicationFailure`; assert list/wait on the
  owning `implement~shrink` run id.
- Update durable docs.

## Acceptance criteria

- [x] `daemon-wait-run-completion.test.ts` extends the hidden-shrink
      `completion_commit_failed` fixture so `list` and `wait` on the owning
      `implement~shrink` run id expose `error.completionCommitError` as the
      terminal `loop_finished.completionCommitError` string without
      re-normalization; fails against baseline.
- [x] The same fixture asserts both `error.completionCommitError` and
      `error.publicationFailure` on the owning sibling for `list` and `wait`
      when both fields are present in the terminal row; fails against baseline.
- [x] `daemon-wait-run-completion.test.ts` links a `// @mutate` directive in
      the pinning test to the same `completionCommitError` projection guard in
      `run-operator-error.ts`; inverting it turns the test red with no
      production inversion hook.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2`
      pass.

## Documentation updates

- `v2/docs/daemon-host.md` — document optional `error.completionCommitError` on
  `completion_commit_failed` `list` / `wait` rows for the run that owns the
  terminal `loop_finished` event, projected without re-normalization; may
  coexist with `error.publicationFailure`; workflow entry rows do not inherit
  sibling `completion_commit_failed` operator error detail.
- `v2/docs/v1-behaviors.md` — v2 parity delta for daemon row projection of
  `completionCommitError`.
