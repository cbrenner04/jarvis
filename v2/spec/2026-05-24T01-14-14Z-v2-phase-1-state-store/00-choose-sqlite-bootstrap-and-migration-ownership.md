# 00 - Choose SQLite bootstrap and migration ownership

Phase 1 starts by making the SQLite boundary concrete without pulling in daemon
assumptions. This slice chooses the package, database file policy, bootstrap
entrypoint, and forward-only migration ownership for a pure library under
`v2/`. It does not define the schema contents or repository API yet. Its job is
to make later subspecs open the same store the same way in tests and real runs.

## Decisions

- Choose one SQLite package that works under Bun and strict TypeScript without
  introducing an ORM or alternate-backend seam.
- Keep the store library-owned and transaction-friendly; correctness must not
  depend on WAL, a singleton writer, or daemon lifecycle state.
- Define one canonical on-disk database location under `~/.jarvis` plus one
  explicit caller-supplied override for tests and temp stores.
- Make schema setup library-owned: one exported bootstrap path opens the
  database and applies forward-only migrations idempotently before repository
  operations are constructed.
- Keep migration policy minimal: ordered versions, append-only upgrades,
  library-owned metadata, and no rollback tooling or daemon-era lock policy.

### Chosen dependency

- Use Bun's built-in `bun:sqlite` for `v2/`.
- Phase 1 explicitly does not introduce an ORM, a swappable backend abstraction,
  or daemon-only writer assumptions.

### Database path policy

- Canonical on-disk location: `~/.jarvis/state/v2.sqlite`.
- One explicit override path: callers may pass `dbPath` to bootstrap for tests
  and temp stores.
- No second location policy, no environment-variable branching.

### Bootstrap contract

- Export exactly one bootstrap entrypoint: `bootstrapStateStore(options?)`.
- `bootstrapStateStore` opens the SQLite database, creates migration metadata if
  missing, and applies forward-only migrations to latest before returning any
  repository/store object.
- Bootstrap is idempotent: repeated calls on the same file do not re-apply
  applied versions.

### Migration ownership and policy

- Migrations are library-owned, ordered by monotonically increasing schema
  version (1, 2, 3, ...), append-only.
- Library-owned metadata table tracks applied versions and timestamps.
- No rollback/down migrations, WAL requirement, singleton-process contract, or
  daemon lock policy in Phase 1 acceptance.
- Scope here is only package/bootstrap/versioning; run/step/attempt/outcome
  record shape is deferred to subspec 01.

## Task Checklist

- Choose and document the SQLite dependency.
- Define the database path policy and override contract.
- Define the bootstrap contract that opens the database and applies
  migrations.
- Define the migration metadata and forward-only versioning policy.

## Acceptance criteria

- [x] The subspec names one concrete SQLite dependency for `v2/` and explicitly
      rejects introducing an ORM, swappable backend abstraction, or daemon-only
      writer assumptions in Phase 1.
- [x] The subspec chooses one exact on-disk database location under
      `~/.jarvis` plus one explicit override path for tests and callers, with no
      second location policy or environment-specific branching.
- [x] The subspec defines a single exported library bootstrap path that opens
      the database and applies schema creation or forward-only migrations
      idempotently before any repository object or operation is exposed.
- [x] The subspec defines a minimal migration story owned by the library:
      ordered schema versions, append-only upgrades, library-owned migration
      metadata, and no rollback tooling, WAL requirement, singleton-process
      contract, or daemon lock policy as acceptance criteria.
- [x] The subspec keeps scope to package/bootstrap/versioning only; the run,
      step, attempt, and outcome records themselves remain for the next
      subspec.

## Documentation updates

- Update `v2/docs/v2-build-order.md` so Phase 1 explicitly says the SQLite
  state store starts as a pure library with library-owned bootstrap and
  migrations, not a daemon-owned persistence shell.
- Update `v2/docs/v2-architecture.md` so its persistence section stops treating
  daemon single-writer or WAL details as prerequisites for Phase 1 correctness.
