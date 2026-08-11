# 00 - Persist the in-flight ready-gate group id

Module boundary: persistence (`v2/src/persistence/state-store.ts`).

A run's ready gate spawns a test process tree that outlives the harness when the run is terminated. Reaping it later requires knowing the group id, so the owning run must record it durably while the gate is in flight and clear it on settlement. This subspec adds only the durable field and its accessors; the gate itself is wired in `01`.

## Decisions

- The group id lives on the `runs` row as a nullable `ready_gate_pgid` INTEGER, not in a new table — one in-flight gate per run, so a row-scoped column is the shape and it rules out a join for a single scalar.
- Recording replaces any prior value on that run; a group id therefore belongs to exactly one run because the run row is the only writer of its own column.
- `null` means "no gate in flight"; clearing is `setReadyGatePgid(runId, null)` rather than a separate clear method, so the in-flight and settled transitions share one code path.
- Exposed on the `Run` type and `RUN_COLUMNS` (unlike `owner_identity`, which stays internal) because the eventual sweep reads it through `loadRun`.
- Appended as a new `SCHEMA_MIGRATIONS` entry (`025-run-ready-gate-pgid`); no backfill — pre-migration rows read back `null`.

## Task checklist

- [ ] Append migration `025-run-ready-gate-pgid` (`ALTER TABLE runs ADD COLUMN ready_gate_pgid INTEGER`).
- [ ] Add `readyGatePgid: number | null` to `Run`, `RUN_COLUMNS`, and `mapRunRow`.
- [ ] Add `setReadyGatePgid(runId: string, pgid: number | null)` to the `StateStore` interface and implementation.
- [ ] Tests in `v2/src/persistence/state-store.test.ts` covering record, replace, clear, and the pre-migration/unset default.

## Acceptance criteria

- [ ] A run's in-flight ready-gate group id is recorded durably and clearing it reads back as absent; a new test in `v2/src/persistence/state-store.test.ts` records a group id, reloads the run, clears it, and reloads again — it fails against the pre-fix code (no such field or setter exists).
- [ ] A run created without a gate in flight reads back no group id, and a recorded id replaces the prior value for that run.
- [ ] Existing `v2/src/persistence/state-store.test.ts` and `v2/src/persistence/state-store-on-disk.test.ts` stay green (schema growth is additive; no existing column or reader changes).
- [ ] Clearing writes NULL rather than leaving the prior value: replacing the setter's bound value with a non-null constant turns the clear assertion red. `v2/src/persistence/state-store.test.ts` — `records, replaces, and clears the in-flight ready-gate group id`; Mutation checkpoint: the clear path's suppressed effect is proven absent by the reload assertion.
- [ ] The recorded id survives a reload rather than being synthesized on read. `v2/src/persistence/state-store.test.ts` — `records, replaces, and clears the in-flight ready-gate group id`; Keystone checkpoint: mapping `readyGatePgid` to a constant `null` in `mapRunRow` (baseline read semantics) turns this test red.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/state-store.md` — document the `runs.ready_gate_pgid` column, the `025-run-ready-gate-pgid` migration (no backfill), and `setReadyGatePgid` semantics (record / replace / clear-to-NULL, one in-flight gate per run).
