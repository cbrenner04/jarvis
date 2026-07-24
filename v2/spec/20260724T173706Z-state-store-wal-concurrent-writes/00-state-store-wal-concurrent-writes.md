# WAL open settings, migration, and concurrency

`StateStoreImpl` opens SQLite with rollback journal and `busy_timeout=0`, so a second writer or
even a concurrent reader fails with `database is locked`. Overlapping workflows and routine
`jarvis run list` / TUI polling can kill the run being observed.

## Decisions

- Set `journal_mode=WAL` and a non-zero `busy_timeout` in `StateStoreImpl` immediately after
  `Database` construction — rules out per-call-site retry wrappers.
- Export a named `STATE_STORE_BUSY_TIMEOUT_MS` (or equivalent) with a one-line comment that the
  value must exceed the longest single store transaction (`commitCompletionBoundary` and peers) —
  rules out an unexplained millisecond literal.
- Run `PRAGMA journal_mode=WAL` on every open so an existing `delete` `v2.sqlite` migrates in
  place with rows intact — rules out operator dump/restore.
- Concurrency regression tests use two `openStateStore` connections on one path — rules out
  mocking SQLite lock errors without real connections.
- List-polling regression loops `StateStore.listRuns()` (same durable reads as daemon `list`) while
  a peer connection commits boundaries — rules out only exercising `loadRun` in isolation.
- **SQLite serialises writers in every journal mode.** WAL buys reader-vs-writer concurrency; a
  non-zero `busy_timeout` buys writer-vs-writer *waiting* instead of instant failure. A peer write
  issued from inside another connection's open write transaction (e.g. a `beforeRunUpdate` hook) can
  never complete — it burns the whole busy timeout and fails. That is a deadlock the test builds, not
  contention it observes. Rules out any test asserting two simultaneously-open write transactions
  both commit; a first attempt did exactly this and hung 30 s before failing.
- The incident this fixes is many short, non-overlapping write transactions from **separate
  connections** (seventeen live daemons on one file), which `busy_timeout` resolves. Rules out
  framing the fix as concurrent-write support.
- Out of scope: multi-machine or networked access to one store file — rules out NFS/remote locking
  design.

## Tasks

- [ ] After `new Database(dbPath)` in `StateStoreImpl`, apply WAL journal mode and
      `STATE_STORE_BUSY_TIMEOUT_MS` via `PRAGMA`.
- [ ] Add `v2/src/persistence/state-store-wal-open.test.ts` for journal mode, busy timeout, and
      delete→WAL migration with seeded rows.
- [ ] Add `v2/src/persistence/state-store-wal-concurrency.test.ts` for dual writers, reader during
      an open writer transaction, and `listRuns` polling vs concurrent commits.
- [ ] Update `v2/docs/state-store.md`, `v2/docs/operator-runbook.md` § Concurrency, and
      `v2/docs/v1-behaviors.md` per Documentation updates.
- [ ] `bun run typecheck`, `bun run test:v2`, `bun run test:integration:v2`.

## Acceptance criteria

- [ ] `state-store-wal-open.test.ts` asserts a new `openStateStore` database reports
      `journal_mode = wal` and a non-zero `busy_timeout` on the store connection; it fails against
      pre-fix defaults (`delete` / `0`).
- [ ] `state-store-wal-concurrency.test.ts` drives a second writer on a separate connection whose
      transaction does **not** nest inside the first writer's open transaction, and asserts it
      commits without `database is locked`; it fails against pre-fix code (`busy_timeout=0` rejects
      it immediately rather than waiting).
- [ ] `state-store-wal-concurrency.test.ts` asserts a concurrent reader observes committed rows
      while a writer holds an uncommitted transaction; it fails against pre-fix code.
- [ ] `state-store-wal-concurrency.test.ts` loops `listRuns` on a reader connection while a writer
      commits completion boundaries and asserts the writer never surfaces `database is locked`; it
      fails against pre-fix code.
- [ ] `state-store-wal-open.test.ts` opens a pre-seeded `journal_mode=delete` file and asserts WAL
      mode afterward with all prior rows loadable; it fails against pre-fix code.
- [ ] Inverting WAL journal setup or setting `busy_timeout` to `0` fails at least one test in
      `state-store-wal-open.test.ts` or `state-store-wal-concurrency.test.ts`.
- [ ] `state-store.test.ts` stays green.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/state-store.md` — WAL journal mode, `STATE_STORE_BUSY_TIMEOUT_MS` contract, `-wal`/`-shm`
  sidecars, and the single-machine reader/writer concurrency guarantee.
- `v2/docs/operator-runbook.md` § Concurrency — overlapping workflows and list/TUI polling are safe
  against the durable store on one machine; remove any caveat that overlapping runs were
  store-unsafe.
- `v2/docs/v1-behaviors.md` — record WAL + busy-timeout open settings and local concurrent store
  access semantics. Sources: `v2/src/persistence/state-store.ts`.
