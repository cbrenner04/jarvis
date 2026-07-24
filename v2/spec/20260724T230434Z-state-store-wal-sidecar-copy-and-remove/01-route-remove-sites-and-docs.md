# 01 - Route audited remove sites and operator docs

Test harnesses still duplicate single-file teardown. Operators hand-copying `v2.sqlite` without sidecars
hit the same failure mode as a bad harness copy.

## Decisions

- Route every audited **remove** site from [00](./00-audit-and-on-disk-helpers.md) through `removeOrchestrationStore`; do not add parallel delete helpers — rules out a second teardown API.
- Any **new** in-repo copy/remove of the orchestration store during this subspec must call the [00](./00-audit-and-on-disk-helpers.md) helpers — rules out landing another single-file path while migrating tests.
- Operator backup, purge, and hand-copy guidance lives in `v2/docs/state-store.md` (cross-link from the WAL sidecar bullet); harness CLI behavior is unchanged — rules out documenting manual sidecar handling as the primary contract.

## Tasks

- [ ] Replace local `removeDbFiles` / inline triple `rmSync` at the four audited test sites with `removeOrchestrationStore`.
- [ ] Update `v2/docs/state-store.md` and `v2/docs/v1-behaviors.md` per Documentation updates.
- [ ] `bun run typecheck` and `bun run test:v2`.

## Acceptance criteria

- [x] `state-store.test.ts`, `state-store-wal-open.test.ts`, `state-store-wal-concurrency.test.ts`, and `daemon-reconciliation.test.ts` import `removeOrchestrationStore` and contain no `removeDbFiles` helper and no inline `${dbPath}-wal` / `${dbPath}-shm` teardown `rmSync` triples.
- [x] `state-store.test.ts`, `state-store-wal-open.test.ts`, `state-store-wal-concurrency.test.ts`, and `daemon-reconciliation.test.ts` stay green.
- [x] `state-store-on-disk.test.ts` stays green.

## Documentation updates

- `v2/docs/state-store.md` — backup, purge, and hand-copy must move or delete `v2.sqlite`, `v2.sqlite-wal`, and `v2.sqlite-shm` together; cross-link from the WAL sidecar section.
- `v2/docs/v1-behaviors.md` — same operator contract under the state-store entry; sources `v2/src/persistence/state-store-on-disk.ts`.
