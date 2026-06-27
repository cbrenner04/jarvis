---
name: merge-target-by-worktree-or-spec
---

# Resolve a merge target from a worktree name or spec path

## Problem

The operator thinks in worktrees and specs, not PR numbers. Forcing a PR
reference for the gated merge means a manual `gh pr list`/lookup before every
invocation — reintroducing the manual step the merge gate set out to remove.

## Behavior

The gated merge accepts a worktree name or spec path in addition to a PR
reference, resolving it to the corresponding open PR (worktree → branch → PR;
spec → its worktree → PR). An unresolvable or ambiguous target is reported
clearly instead of merging the wrong PR.

## Out of scope

- The merge gate itself (green-check + ready gate).
- Batch/multi-PR merging.

## Prerequisites

- The gated admin-merge-on-green behavior exists.
