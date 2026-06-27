---
name: jarvis-fix-commit-ready-order
---

# Jarvis completion runs fix → commit → strict ready

## Problem

Harness runs `bun run ready` (which autofixes in-place), then commits dirty output
after a green gate. That inverts the required order: autofix can land uncommitted,
or the gate passes on a tree CI never sees.

## Direction

- Completion and all `runReadyAndCommit` call sites: **fix → commit fix → strict
  ready** on `full` tier. Run `bun run fix` when the worktree needs autofix, commit
  (`chore: apply pre-ready check:fix` or successor message), then run strict
  `bun run ready`.
- Remove the post-ready dirty-tree commit path (no autofix after the gate).
- On fix-commit failure or post-commit dirty porcelain, abort without `gh pr ready`.
- `fast` tier skips fix/commit; unchanged carrier semantics.

## Decisions

- Fix runs harness-side before `ready`, not inside `ready` — rules out post-ready commit absorbing autofix output.
- Post-ready `commitCheckFix` path deleted — rules out retaining ready-then-commit ordering.
- Fix commit message may keep `pre-ready check:fix` wording or rename; behavior is the ordering contract.

## Out of scope

- Defining `fix` / strict `ready` scripts (prior intent).
- `lint:md`-in-CI gap.

## Documentation updates

- `v1/docs/operator-runbook.md` — replace check:fix-in-gate notes with
  fix→commit→strict-gate flow; delete the hand-merge "commit autofix" caveat.
- `v1/docs/worktrees-and-commits.md` — completion readiness section matches new order.
- `v2/docs/v1-behaviors.md` — harness completion-gate and review-baseline sections.

## Prerequisites

- `bun run ready` is pure CI-parity verification with no autofix.
- `bun run fix` exists as the separate pre-gate autofix step.

