---
name: plan-rerun-throws-on-surviving-worktree
---

# Plan re-run hard-throws on a surviving `.worktree/plan-*` instead of reusing it

## Problem

When a `commit: true` plan attempt is friction-blocked or interrupted after its
worktree exists, re-running the same plan throws: `createManagedWorktree`
(`v1/src/worktree.ts`) aborts with `plan worktree already exists at <path>;
resolve with jarvis1 cleanup or remove manually`. The operator must hand-remove
the worktree (and sometimes the local/remote branch) before each retry — a
manual step on the common retry path.

This is the real friction the misformed `commit-false-rerun-hygiene` seed was
reaching for. That seed assumed `commit: false` orphans a worktree, but
`commit` is plan-mode-only and `commit: false` creates no worktree at all; the
prerequisite gate correctly blocked the `worktree-reuse` plan (closed PR #486).
The genuine gap is here, on the plan `commit: true` path. For contrast, patch
re-run already silently reuses a pre-existing `.worktree/<spec>/`
(`ensureWorktree`); plan does not.

## Direction

Make a plan re-run self-healing instead of throwing. Options for plan to weigh:

- Reuse the existing `plan-<name>` worktree in place (as patch's
  `ensureWorktree` already does), resetting it to a clean re-run state.
- Or tear it down and recreate automatically, rather than throwing and pointing
  at a manual `jarvis1 cleanup`.
- Decide whether this is the default re-run behavior or gated behind an explicit
  `--retry` / `--fresh` affordance.

## Out of scope

- Patch-mode worktree reuse (already works).
- The `commit: false` model (no worktree is created there).

## References

- `createManagedWorktree` / `ensureWorktree` in `v1/src/worktree.ts`.
- Closed PR #486 blocker analysis (no-referent `commit:false` worktree-reuse).
- Observed 2026-06-24 during this session's plan re-runs.
