---
name: state-store-wal-concurrent-writes
---

# State store tolerates concurrent writers under WAL

## Problem

`StateStoreImpl` opens SQLite with default `journal_mode=delete` and `busy_timeout=0`, so a second
concurrent writer fails immediately with `database is locked`. Overlapping intent/plan/implement
workflows routinely hit that path; the loser dies after a completed write step with
`run_execution_failed` and no PR.

A concurrent **reader** is enough to trigger it. Under a rollback journal a reader's shared lock
blocks a writer, and `busy_timeout = 0` means the writer fails rather than waits. Observed
2026-07-24: a lone intent workflow — no other workflow running — died `database is locked` while the
operator polled `jarvis run list` on a 45-second loop. `jarvis tui` polls `list` continuously on its
refresh tick, so routine observation can destroy the run being observed.

## Decisions

- Apply `journal_mode=WAL` and a non-zero `busy_timeout` in `StateStoreImpl` construction so every
  caller (daemon, CLI, tests) inherits them — rules out per-call-site retry wrappers.
- Name the busy-timeout constant with an explicit rationale; it must exceed the longest single store
  transaction — rules out a bare millisecond literal with no contract.
- Migrate an existing non-WAL `v2.sqlite` to WAL in place on open with rows intact — rules out
  requiring a manual dump/restore.
- Out of scope: multi-machine or networked access to one store.

## Acceptance criteria

- [ ] A newly constructed `StateStore` reports `journal_mode = wal` and a non-zero `busy_timeout`; a
      test asserting pre-fix defaults (`delete` / `0`) fails against the pre-fix code.
- [ ] A test drives two concurrent writers against one store file and asserts both commit without
      `database is locked`; it fails against the pre-fix code.
- [ ] A concurrent reader observes committed rows while a writer holds a transaction; the test fails
      against the pre-fix code.
- [ ] A reader polling the store in a loop does not cause a concurrent writer to fail
      `database is locked` — the observation path (`list`) must not be able to kill the run it
      observes; it fails against the pre-fix code.
- [ ] Opening a pre-migration `journal_mode=delete` database file yields WAL mode afterward with all
      prior rows loadable; the test fails against the pre-fix code.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/state-store.md` — journal mode, busy timeout, `-wal`/`-shm` sidecars, and the
  reader/writer concurrency guarantee.
- `v2/docs/operator-runbook.md` § Concurrency — concurrent workflows are safe against the store
  once this ships (remove any caveat that overlapping runs were store-unsafe).

## Sibling order

Same `StateStore` / runbook seam — plan and run serially after each predecessor merges to `main`:
(1) this intent, (2) `state-store-wal-sidecar-copy-and-remove`, (3)
`resume-after-state-store-lock-timeout`. No parallel plan fan-out on one base.

## Prerequisites

None.
