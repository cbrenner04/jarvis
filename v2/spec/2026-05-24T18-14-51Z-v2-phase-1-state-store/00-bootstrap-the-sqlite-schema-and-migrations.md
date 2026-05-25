# 00 - Bootstrap the SQLite schema and migrations

Start Phase 1 by making the durable model real without exposing repository
operations yet. This slice owns store open/bootstrap, database path resolution,
parent-directory creation, forward-only idempotent migrations, and the stable
initial schema for `runs`, `step_attempts`, and `step_outcomes`. It should
establish the invariants later slices depend on, but keep raw DB access,
repository methods, and recovery reads out of scope.

## Decisions

- Keep Phase 1 bootstrap as one public library open/init entry under `v2/src`
  that resolves the default `~/.jarvis/state/v2.sqlite` path or a caller
  override for tests/temp stores.
- Create missing parent directories on first open. Do not add WAL pragmas, lock
  policy, multi-process coordination, or daemon ownership in this slice.
- Apply migrations forward-only and idempotently on every open before returning
  the store surface. Reopening an already-current store must be a no-op for
  durable data.
- Keep the schema contract at the invariant level: one row per `runId`,
  monotonic `attemptOrdinal` scoped to `runId + stepId`, foreign-key linkage
  from attempts/outcomes back to the owning run/attempt, and at most one
  terminal outcome row per durably completed attempt.
- Keep payloads narrow: durable IDs, timestamps, run status/checkpoint fields,
  minimal work pointers, and outcome classification only. Rich blobs and
  transcript/log payloads stay out.
- Keep SQL text, row layout details, migration bookkeeping tables/helpers, and
  raw Bun SQLite handles internal.

## Task checklist

- Add the Phase 1 store bootstrap/open path under `v2/src`.
- Add migration bootstrap and the initial schema for `runs`, `step_attempts`,
  and `step_outcomes`.
- Encode the run/attempt/outcome uniqueness and foreign-key invariants needed by
  later API and recovery work.
- Add co-located tests for first-open and reopen migration behavior using temp
  databases.
- Doc-comment every exported bootstrap/store-construction symbol.

## Acceptance criteria

- [ ] A public Phase 1 library entry under `v2/src` opens the state store at
      `~/.jarvis/state/v2.sqlite` by default and accepts an explicit caller
      override path for tests/temp databases.
- [ ] First open creates missing parent directories as needed and leaves a fresh
      database at the current schema without requiring caller-managed setup.
- [ ] Reopening an already-current database reapplies migrations as a no-op and
      does not mutate previously durable run/attempt/outcome data.
- [ ] The initial schema includes `runs`, `step_attempts`, and
      `step_outcomes`, with invariants that enforce one run per `runId`,
      monotonic `attemptOrdinal` within `runId + stepId`, and at most one
      terminal outcome row per durably completed attempt.
- [ ] The schema enforces the ownership/linkage the later API depends on:
      attempts belong to runs, outcomes belong to attempts, and the store does
      not rely on caller-side SQL discipline to keep those relations valid.
- [ ] Migrations are forward-only and idempotent. This slice does not add WAL
      tuning, daemon lock policy, multi-process coordination, or any generic
      persistence abstraction.
- [ ] Co-located tests under `v2/src/*.test.ts` cover fresh bootstrap,
      override-path bootstrap, and reopen-on-current-schema behavior against
      temporary SQLite databases.
- [ ] Every exported bootstrap/store-construction symbol added in this slice has
      an inline doc-comment per `v2/docs/documentation-standard.md`.

## Documentation updates

- Inline only in this slice unless bootstrap semantics become observably
  different from `v2/docs/v2-architecture.md` or `v2/docs/v2-build-order.md`.
  If they do, update the existing durable doc in the same subspec rather than
  creating a new design doc.
