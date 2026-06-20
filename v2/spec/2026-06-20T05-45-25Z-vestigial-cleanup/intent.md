---
name: vestigial-cleanup
---
# Vestigial harness cleanup

**Scope.** Dead non-index `runIteration` path; `worktrees-and-commits.md` plan:intent/refine doc drift.

## Problem

Dead non-index `runIteration` path remains though preflight already blocks normal CLI use. `worktrees-and-commits.md` drifts from plan:intent/refine behavior.

## Desired behavior

Remove the dead non-index `runIteration` implementation path. Reconcile `worktrees-and-commits.md` with current plan:intent/refine flow.

## Decisions

- Remove dead code path; do not add a new non-index run mode. Rules out preserving legacy single-file run iteration for ad-hoc use.
- Doc reconciliation targets observed plan:intent/refine behavior only. Rules out speculative documentation of unimplemented flows.

## Acceptance signals

- No reachable code path invokes non-index `runIteration` for normal CLI runs.
- `worktrees-and-commits.md` matches plan:intent/refine behavior verifiable from code/tests.
- `bun run typecheck` and `bun run test` pass.

## Documentation updates

- `v1/docs/worktrees-and-commits.md`: corrected plan:intent/refine section.

## Out of scope

- Changing non-index spec TTY prompt (`s`/`e`) behavior at preflight.
- God-module splits.
- New features.

## Prerequisites

- Patch mode injects harness-selected active subspec into implementation prompts.
