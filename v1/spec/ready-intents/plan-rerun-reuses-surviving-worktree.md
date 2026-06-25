---
name: plan-rerun-reuses-surviving-worktree
---

# Plan re-run self-heals on a surviving `.worktree/plan-*`

## Behavior

A `commit: true` plan re-run no longer aborts when its `plan-<name>` worktree
already exists. Today `createManagedWorktree` (`v1/src/worktree.ts`) throws
`plan worktree already exists at <path>; resolve with jarvis1 cleanup or remove
manually`, forcing a manual worktree (and sometimes branch) removal on the
common retry path. Make the re-run self-healing — reuse the surviving worktree
in place (as patch's `ensureWorktree` already does) or tear it down and recreate
— so the operator can re-run a friction-blocked/interrupted plan attempt without
hand-cleanup.

Plan to decide: reuse-in-place (reset to a clean re-run state) vs. teardown +
recreate; and whether self-heal is the default or gated behind an explicit
`--retry`/`--fresh` affordance.

Scope: the plan `commit: true` path only. Out of scope: patch reuse (already
works) and `commit: false` (creates no worktree).

## Prerequisites
