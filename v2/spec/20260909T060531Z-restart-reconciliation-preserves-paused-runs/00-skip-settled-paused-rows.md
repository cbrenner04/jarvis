# 00 - Skip durably settled paused rows in orphan reconciliation

## Problem

`beginRunReconciliation` (`v2/src/persistence/state-store.ts`) selects `status IN ('queued', 'in-progress', 'paused', 'budget-soft-stopped')` with a dead or absent owner, and `reconcileOrphanedRuns` (`v2/src/daemon/daemon-run-reconciliation.ts`) settles each `killed` (`interrupted` for review-debate). A `paused` row whose boundary already committed has no live work to orphan; killing it discards a resumable checkpoint and, through deferred pipeline settlement, fails the lane.

## Decisions

- `beginRunReconciliation` excludes a `paused` or `budget-soft-stopped` candidate that has no `in-progress` attempt; such rows are neither marked `reconciliation_pending` nor returned. `queued` and `in-progress` rows, and paused rows with an open attempt, are admitted as today.
- The exclusion lives in the store's admission query, so `daemon start`, `daemon stop`, and any other `reconcileOrphanedRuns` caller share it.
- No new status, event, or migration.

## Acceptance criteria

- [ ] `state-store.test.ts` test `beginRunReconciliation leaves a paused row with a completed last attempt untouched` seeds a dead-owner `paused` run whose attempt completed on a `paused` boundary and asserts it is not returned, not `reconciliation_pending`, and still `paused`; it fails against the current `ORPHAN_STATUSES` admission.
- [ ] A test proves a dead-owner `paused` row with an `in-progress` attempt is still admitted and settled `killed`.
- [ ] `daemon-reconciliation.test.ts` proves a daemon start over a durably paused, resumable row appends no `run_reconciled` event and leaves the row `paused`.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — § Restart reconciliation and recovery: paused/budget-soft-stopped rows with a committed boundary are not orphans; only rows with open work reconcile.
- `v2/docs/state-store.md` — `beginRunReconciliation` admission rule.
- `v2/docs/operator-runbook.md` — a paused run survives a daemon restart; resume it with `jarvis run resume`.
