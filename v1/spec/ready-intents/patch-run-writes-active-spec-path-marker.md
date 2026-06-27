---
name: patch-run-writes-active-spec-path-marker
---

# Patch run writes `.active-spec-path` on worktree setup

## Problem

Production patch runs create or resume `.worktree/<spec-name>/` but never write
`.active-spec-path`. Triage and merge-target resolution depend on the marker; tests
fake it manually. Every patch run therefore produces a marker-less worktree until
something else backfills it.

## Direction

During patch preflight, after `ensureWorktree` resolves the agent working directory,
write `.active-spec-path` in that worktree with the active spec path (same relative
path `prepareActiveSpecPath` uses). Re-write on resume when the resolved spec path
changes.

- Do not commit the marker (worktree-local identity, like tests today).
- Skip when git mode is off or worktree setup is skipped.

Docs: `v2/docs/v1-behaviors.md` records that patch runs always populate the marker.

## Out of scope

- Plan-mode and intent-mode worktree creation.
- Deriving spec path when the marker is absent (separate intent).

## Prerequisites
