---
name: list-row-step-honesty
---

# List rows report honest step state, attempt counts, and finish times

## Problem

A terminal run's step snapshot can read `pending` while the run outcome is
`completed` (`workflow-list-snapshot.ts:84-97`) — panel disagrees with outcome.
`attemptCount` is emitted as `0` on review-role rows that provably invoked an
agent (`:64-79`), so the count carries no information. The list row's
`finishedAtMs` derives from attempt `completed_at` only (`daemon.ts:621-631`),
so a reconciled terminal run's finish time is only honest once the store records
one.

## Decisions

- A terminal run's step snapshot must not report `pending`; reconcile step state
  at the completion boundary so the panel agrees with the outcome. Rules out
  leaving the snapshot to read pending on a completed run.
- `attempts` reflects actual agent invocations for the step; a step that invoked
  an agent never reads `0`. Rules out leaving a placeholder counter on display.
- The list row's `finishedAtMs` reads the store's reconciled finish time for
  terminal rows the attempt path never stamped.

## Prerequisites

- Reconciliation records a real finish timestamp on killed/interrupted runs.
