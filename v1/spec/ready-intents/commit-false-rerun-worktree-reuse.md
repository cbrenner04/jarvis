---
name: commit-false-rerun-worktree-reuse
---

# Reuse or clean the prior worktree on `commit:false` re-run

## Problem

Under `commit:false`, a friction-blocked attempt leaves its worktree behind. Re-running
the same spec then requires the operator to hand-clean the orphaned worktree before each
retry, instead of the re-run being a single jarvis command.

## Direction

On re-run of an incomplete `commit:false` spec, automatically reuse or clean the prior
attempt's worktree instead of orphaning it. Plan to weigh: reuse the existing worktree in
place vs. tear it down and create fresh; whether this is the default re-run path or gated
behind an explicit `--retry`/`--fresh` affordance.

## Out of scope

- Source-spec AC/blocker reset (separate behavior).
- Changing the `commit:false` model itself (operator-merges-only, one-PR-per-item stays).

## References

- `v1/docs/worktrees-and-commits.md` — worktree lifecycle.

## Prerequisites

- A `commit:false` patch run leaves its worktree behind after a friction-blocked attempt.
