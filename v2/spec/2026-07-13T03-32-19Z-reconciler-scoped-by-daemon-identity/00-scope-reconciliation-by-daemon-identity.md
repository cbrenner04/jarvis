# 00 - Scope reconciliation to runs whose admitting process is gone

## Problem

`beginRunReconciliation` (`v2/src/persistence/state-store.ts:427`) selects candidates by status alone: every
`queued | in-progress | paused | budget-soft-stopped | awaiting-human | revising` row is killed and flagged
`reconciliation_pending`. `reconcileOrphanedRuns` (`v2/src/daemon/daemon.ts:77`) then appends
`run_reconciled / killed / daemon_restart` for each. Nothing records *which process* admitted a row, so
"orphaned" is really "non-terminal at scan time".

The sweeper is never the row's own admitting process: `reconcileOrphanedRuns` runs inside `startDaemon`
(`daemon.ts:1122`) before the IPC server opens (`:1182`), and admission happens only through the IPC
`start`/`resume` RPCs. The real failure is **a starting process killing another live process's in-flight
runs** — a second daemon start, or a daemon start racing a foreground `jarvis write` (`write-loop.ts:523`) or
workflow runner (`workflow-runner.ts:1078`, `:1784`), both of which call `createRun` in-process against the
same database with no daemon involved.

Observed 2026-07-13: two runs admitted at 01:57 were killed as `daemon_restart` at 02:00 while their agents
were still working.

Fix the scoping, not the timing: a sweep that runs earlier still races a run admitted a millisecond later by
another process.

## Decisions

- The run row records the identity of the **process that admitted it**, daemon or not: column
  `owner_identity`. Rules out a `daemon_identity` name that would lie on rows created by `jarvis write` and
  the workflow runner.
- Identity is `<pid>:<process-start-epoch>`. Rules out bare pid (reused across incarnations) and an opaque
  random id: the identity must be *probeable*, because the sweep has to ask whether a recorded owner is still
  alive, and only pid+start-epoch can be checked against the OS.
- The current process's identity is captured once at module init, so every call within a process yields the
  same value (the pid-reuse argument depends on that stability).
- A recorded owner's start epoch and the current process's are read the same way (`ps -o lstart= -p <pid>`
  parsed to an epoch), so the two are comparable at the same granularity.
- Candidate rule: `owner_identity IS NULL OR (owner_identity <> :current AND the recorded owner is not
  alive)`, ANDed with the existing status/`reconciliation_pending` predicate. Mismatch alone is insufficient:
  a live concurrent owner also mismatches, and killing its runs is the bug. Probing the *recorded* owner is
  not the admission-vs-scan race; it is the only question separating a dead incarnation from a live peer.
- An owner is alive iff its pid exists **and** that pid's start epoch equals the recorded one. If the pid
  exists but its epoch cannot be read, treat the owner as alive and skip the row: failing to reconcile a dead
  process's run is recoverable; killing a live one is not.
- Consequence, stated explicitly: a starting daemon leaves rows owned by a live foreground `jarvis write` or
  workflow runner untouched, and reconciles rows left behind by a dead one.
- `NULL` owner (pre-migration rows) stays sweepable — written by an earlier process by construction.
- The state store stamps the identity inside `createRun` rather than each admit path passing it. Rules out
  threading a field through `handleWriteLoopStart` / `write-loop.ts prepareRun` — a future admit path that
  forgot it would silently become sweepable by a live peer.
- Liveness is evaluated in-process over the SQL-selected candidates (SQL cannot probe pids); only the
  surviving set is killed, inside the existing transaction.
- `openStateStore` takes optional overrides for the current identity and the liveness probe so tests can
  simulate a prior incarnation and a dead/live owner. Rules out monkeypatching `process.pid`.
- Forward-only migration `011-run-owner-identity` appends a nullable `owner_identity` column to
  `SCHEMA_MIGRATIONS` (`state-store.ts:211`). No backfill.
- `owner_identity` is not added to `RUN_COLUMNS` / the `Run` type. Deferred to first consumer: exposing the
  admitting process on reads — pin when a caller needs it.

## Test mechanic

Prior-incarnation rows are seeded through a store opened with identity `X` and a probe reporting `X` dead. The
sweep runs through a second store opened on the **same database file** with identity `Y`, injected into
`startDaemon`'s existing `stateStore` parameter (`daemon.ts:1110`). A live concurrent owner is simulated by a
probe reporting `X` alive.

## Acceptance criteria

- [ ] A run whose recorded owner is the current process is never reconciled by that process's sweep, whenever
      the sweep runs.
- [ ] A non-terminal run whose recorded owner is a different but **live** process keeps its status and gets no
      `run_reconciled` event.
- [ ] A non-terminal run whose recorded owner is a different and **dead** process is killed with
      `run_reconciled / killed / daemon_restart`, as before.
- [ ] A non-terminal run with no recorded owner (pre-migration row) is killed, as before.
- [ ] The liveness check classifies a recorded owner with the same pid but a different start epoch as dead, the
      same pid with the same start epoch as alive, and a live pid whose start epoch cannot be read as alive.
- [ ] `v2/src/daemon/daemon-reconciliation.test.ts` is reworked to seed rows with a prior-incarnation identity
      (per the test mechanic above) instead of the sweeping process's own, and stays green — including the
      pending-append retry case (a `reconciliation_pending` row owned by a dead prior incarnation retries
      exactly once) and the startup-ordering case (reconciliation completes before IPC opens; a reconciliation
      failure prevents IPC from opening).
- [ ] Opening a state store on a database written before this change succeeds and reconciles as above
      (migration applies without backfill).

## Documentation updates

- `v2/docs/daemon-host.md` — restart-reconciliation section: scope is "runs whose admitting process is gone";
  rows owned by the current process or by any live process are never candidates; non-daemon writers
  (`jarvis write`, workflow runner) own rows too.
- `v2/docs/state-store.md` — `owner_identity` on the `runs` row (format, who stamps it), the liveness-scoped
  reconciliation predicate, and the `011-run-owner-identity` migration.
- `v2/docs/v1-behaviors.md` — no change: v1 has no daemon and no reconciliation.
