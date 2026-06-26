---
name: commit-false-rerun-resets-killed-run
---

# A killed commit:false run is reset on re-run

## Problem

The no-commit re-run auto-reset records its delta only on a graceful agent
return. A `commit: false` run interrupted by Ctrl-C, idle/iteration/run timeout
returns before the delta is diffed and persisted, so the ticked acceptance
criteria and any appended `## Blocker` survive into the next re-run unreset —
the headline reporter case (intake issue #520).

## Direction

Persist the delta (AC ticks + appended blocker) on the interrupt and timeout
paths — or persist mutations incrementally as they happen — so a run killed
mid-progress is reset when it is re-run. The committed (`git: true`) path is
unaffected.

## Prerequisites

- The commit:false re-run auto-reset un-ticks acceptance criteria and strips an appended blocker from the source spec before the agent re-runs.
