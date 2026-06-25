---
name: commit-false-reset-once-per-run
---

# commit:false reset runs once per run, not against own progress

## Problem

The no-commit re-run reset applies per non-fixup iteration. On a multi-iteration
`commit: false` run, a later iteration reloads this same run's own delta and
un-ticks acceptance criteria the agent just completed, undoing in-flight
progress.

## Direction

Apply the reset at most once per run, at run start, against a prior run's delta
only — never re-apply it against the current run's in-flight mutations. The
committed (`git: true`) path is unaffected.

## Prerequisites

- The commit:false re-run auto-reset un-ticks acceptance criteria and strips an appended blocker from the source spec before the agent re-runs.
