# Persist completion-commit error detail

## Problem

- Durable `loop_finished` records classify `completion_commit_failed` but lose a generic completion-commit message when no normalized publication failure exists.

## Decisions

- Add optional `completionCommitError` text to `LoopFinishedEvent`; rules out a `runs` table migration and overloading `publicationFailure` with non-publication errors.
- Keep records without `completionCommitError` readable; rules out log migration and synthesized backfill.
- Keep diagnostic text in the structured log rather than orchestration rows; rules out duplicating persistence ownership.

## Tasks

- Extend the durable `loop_finished` event contract with optional `completionCommitError` text.
- Add focused append-and-tail coverage for the new field and backward-compatible records without it.
- Align the durable architecture and v1-parity documentation.

## Acceptance criteria

- [ ] `v2/src/persistence/log-stream.test.ts` appends and tails a `completion_commit_failed` `loop_finished` record with its exact `completionCommitError`; the regression fails against the baseline event contract.
- [ ] `v2/src/persistence/log-stream.test.ts` proves existing `loop_finished` records without `completionCommitError` still round-trip.
- [ ] Guard inversion: every added or modified production guard has a source-mutation checkpoint in its pinning test and the scoped suite fails when inverted; the planned type-only contract adds no guard.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.
- [ ] `v2/docs/v2-architecture.md` records `completionCommitError` on durable completion-failure log events and keeps orchestration rows free of diagnostic text.
- [ ] `v2/docs/v1-behaviors.md` records the v2 durable-log addition.

## Documentation updates

- `v2/docs/v2-architecture.md` — durable completion-failure event field and persistence boundary.
- `v2/docs/v1-behaviors.md` — v2 durable-log addition.
