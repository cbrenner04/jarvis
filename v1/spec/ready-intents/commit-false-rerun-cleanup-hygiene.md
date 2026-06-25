---
name: commit-false-rerun-cleanup-hygiene
---

# commit:false re-run cleans up stale worktree/branch/draft PR

## Problem

A `commit: false` re-run resets the spec delta but leaves the prior attempt's
worktree, branch, and stale draft PR behind. That cleanup was scoped out of the
original reset work and remains uncovered, so re-runs accumulate stale
artifacts.

## Direction

Fold worktree/branch/stale-draft-PR cleanup into commit:false re-run hygiene so
a re-run starts from a clean slate. The committed (`git: true`) path reuses its
worktree/PR and is unaffected.

## Prerequisites

- The commit:false re-run auto-reset un-ticks acceptance criteria and strips an appended blocker from the source spec before the agent re-runs.
