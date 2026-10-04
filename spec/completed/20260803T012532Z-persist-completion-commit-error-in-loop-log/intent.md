---
name: persist-completion-commit-error-in-loop-log
---

# Persist completion-commit error detail in loop logs

## Module-boundary surface

- Persistence: durable structured-log event contract.

## Problem

- `loop_finished` classifies `completion_commit_failed` but cannot retain a generic completion-commit message when no normalized publication failure exists.

## Decisions

- Add optional `completionCommitError` text to `LoopFinishedEvent` — rules out a `runs` table migration and overloading `publicationFailure` with non-publication errors.
- Keep records without `completionCommitError` readable — rules out log migration or synthesized backfill.

## Acceptance criteria

- [ ] `log-stream.test.ts` appends and tails a `completion_commit_failed` `loop_finished` record with its exact `completionCommitError`; the regression fails against the baseline event contract.
- [ ] Existing `loop_finished` records without `completionCommitError` still round-trip.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/v2-architecture.md` — record `completionCommitError` on durable completion-failure log events and keep orchestration rows free of diagnostic text.
- `v2/docs/v1-behaviors.md` — record the v2 durable-log addition.

## Prerequisites
