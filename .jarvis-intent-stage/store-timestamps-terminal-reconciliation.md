name: store-timestamps-terminal-reconciliation

# Reconciliation stamps a finish time on killed/interrupted runs

## Problem

Orphan reconciliation sets status only (`state-store.ts:588-592`); `completed_at`
is written solely by the attempt-commit path (`:524-528`). A `killed` or
`interrupted` run with no committed attempt carries no finish timestamp, and a
`killed` run that completed earlier attempts keeps a stale finish time (last
successful iteration, not kill time).

## Decisions

- When reconciliation moves a run to a terminal status without an accurate
  attempt finish time, record a real reconciliation finish timestamp on the run;
  rules out leaving killed/interrupted rows timestamp-less and pushing the whole
  fix into the renderer.
- Prefer surfacing state the store already holds over new persisted fields; add
  a field only where the finish time genuinely is not recorded.
- Plan this finish-time seam serially: this intent (store) first, then
  `list-row-step-honesty`, then `terminal-window-renders-finishless-rows`. The
  two dependents declare this intent as a prerequisite, and the prereq gate
  checks committed code — planning them before this lands appends a `## Blocker`
  and exits non-zero.

## Prerequisites

