# 00 - Choose SQLite bootstrap and migration ownership

Phase 1 starts by making the SQLite boundary concrete without pulling in any
daemon assumptions. This slice chooses the package, database file-location
policy, connection bootstrap path, and forward-only migration ownership for a
pure library under `v2/`. It should not define the full schema contents or the
runtime API yet; it only establishes how later subspecs create and open the
store predictably in tests and real runs. The goal is to leave no ambiguity
about who owns schema bootstrap, where the database lives, or how a later phase
opens the same store without re-deciding Phase 1 infrastructure.

## Decisions

- Choose one SQLite package that works under Bun and TypeScript without adding
  an alternate-database seam.
- Keep the store library-owned and synchronous or transaction-friendly enough
  for repository-style operations; do not require a daemon singleton writer,
  WAL mode, or IPC lifecycle to be correct.
- Define one canonical database path policy under `~/.jarvis` for real runs and
  an explicit override for tests or callers that need a temp file.
- Make schema setup library-owned: one exported bootstrap entrypoint opens the
  database and applies forward-only migrations idempotently before any
  repository API is used.
- Keep migration policy minimal: ordered versioning, append-only upgrades, no
  rollback tooling, no speculative lock strategy, no alternate backend hooks.
- Persist migration state in a library-owned schema-version mechanism so the
  store can distinguish first boot from upgrade without daemon help.

## Task Checklist

- Choose and document the Phase 1 SQLite dependency and why it fits Bun/v2.
- Define the exact database path policy and the caller override shape for
  tests.
- Define the exported bootstrap contract that opens the database and applies
  migrations.
- Define the migration metadata and forward-only versioning policy Phase 1
  owns.

## Acceptance criteria

- [ ] The subspec names one concrete SQLite dependency for `v2/` and explicitly
      rejects introducing an ORM, swappable backend abstraction, or daemon-only
      writer assumptions in Phase 1.
- [ ] The subspec chooses one exact on-disk database location under
      `~/.jarvis` plus one explicit override path for tests and callers, with no
      second location policy or environment-specific branching.
- [ ] The subspec defines a single exported library bootstrap path that opens
      the database and applies schema creation or forward-only migrations
      idempotently before any repository operation is allowed.
- [ ] The subspec defines a minimal migration story owned by the library:
      ordered schema versions, append-only upgrades, library-owned migration
      metadata, and no rollback tooling, WAL requirement, singleton-process
      contract, or daemon lock policy as acceptance criteria.
- [ ] The subspec keeps scope to package/bootstrap/versioning only; the run,
      step, attempt, and outcome records themselves remain for the next
      subspec.

## Documentation updates

- Update `v2/docs/v2-build-order.md` so Phase 1 explicitly says the SQLite
  state store starts as a pure library with library-owned bootstrap and
  migrations, not a daemon-owned persistence shell.
- Update `v2/docs/v2-architecture.md` so its persistence section stops treating
  daemon single-writer or WAL details as prerequisites for Phase 1 correctness.
