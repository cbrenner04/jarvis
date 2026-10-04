---
name: provisional-skip-provenance-in-state-store
---

# `skipped` stage rows record whether the skip was provisional or terminal

## Problem

`skipped` is a single opaque status. Rows written by `skipRemainingStages` after a predecessor failure (provisionally skipped, undone work) are indistinguishable from rows retired because they were never applicable — the `default` rows a fan-out split retires. Any un-skip path must be able to tell them apart, and the only existing un-skip (`reopenFailedPipeline`) is anchored on a failed row.

## Decisions

- The store records skip provenance on the stage row when a skip is written: predecessor-failure skips are provisional; split-retired rows are terminal.
- The store exposes a branch-scoped reopen of provisional `skipped` successors to `pending` (clearing lifecycle columns like the existing reopen does) that does not require a `failed` anchor row and never touches terminal skips.
- Existing rows without recorded provenance keep today's behavior; no backfill guesswork.

## Acceptance criteria

- [ ] A state-store test proves a skip written after a predecessor failure is recorded as provisional and a split-retired `default` row is recorded as terminal; it fails against the pre-fix schema.
- [ ] A state-store test proves the branch-scoped reopen returns provisional `skipped` rows to `pending` with lifecycle columns cleared, with no `failed` row present.
- [ ] A state-store test proves the same reopen leaves terminal split-retired `default` rows `skipped`.
- [ ] A state-store test proves the reopen is branch-scoped: sibling branches' rows are untouched.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/pipeline-execution.md` — provisional vs terminal `skipped`.
- `v2/docs/v1-behaviors.md` — record the changed skip semantics.

## Prerequisites
