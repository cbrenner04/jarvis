# Durable gate-refusal recovery state on the run row

## Problem

`gate_invocation_refused` is the only durable trace of a refused gate invocation. `gateRefusalCause` exists in memory (`v2/src/execution/write-loop.ts`) and in the terminal `loop_finished` log entry, but nothing on the run row survives the process boundary, so recovery after a daemon restart cannot tell a waitable `slot_contention` condition from a fixed `ceiling_headroom` one and has no count with which to bound slot re-drives.

## Behavior

The run row carries a gate-refusal recovery record — closed cause, the gate command, and a non-negative slot re-drive count — written with the rest of terminal settlement evidence and readable after close/reopen. A row whose current terminal outcome is `gate_invocation_refused` but whose record predates this field, or is unparseable, loads as an explicit legacy cause with no count. Any other row loads with no recovery record at all, regardless of stale bytes a prior refusal may have left in the column.

## Decisions

- Store the recovery state as one JSON column on `runs` parsed by a dedicated `shared/` decoder, mirroring `operator_failure_record`; rules out separate scalar columns per field, which cannot express "record absent" distinctly from "count zero". The decoder decodes column bytes alone (absent/invalid/valid) and does not know the row's outcome.
- Cause is a closed set `slot_contention | ceiling_headroom | legacy_unknown`; rules out reconstructing cause by parsing settlement messages. `legacy_unknown` is a persistence-layer-only value: the write loop's in-memory `GateInvocationRefusalCause` union (`slot_contention | ceiling_headroom`) is not widened to include it, since exhaustive handling at the classification sites and the checkpoint predicate depends on that union staying two-valued.
- The read projection gates the recovery record on the row's current terminal outcome: it exposes a cause (decoded valid record, or `legacy_unknown` for a missing/unparseable column) only when that outcome is `gate_invocation_refused`; every other outcome projects no record at all, even if the column holds valid-looking or stale bytes. Rules out defaulting every row with a missing/invalid column to `legacy_unknown` regardless of outcome (which would report a refusal on rows that never refused), and rules out a resumed run's later non-refusal settlement being read back as if still refused.
- Surface a corrupt-column flag alongside the record (as `operatorFailureRecordCorrupt` does) rather than throwing on load; rules out a malformed row failing run load.
- A present count must be a non-negative integer; a negative or non-integer value makes the record invalid, not clamped.
- A slot re-drive re-enters gate admission on the same run row: `gate_invocation_refused` settles with `resumable: true` and `run resume` continues the same `runId` rather than creating a new run; the persisted count is scoped to that one row. Rules out modeling a re-drive as a fresh run, which would make the persisted count an unenforceable bound.
- Carry the record through `TerminalRunSettlementEvidence` as one caller-supplied field (cause + gate command + count) written verbatim by both `commitCompletionBoundary` and `commitTerminalRunSettlement`; the store never computes, reads back, or increments it. Rules out a store-internal read-modify-write, which would split single-source-of-truth control between caller and store, and rules out a refusal-only write path.
- Deferred to first consumer: what increments the slot re-drive count and what bound it enforces — pin when a caller needs it. This subspec only makes the count durable.
- Keep `gate_invocation_refused` and existing gate command evidence unchanged.

## Task checklist

- [ ] Add the record type and non-throwing decoder under `shared/`.
- [ ] Add the `runs` column (via the existing `addColumnIfMissing` path), the outcome-gated load projection, and settlement-evidence write.
- [ ] Tests: per-cause round-trip, reopen, legacy/corrupt fallback, outcome-gated projection.

## Acceptance criteria

- [ ] A new `shared/gate-refusal-recovery-state.ts` exports the closed cause set and a non-throwing decoder returning absent/invalid/valid, with unit tests covering each cause, a missing count, a negative count, a non-integer count, and malformed JSON.
- [ ] `v2/src/persistence/state-store.test.ts` gains a test proving each refusal cause round-trips on the run row with its gate command and slot re-drive count through terminal settlement and `loadRun`; it fails against the pre-fix single-cause record.
- [ ] `v2/src/persistence/state-store-on-disk.test.ts` gains a test proving the same recovery state is readable after closing and reopening the store.
- [ ] `v2/src/persistence/state-store-baseline-migration.test.ts` gains a compatibility test proving a run row created before the recovery column existed, whose terminal outcome is `gate_invocation_refused`, loads as an explicit `legacy_unknown` cause with no slot re-drive count, with no throw.
- [ ] `v2/src/persistence/state-store.test.ts` gains a compatibility test proving a `gate_invocation_refused` row with an unparseable recovery value loads as `legacy_unknown` with a corrupt flag and no throw.
- [ ] `v2/src/persistence/state-store.test.ts` gains a test proving a row whose current terminal outcome is not `gate_invocation_refused` loads with no gate-refusal recovery record even when the column holds a valid or stale refusal record (e.g., a resumed run that later completes); it fails if the load projection exposes a refusal cause whenever the column is non-null, without checking the row's current terminal outcome.
- [ ] `v2/docs/write-behavior.md` documents the durable refusal cause, slot re-drive count, outcome-gated projection, and legacy-row fallback.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:v2` passes.
- [ ] `bun run test:integration:v2` passes.
- [ ] `bun run test:shared` passes.
- [ ] `bun run test:integration:shared` passes.

## Documentation updates

- `v2/docs/write-behavior.md` — durable gate-refusal recovery state on the run row: cause set, gate command, slot re-drive count, outcome-gated projection, legacy/corrupt fallback.
