# Phase 1 state store

Implement Phase 1 from [`v2/docs/v2-build-order.md`](../../docs/v2-build-order.md)
and the Phase 1 persistence/recovery contract in
[`v2/docs/v2-architecture.md`](../../docs/v2-architecture.md): a pure-library
SQLite state store under `v2/` with a narrow repository API, durable
`runs` / `step_attempts` / `step_outcomes` split, and step-boundary recovery
semantics. Keep the scope repo-native and library-local: `v2/src`, co-located
tests, no daemon shell, no IPC, no execution engine, no speculative store
abstraction, no parallel store design doc. Durable doc alignment belongs inside
the owning implementation subspec when public semantics move; there is no
standalone docs slice unless an implementation subspec would stop being atomic.

- [x] [00 - Bootstrap the SQLite schema and migrations](./00-bootstrap-the-sqlite-schema-and-migrations.md)
- [ ] [01 - Expose the public state-store API](./01-expose-the-public-state-store-api.md)
- [ ] [02 - Prove recovery and duplicate-commit behavior](./02-prove-recovery-and-duplicate-commit-behavior.md)
