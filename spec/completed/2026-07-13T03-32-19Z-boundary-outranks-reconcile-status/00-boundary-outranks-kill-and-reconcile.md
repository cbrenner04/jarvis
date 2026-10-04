# 00 - Boundary commit outranks kill and reconcile

## Problem

`killed` reaches the `runs.status` column from three harness-guess paths — `killHandler`
(`v2/src/daemon/daemon.ts:732`), the awaiting-human `abort` decision (`daemon.ts:783`), and restart
reconciliation (`StateStore.beginRunReconciliation`, `v2/src/persistence/state-store.ts:427-442`).
None of them consult the run's committed boundary.

Two contradictions follow:

- Kill races a terminal boundary. The write loop commits the boundary first
  (`v2/src/execution/write-loop.ts:265-277`: `commitCompletionBoundary` → `boundary_committed`), so a
  kill whose abort lands too late overwrites a row whose committed boundary carried
  `blocked`/`completed`/`failed` with `killed`. `jarvis run list` then shows `killed` for a run whose
  durable log ends in a `blocked` boundary.
- Reconcile replays stale pending rows. `beginRunReconciliation` returns every row with
  `reconciliation_pending = 1`, not only rows still eligible for a reconcile event. The existing
  duplicate-append guard (skip when the run's tail already carries a reconcile event) covers the
  common replay, so the residual defect is narrower: a row left pending by a crashed reconcile and
  since resumed to a boundary-terminal status still gets a `run_reconciled` / `killed` /
  `daemon_restart` event appended on the next restart — a kill event on a row that is durably
  `blocked`.

The agent's real outcome outranks the harness's guess. A committed boundary wins over a kill or a
reconcile regardless of arrival order; the boundary-after-kill direction already works, because
`commitCompletionBoundary` overwrites the row's status when the attempt has no outcome yet.

## Decisions

- Boundary-terminal statuses are `completed`, `blocked`, and `failed`: the statuses a committed
  boundary can leave a run in permanently. `killed` is never boundary-derived.
- A `paused` boundary (`terminalMapping` commits `paused` for `invalid_token`) is **not**
  boundary-terminal: it stays freely overwritable by kill and reconcile. Rules out "correcting" the
  list above to match every status `terminalMapping` can commit — reconcile deliberately flips
  `paused` rows to `killed`, and killing a paused run must keep working.
- The guard uses a new, separately named boundary-terminal predicate. Neither existing set may be
  reused: `isTerminalRunStatus` includes `killed` and `paused`, `TERMINAL_LIST_STATUSES` includes
  `killed` and excludes `paused` — either would make kill a no-op on already-killed or paused runs.
- Kill writes become a guarded state-store operation that refuses to overwrite a boundary-terminal
  status, rather than each daemon call site pre-checking `loadRun().status` — a pre-check outside the
  transaction reintroduces the same race it is meant to close.
- A guarded kill that hits a boundary-terminal row still returns `{ ok: true }` to the operator and
  still aborts the in-flight invocation. Rules out surfacing a new `kill` error code: the kill's
  purpose — stop the run — is met by the abort, and the run is already terminal.
- The kill handler only writes the row when the run is live in `activeRuns`; a non-active run still
  returns `run_not_active` with no write. Rules out widening kill to non-active runs — an
  operator-visible API change with no bug behind it.
- Reconcile emits `run_reconciled` for a pending row only when the row's **current status** is
  `killed`. Rules out "rows this `UPDATE` flipped": reconcile writes status, then event, then clears
  the flag, so a crash in that window leaves `killed` + `pending = 1` and the flipped-rows predicate
  would drop its event forever — the exact loss the pending flag exists to prevent. The existing
  duplicate-append guard stays.
- Rows already corrupted to `killed` by this bug are not backfilled. Non-goal.
- Resumable-terminal precedence in `composeRunOperatorError` (`run-operator-error.ts:163-164`,
  `killed` → `resumable_kill`) is unchanged. It is only reachable now when the row is genuinely
  `killed`, so the row and the log agree by construction.

## Acceptance criteria

- [x] Killing a run whose committed boundary carries a boundary-terminal `runStatus` (`blocked`,
      `completed`, or `failed`) leaves that status on the row — `jarvis run list` never reports
      `killed` for such a run. Progress boundaries (`runStatus: "in-progress"`) do not block a kill.
- [x] Killing a run whose committed boundary carries `paused` still sets the row to `killed`.
- [x] Killing a run with no boundary-terminal status still sets the row to `killed` and aborts the
      in-flight invocation.
- [x] Killing a non-active run still returns `run_not_active` and writes no status.
- [x] The awaiting-human `abort` decision follows the same guard (defense-in-depth; admission control
      already gates it on `status === "awaiting-human"`).
- [x] A boundary that commits after a kill still wins: the row ends at the boundary's status.
- [x] Daemon restart appends `run_reconciled` (`runStatus: "killed"`, `reason: "daemon_restart"`) only
      for pending rows whose current status is `killed`, including a row left `killed` + pending by a
      crash before the event append; a pending row whose status is boundary-terminal gets its pending
      flag cleared and no reconcile event.
- [x] `bun run typecheck` passes; `bun run test:v2` and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — reconcile vs. boundary precedence: reconcile and kill never overwrite a
  boundary-terminal status (`paused` is not boundary-terminal), and reconcile events are emitted only
  for pending rows that are currently `killed`.
- `v2/docs/state-store.md` — a run's status must agree with the run's terminal event; document the
  guarded kill write alongside `commitCompletionBoundary` / `setRunStatus`, and the reconcile pair
  (`beginRunReconciliation` / `finishRunReconciliation`) the doc currently omits.
- `v2/docs/v1-behaviors.md` — update the restart-reconciliation bullet (line 12) with the new
  precedence.
