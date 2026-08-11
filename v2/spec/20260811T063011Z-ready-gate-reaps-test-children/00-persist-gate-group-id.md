# 00 - Persist the in-flight ready-gate group id

Module boundary: persistence (`v2/src/persistence/state-store.ts`).

A run's ready gate spawns a test process tree that outlives the harness when the run is terminated. Reaping it later requires knowing the group id, so the owning run must record it durably while the gate is in flight and clear it on settlement. This subspec adds only the durable field and its accessors; the gate itself is wired in `01`/`02`.

## Decisions

- The group id lives on the `runs` row as a nullable `ready_gate_pgid` INTEGER, not in a new table — one in-flight gate per run, so a row-scoped column is the shape and it rules out a join for a single scalar.
- Recording replaces any prior value on that run; a group id therefore belongs to exactly one run because the run row is the only writer of its own column. This holds only in the write direction: a recycled OS pid could let a later sweep's `kill(-pgid)` hit an unrelated process group. Staleness discrimination (e.g. a recorded-at timestamp to bound how old a "the group is gone" read may be) is deferred to the sweep's own migration, which is the first consumer that needs it — no speculative column here.
- `null` means "no gate in flight"; clearing is `setReadyGatePgid(runId, null)` rather than a separate clear method, so the in-flight and settled transitions share one code path in the caller, but the implementation branches internally on `pgid === null` (its own `UPDATE ... SET ready_gate_pgid = NULL` statement) rather than one generic bound-parameter update — so a mutation neutering only the null branch reddens the clear test without touching the record test.
- Exposed on the `Run` type and `RUN_COLUMNS` (unlike `owner_identity`, which stays internal) because the eventual sweep reads it through `loadRun`.
- Appended as a new `SCHEMA_MIGRATIONS` entry (`025-run-ready-gate-pgid`); no backfill — pre-migration rows read back `null`.

## Task checklist

- [ ] Append migration `025-run-ready-gate-pgid` (`ALTER TABLE runs ADD COLUMN ready_gate_pgid INTEGER`).
- [ ] Add `readyGatePgid: number | null` to `Run`, `RUN_COLUMNS`, and `mapRunRow`.
- [ ] Add `setReadyGatePgid(runId: string, pgid: number | null)` to the `StateStore` interface and implementation, branching on `pgid === null` so the clear path is its own statement.
- [ ] Tests in `v2/src/persistence/state-store.test.ts` covering record, replace, clear (as separate `test()` bodies so mutation/keystone checkpoints can target them independently), and the pre-migration/unset default.

## Acceptance criteria

- [ ] A run's in-flight ready-gate group id is recorded durably and a recorded id replaces the prior value for that run; a new test `records and replaces the in-flight ready-gate group id` in `v2/src/persistence/state-store.test.ts` records a group id, reloads the run, records a second id, and reloads again — it fails against the pre-fix code (no such field or setter exists).
- [ ] Clearing the group id reads back as absent; a new test `clears the in-flight ready-gate group id on settlement` in `v2/src/persistence/state-store.test.ts` records a group id, clears it, and reloads — it fails against the pre-fix code.
- [ ] A run created without a gate in flight reads back no group id.
- [ ] Existing `v2/src/persistence/state-store.test.ts` and `v2/src/persistence/state-store-on-disk.test.ts` stay green (schema growth is additive; no existing column or reader changes).
- [ ] Clearing writes NULL rather than leaving the prior value: replacing the setter's `pgid === null` branch with `if (false)` leaves the recorded id set after a clear, without affecting the record path. `v2/src/persistence/state-store.test.ts` — `clears the in-flight ready-gate group id on settlement`; Mutation checkpoint: the clear branch's suppressed effect is proven absent by the reload assertion, and the record test above stays green under the same mutation.
- [ ] The recorded id survives a reload rather than being synthesized on read. `v2/src/persistence/state-store.test.ts` — `records and replaces the in-flight ready-gate group id`; Keystone checkpoint: mapping `readyGatePgid` to a constant `null` in `mapRunRow` (baseline read semantics) turns this test red.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/state-store.md` — document the `runs.ready_gate_pgid` column, the `025-run-ready-gate-pgid` migration (no backfill), and `setReadyGatePgid` semantics (record / replace / clear-to-NULL via a dedicated null branch, one in-flight gate per run, pgid staleness discrimination deferred to the sweep).
