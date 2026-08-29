---
name: record-iteration-commit-failure-cause
---

# Boundary commit failures retain their diagnostic cause

## Prerequisites

## Problem

- `iteration_commit_failed` returns the commit exception to its caller but persists a bare terminal `loop_finished`, leaving logs unable to explain the failure.

## Behavior

- A terminal `iteration_commit_failed` record carries a bounded message containing the boundary-commit error and available Git stderr, while remaining resumable and preceding no `boundary_committed` event.

## Decisions

- Populate the existing terminal `message` contract; rules out a new persistence field for evidence the durable event schema can already carry.
- Bound Git stderr with the existing terminal-log text policy; rules out persisting unbounded subprocess output.
- Keep diagnosis separate from recovery admission; rules out changing daemon semantics before the failure cause is observable.

## Acceptance criteria

- [ ] A `write-loop.test.ts` boundary-commit fixture throws a known error with Git stderr and asserts the bounded cause on `loop_finished`; the test fails against the pre-fix bare record.
- [ ] The same fixture asserts `resumable: true`, no `boundary_committed`, and the authored worktree change remains uncommitted.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — record the boundary-commit cause, bounded stderr, and retained uncommitted work.
- `v2/docs/v1-behaviors.md` — record the corrected existing terminal-evidence behavior.
