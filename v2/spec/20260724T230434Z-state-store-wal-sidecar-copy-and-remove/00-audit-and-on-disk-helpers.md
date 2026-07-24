# 00 - Audit and on-disk orchestration store helpers

WAL places `-wal` and `-shm` beside the main database. Harness code that copies or deletes only the
primary file can strand committed rows or leave a torn store.

## Decisions

- Plan-time audit (re-run at implement; amend this list only on mismatch) — rules out guessing call sites.
- **Copy (filesystem):** none at plan time; shared `copyOrchestrationStore` is the harness copy path until a caller lands — rules out ad-hoc `copyFileSync` on `v2.sqlite` alone.
- **Remove (filesystem):** test teardown only at plan time — `v2/src/persistence/state-store.test.ts` (`removeDbFiles`), `v2/src/persistence/state-store-wal-open.test.ts` (inline triple `rmSync`), `v2/src/persistence/state-store-wal-concurrency.test.ts` (inline triple `rmSync`), `v2/src/daemon/daemon-reconciliation.test.ts` (`removeDbFiles`) — rules out leaving duplicate single-file teardown.
- Sidecar suffixes derive from the main DB path (`${dbPath}-wal`, `${dbPath}-shm`); `:memory:` and other non-file paths skip filesystem copy/remove — rules out globbing `state/` or hard-coding only `~/.jarvis/state/v2.sqlite`.
- `copyOrchestrationStore` / `removeOrchestrationStore` live beside `state-store.ts` under `v2/src/persistence/` — rules out a `scripts/` or operator-only helper with no production import path.
- Deferred to first consumer: SQLite online backup API vs filesystem copy for backup — pin when the first copy caller lands.

## Tasks

- [ ] Re-audit `v2/src` and `shared/` for filesystem copy/remove of the orchestration store; if the set differs from **Decisions**, update that section before coding.
- [ ] Add `v2/src/persistence/state-store-on-disk.ts` exporting path listing, copy, and remove for on-disk stores.
- [ ] Add `v2/src/persistence/state-store-on-disk.test.ts` covering WAL-backed committed rows, copy round-trip, and remove cleanup.
- [ ] `bun run typecheck` and `bun run test:v2`.

## Acceptance criteria

- [x] `state-store-on-disk.test.ts` copies a WAL-backed store with a committed run row to a fresh path, reopens the copy, and reads the same row; it fails against the pre-fix code.
- [x] `state-store-on-disk.test.ts` asserts copy that omits `-wal` and/or `-shm` loses the committed row when the copy is opened; it fails when sidecar copy is present.
- [x] `state-store-on-disk.test.ts` asserts `removeOrchestrationStore` deletes the main file and both sidecars when present; a guard that removes only the main file leaves `-wal`/`-shm` and fails the test.
- [x] `state-store-on-disk.test.ts` asserts copy/remove are no-ops (no throw) for `:memory:` paths.

## Documentation updates

None — operator docs ship in [01](./01-route-remove-sites-and-docs.md).
