# 00 - Boundary commit outranks kill and reconcile

## Problem

`killed` reaches the `runs.status` column from three harness-guess paths — `killHandler`
(`v2/src/daemon/daemon.ts:732`), the awaiting-human `abort` decision (`daemon.ts:783`), and restart
reconciliation (`StateStore.beginRunReconciliation`, `v2/src/persistence/state-store.ts:427-442`).
None of them consult the run's committed boundary.

Two contradictions follow:

- Kill races a terminal boundary. The write loop commits the boundary first (`write-loop.ts:265-277`:
  `commitCompletionBoundary` → `boundary_committed`), so a kill whose abort lands too late overwrites
  a `blocked`/`completed`/`failed` row with `killed`. `jarvis run list` then shows `killed` for a run
  whose durable log ends in a `blocked` boundary.
- Reconcile replays stale pending rows. `beginRunReconciliation` returns every row with
  `reconciliation_pending = 1`, not only the rows its `UPDATE` flipped, so a run left pending by a
  crashed reconcile and since resumed to a boundary-terminal status still gets a
  `run_reconciled` / `killed` / `daemon_restart` event appended on the next restart — a kill event on
  a row that is durably `blocked`.

The agent's real outcome outranks the harness's guess. A committed boundary wins over a kill or a
reconcile regardless of arrival order; the boundary-after-kill direction already works, because
`commitCompletionBoundary` overwrites the row's status when the attempt has no outcome yet.

## Decisions

- Boundary-terminal statuses are `completed`, `blocked`, and `failed` — the statuses `terminalMapping`
  (`write-loop.ts:624-638`) can commit. `killed` is not one: it is never boundary-derived.
- Kill writes become a guarded state-store operation that refuses to overwrite a boundary-terminal
  status, rather than each daemon call site pre-checking `loadRun().status` — a pre-check outside the
  transaction reintroduces the same race it is meant to close.
- A guarded kill that hits a boundary-terminal row still returns `{ ok: true }` to the operator and
  still aborts the in-flight invocation. Rules out surfacing a new `kill` error code: the kill's
  purpose — stop the run — is met by the abort, and the run is already terminal.
- Reconcile emits `run_reconciled` only for runs whose status it actually flipped to `killed`.
  Rules out keeping the "all pending rows" replay, which is what lets a kill event land on a
  boundary-terminal run.
- Resumable-terminal precedence in `composeRunOperatorError` (`run-operator-error.ts:163-164`,
  `killed` → `resumable_kill`) is unchanged. It is only reachable now when the row is genuinely
  `killed`, so the row and the log agree by construction.

## Acceptance criteria

- [ ] Killing a run whose terminal boundary already committed leaves the row's boundary status
      (`blocked`, `completed`, or `failed`) — `jarvis run list` never reports `killed` for a run whose
      durable log ends in a `boundary_committed` event.
- [ ] The awaiting-human `abort` decision follows the same rule: it does not overwrite a
      boundary-terminal row with `killed`.
- [ ] Killing a run that has no committed terminal boundary still sets the row to `killed` and aborts
      the in-flight invocation.
- [ ] A boundary that commits after a kill still wins: the row ends at the boundary's status.
- [ ] Daemon restart appends `run_reconciled` (`runStatus: "killed"`, `reason: "daemon_restart"`) only
      for runs it flipped to `killed`; a run with `reconciliation_pending = 1` whose status is
      boundary-terminal gets its pending flag cleared and no reconcile event.
- [ ] `bun run typecheck` passes; `bun run test:v2` and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — reconcile vs. boundary precedence: reconcile and kill never overwrite a
  boundary-committed status, and reconcile events are emitted only for rows it flipped.
- `v2/docs/state-store.md` — a run's status must agree with the run's terminal event; document the
  guarded kill write alongside `commitCompletionBoundary` / `setRunStatus`, and the reconcile pair
  (`beginRunReconciliation` / `finishRunReconciliation`) the doc currently omits.
- `v2/docs/v1-behaviors.md` — update the restart-reconciliation bullet (line 12) with the new
  precedence.
