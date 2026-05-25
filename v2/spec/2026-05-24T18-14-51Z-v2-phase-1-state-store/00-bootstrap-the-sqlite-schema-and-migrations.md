# 00 - Bootstrap the SQLite schema and migrations

Make the durable model real before repository operations exist. This slice owns
store open/bootstrap, path resolution, parent-directory creation, forward-only
idempotent migrations, and the initial schema for `runs`, `step_attempts`, and
`step_outcomes`. It establishes the invariants later slices rely on. Public
repository methods, recovery semantics, and duplicate-commit behavior stay out.

## Decisions

- One public open/init entry under `v2/src` resolves the default
  `~/.jarvis/state/v2.sqlite` path or a caller override.
- First open creates missing parent directories.
- Every open applies forward-only idempotent migrations before returning.
- Reopen on current schema is a durable no-op.
- The schema must enforce, not merely document: one row per `runId`; monotonic
  `attemptOrdinal` within `runId + stepId`; foreign-key ownership from attempts
  to runs and outcomes to attempts; at most one durable outcome row per
  durably completed attempt.
- Payloads stay narrow: durable IDs, timestamps, run status/checkpoint fields,
  minimal work pointers, outcome classification.
- WAL, lock policy, multi-process coordination, daemon ownership, raw DB
  handles, and migration internals stay out of the public contract.

## Task checklist

- Add the Phase 1 open/bootstrap path under `v2/src`.
- Add migration bootstrap and the initial `runs` / `step_attempts` /
  `step_outcomes` schema.
- Encode the run/attempt/outcome invariants later slices depend on.
- Add co-located temp-db tests for first-open and reopen behavior.
- Doc-comment exported bootstrap symbols.

## Acceptance criteria

- [ ] A public Phase 1 library entry under `v2/src` opens the state store at
      `~/.jarvis/state/v2.sqlite` by default and accepts an explicit caller
      override path for tests/temp databases, with no caller-managed bootstrap
      steps.
- [ ] First open creates missing parent directories as needed and leaves a fresh
      database at the current schema without requiring caller-managed setup.
- [ ] Reopening an already-current database reapplies migrations as a no-op and
      does not mutate previously durable run/attempt/outcome data.
- [ ] The initial schema includes `runs`, `step_attempts`, and
      `step_outcomes`, with invariants that enforce one run per `runId`,
      monotonic `attemptOrdinal` within `runId + stepId`, and at most one
      durable outcome row per durably completed attempt.
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

- Inline only unless bootstrap semantics become observably different from
  `v2/docs/v2-architecture.md` or `v2/docs/v2-build-order.md`.
- If they do, update the existing durable doc in this subspec. No new design
  doc.
