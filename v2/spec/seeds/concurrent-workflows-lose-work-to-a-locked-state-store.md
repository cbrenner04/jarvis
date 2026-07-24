# Concurrent workflows discard completed work with "database is locked"

## Problem

The state store opens SQLite with **no pragmas**: `v2/src/persistence/state-store.ts:380` is a bare
`new Database(dbPath)`, and no `journal_mode` or `busy_timeout` is set anywhere in `v2/src`. The live
store confirms the defaults:

```console
$ sqlite3 ~/.jarvis/state/v2.sqlite "PRAGMA journal_mode; PRAGMA busy_timeout;"
delete
0
```

A rollback journal admits one writer at a time, and `busy_timeout = 0` means a blocked writer fails
**immediately** rather than retrying. So whenever two workflows write the store at the same instant,
one throws `database is locked`. That surfaces as `run_execution_failed`, which is the
"workflow ends complete but produced no PR" path: the workflow dies *after* its write step settles,
so a finished agent iteration is discarded with nothing committed, pushed, or published.

Observed 2026-07-24, **twice in one three-minute window**, on two independent intent workflows
launched alongside one implement workflow. Both had a clean single-iteration write step, and both
died on the store:

```text
0b6e85cf  intent role-stalled-discards-a-committed-write-step
  17:12:59  iteration_started
  17:13:43  boundary_committed  outcomeKind=done  runStatus=completed
  17:13:43  loop_finished       loopOutcomeKind=complete  iterationsConsumed=1
  17:15:05  run_execution_failed  "database is locked"

53254b48  intent commit-each-write-iteration
  17:13:04  iteration_started
  17:14:07  boundary_committed  outcomeKind=done  runStatus=completed
  17:14:07  loop_finished       loopOutcomeKind=complete  iterationsConsumed=1
  17:14:07  run_execution_failed  "database is locked"
```

The surviving third workflow is the one that happened to win the lock races. Both losers report
`harness_failure`, `retryable: false`, `nextAction: "stop"` — the row's own remediation is to give up,
and the completed agent work plus its token spend are gone.

This is a standing tax on the documented operating model. The v2 runbook § Concurrency and the
operator's own practice both call for fanning out intents and plans while throttling implements; that
guidance is unsafe as long as any two overlapping workflows can silently destroy each other's
finished work. It is also a better-supported explanation than the one on record for at least one
prior stranding: `20260723T140222Z-run-list-query-limit-cap`'s "one `complete`-but-never-published
run" was attributed to "likely a digest rotation orphaning publication" — same signature, and this
cause is directly observable while that one was not.

## Decisions

- Open the store in WAL mode with a non-zero busy timeout, applied at construction in
  `StateStoreImpl` so every caller — daemon, CLI, tests — gets it without opting in. Rules out
  per-call-site retry wrappers, which would leave any missed path lossy.
- Set the busy timeout from a named constant with an explicit rationale, not a bare literal. It must
  exceed the longest single store transaction; the point is to make a contended writer *wait*, not to
  convert a fast failure into a slow one.
- `database is locked` reaching `run_execution_failed` at all is the second defect and must be fixed
  independently: after WAL, a genuine lock timeout is still possible under enough concurrency, and it
  must not present as an unretryable harness failure over a completed write step. Classify it
  retryable with a resume path, consistent with the `role_timeout` precedent (#2003). Rules out
  treating the pragma change as the whole fix.
- WAL leaves `-wal` and `-shm` sidecar files next to the database; anything that copies, backs up, or
  deletes `v2.sqlite` must account for them. Audit the existing backup and purge paths (there are
  already `v2.sqlite.bak-*` files in the live home) rather than assuming a single-file store.
- Out of scope: multi-machine or networked access to one store. Single operator, one machine.

## Acceptance criteria

- [ ] A newly constructed `StateStore` reports `journal_mode = wal` and a non-zero `busy_timeout`;
      asserting the pre-fix defaults (`delete` / `0`) fails.
- [ ] A test drives two concurrent writers against one store file and asserts both commit, with
      neither throwing `database is locked`; it fails against the pre-fix code.
- [ ] A store contended past its busy timeout surfaces a retryable failure with a resume path — not
      `harness_failure` / `nextAction: "stop"` — and the run's completed write step is preserved.
- [ ] A concurrent reader observes committed rows while a writer holds a transaction, pinning the
      reader/writer concurrency WAL is being adopted for.
- [ ] An existing non-WAL `v2.sqlite` is migrated in place on open, with its rows intact afterward.
- [ ] Whatever copies or removes the database file handles the `-wal` and `-shm` sidecars; a test
      pins that a round-trip through that path preserves committed rows.
- [ ] `bun run typecheck`, `bun run test:v2`, `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/state-store.md` — journal mode, busy timeout, the sidecar files, and the concurrency
  guarantee they buy.
- `v2/docs/daemon-host.md` — the contended-store failure row: reason, retryability, `nextAction`.
- `v2/docs/operator-runbook.md` — § Concurrency currently throttles only implement runs on CPU
  grounds; record that concurrent workflows were unsafe against the store until this shipped, and
  delete the caveat once it has.

## Prerequisites

None. The change is contained to the store's construction plus the failure classification.
