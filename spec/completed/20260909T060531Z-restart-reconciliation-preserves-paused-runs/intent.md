# Daemon-restart reconciliation preserves paused, resumable runs

## Problem

A write run that settled `paused` / `resumable: true` on a durable boundary (`missing_blocker`, chess-mvp-yolo run `fb52cb87`, 2026-08-28) was flipped to `killed` by daemon-restart reconciliation 34 minutes later, which settled its pipeline `failed`. A paused row has no in-flight agent process to orphan — its terminal boundary is already durable — yet `ORPHAN_STATUSES` admits `paused` and `budget-soft-stopped` alongside `queued` and `in-progress`. The resulting state is contradictory: run `killed`, stage `failureDetail: { reason: "missing_blocker", retryable: true, nextAction: "resume" }`. Evidence: #3030.

## Decisions

- Reconciliation reconciles orphaned *work*, not non-terminal *status*: a `paused` or `budget-soft-stopped` row whose last attempt is completed (no `in-progress` attempt) is left untouched by `beginRunReconciliation`; rules out killing a durable checkpoint.
- A `paused`/`budget-soft-stopped` row that still carries an `in-progress` attempt (the owning process died between the pause request and the boundary commit) reconciles as today; rules out leaving a genuinely orphaned half-settled row behind.
- Preserved rows are not auto-admitted by `recoverReconciledRuns`; they remain operator-resumable through `jarvis run resume` exactly as before the restart; rules out silently re-driving an operator-paused run.
