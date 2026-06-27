---
name: commit-false-rerun-workspace-cleanup
---

# Re-running a commit:false spec cleans the stale worktree, branch, and draft PR

## Problem

A `commit:false` re-run currently requires the operator to manually remove the
prior run's worktree and branch and close any stale draft PR before re-running an
incomplete item. Without this cleanup the re-run collides with leftover workspace
state.

## Direction

On re-run of a `commit:false` spec, clean the stale workspace — remove the prior
worktree and branch and close any stale draft PR — so the re-run starts from a
clean state, mirroring the in-repo behavior.

## Documentation updates

- Operator runbook "No-commit re-run auto-reset" — note worktree/branch/draft-PR
  cleanup on re-run.

## Prerequisites

- A commit:false run creates a per-run worktree, branch, and draft PR.
