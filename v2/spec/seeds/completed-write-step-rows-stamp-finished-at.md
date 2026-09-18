---
name: completed-write-step-rows-stamp-finished-at
---

# Terminal run rows can still settle with `finished_at` NULL

## Problem

`commitCompletionBoundary`'s fallback UPDATE (`v2/src/persistence/state-store.ts`, ~:2761) writes a terminal `status` without `finished_at`; it is reached whenever the caller supplies no terminal settlement evidence. Deferred-publication write steps used to hit it (rows `dc2f54a1`, `576c67ce` on 2026-09-14: `completed`, `finished_at = NULL`). #3982 now passes explicit null evidence on the `completed` path, so that producer stamps the column, but the fallback remains reachable and no test pins the contract. Consumers keying on `finished_at` (session-log retention, incident candidates) misread any row that takes it.

## Decisions

- Every write into a terminal status stamps `finished_at` in the same statement, including the fallback UPDATE. Rules out a producer-by-producer fix.
- Existing terminal rows with a null `finished_at` are backfilled from `status_changed_at` in a migration.

## Acceptance criteria

- [ ] A state-store test proves a terminal write with no settlement evidence records a non-null `finished_at`; it fails against the current fallback UPDATE.
- [ ] A migration test proves terminal rows with null `finished_at` are backfilled and non-terminal rows are untouched.

## Documentation updates

- `v2/docs/state-store.md` — terminal rows always carry `finished_at`.
