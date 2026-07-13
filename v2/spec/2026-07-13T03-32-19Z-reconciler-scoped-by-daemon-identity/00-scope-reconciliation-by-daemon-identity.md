# 00 - Scope reconciliation by admitting-daemon identity

## Problem

`beginRunReconciliation` (`v2/src/persistence/state-store.ts`) selects candidates by status alone:
every `queued | in-progress | paused | budget-soft-stopped | awaiting-human | revising` row is killed
and flagged `reconciliation_pending`. `reconcileOrphanedRuns` (`v2/src/daemon/daemon.ts`) then appends
`run_reconciled / killed / daemon_restart` for each. Nothing records *which* daemon admitted a row, so
"orphaned" is really "non-terminal at scan time" — a run the current daemon admitted is indistinguishable
from one a dead daemon left behind.

Observed 2026-07-13: daemon started 01:56, admitted two runs 01:57, killed both as `daemon_restart` at 02:00
while their agents were still working.

Fix the scoping, not the timing: a sweep that runs earlier still races a run admitted a millisecond later.

## Decisions

- Identity is `<pid>:<process-start-epoch-ms>`, captured once per process and stamped on every run row at
  insert. Rules out bare pid (reused across incarnations) and a liveness probe at scan time (that is the
  race being fixed).
- The state store owns the identity and stamps it inside `createRun`, rather than each admit path passing it.
  Rules out threading a field through `handleWriteLoopStart` and `write-loop.ts prepareRun` — a future admit
  path that forgets the field would silently become sweepable by its own daemon.
- `openStateStore` takes an optional identity override so tests can simulate a prior incarnation. Rules out
  monkeypatching `process.pid`.
- Candidate rule is `daemon_identity IS NULL OR daemon_identity <> :current`, ANDed with the existing
  status/pending predicate. NULL (pre-migration rows) stays sweepable: those were written by an earlier
  process by construction.
- The pending-retry SELECT is scoped by the same identity predicate. A `reconciliation_pending = 1` row is
  already `killed`, so status alone can't exclude it; identity can, and a pending row's identity is a prior
  incarnation by construction (a failed append aborts startup).
- Forward-only migration `011-run-daemon-identity` adds a nullable `daemon_identity` column. No backfill.
- `daemon_identity` is not added to `RUN_COLUMNS` / the `Run` type. Deferred to first consumer: exposing the
  admitting daemon on reads — pin when a caller needs it.

## Acceptance criteria

- [ ] A run admitted by the current process is never reconciled by that same process's sweep, whenever the
      sweep runs — including a run admitted after the daemon booted and a sweep invoked afterward.
- [ ] A non-terminal run whose recorded identity differs from the current process's is killed with
      `run_reconciled / killed / daemon_restart`, as before.
- [ ] A non-terminal run with no recorded identity (pre-migration row) is killed, as before.
- [ ] Two identities from the same pid but different process-start epochs compare as different incarnations.
- [ ] Every existing test in `v2/src/daemon/daemon-reconciliation.test.ts` stays green, including the
      pending-append retry case at `:116` (a `reconciliation_pending` row left by a prior incarnation still
      retries exactly once) and the startup-ordering case at `:162`.
- [ ] Opening a state store on a database written before this change succeeds and reconciles as above
      (migration applies without backfill).

## Documentation updates

- `v2/docs/daemon-host.md` — restart-reconciliation section: scope is "runs admitted by a prior daemon
  incarnation", with the guarantee that rows admitted by the current process are never candidates.
- `v2/docs/state-store.md` — `daemon_identity` on the `runs` row; the `011-run-daemon-identity` migration.
- `v2/docs/v1-behaviors.md` — only if v1 reconciliation behavior changes (it should not; v1 has no daemon).
