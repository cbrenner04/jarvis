# Pipeline-stage operator failure record contract

Module boundary: persistence (`v2/src/persistence/state-store.ts`).

Pipeline stages currently expose and accept `failureDetail: unknown`, so a caller cannot rely on a typed operator-evidence seam even though the JSON round-trips. This subspec adds a statically typed terminal-stage contract for `OperatorFailureRecord` while preserving existing opaque stage failure envelopes unchanged.

## Decision ledger

- Export `TerminalStageOperatorFailureRecordPatch` and `TerminalStageOperatorFailureRecord` with `failureDetail: OperatorFailureRecord`, then provide typed write/read operations over those contracts; rules out asking callers to cast opaque `failureDetail` to the shared record.
- The typed write accepts only a terminal `failed` stage update and its `OperatorFailureRecord` failure detail; rules out assigning operator failure evidence to an active stage or accepting arbitrary JSON as evidence.
- Existing `updateStage` opaque `failureDetail` callers and their stored envelopes remain supported; rules out a cross-daemon migration of unrelated failure details.
- The typed reader returns `null` for absent, malformed, or non-record `failure_detail` without rewriting it; rules out loader exceptions or migrate-on-read conversion of legacy envelopes.
- The typed seam writes the record directly as `failure_detail`, not a wrapper; rules out changing terminal-stage failure-detail payloads or field loss.

## Prerequisites

- [00 - Shared operator failure record](./00-shared-operator-failure-record.md)

## Task checklist

- Add exported `TerminalStageOperatorFailureRecordPatch` and `TerminalStageOperatorFailureRecord` types plus typed state-store write and read operations for `OperatorFailureRecord`.
- Serialize the record directly to `pipeline_stages.failure_detail` and validate typed reads with `parseOperatorFailureRecord`.
- Retain the existing generic stage patch/read API for all non-record envelopes.
- Add state-store regressions for typed terminal record round-trip, typed rejection, and non-throwing typed reads of absent, malformed, and legacy non-record detail.
- Document terminal-stage ownership in `state-store.md`, and record the pipeline-stage addition in `v1-behaviors.md`.

## Acceptance criteria

- [ ] `v2/src/persistence/state-store.test.ts` test `operator failure record round-trips through the typed terminal pipeline-stage contract` writes the representative record through a `TerminalStageOperatorFailureRecordPatch`, reopens the store, and asserts `TerminalStageOperatorFailureRecord.failureDetail` field-equals the record and the raw stage `failureDetail` deep-equals it; it fails against the pre-fix opaque-only contract reachable on main.
- [ ] `v2/src/persistence/state-store.test.ts` typed terminal-stage contract test refuses a nonterminal stage update and a non-record payload without changing the stored stage; it fails against the pre-fix opaque contract reachable on main.
- [ ] `v2/src/persistence/state-store.test.ts` typed terminal-stage reader test returns `null` without throwing for absent detail, malformed JSON syntax, and a valid legacy non-record envelope, while retaining the raw envelope unchanged; it fails against the pre-fix missing typed reader reachable on main.
- [ ] `v2/docs/state-store.md` documents the typed terminal-stage `OperatorFailureRecord` seam, direct `failureDetail` representation, and `null` result for absent, malformed, or legacy non-record detail.
- [ ] `v2/docs/v1-behaviors.md` records the v2 additive typed operator failure evidence on terminal pipeline-stage `failureDetail`.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:shared` passes.
- [ ] `bun run test:integration:shared` passes.
- [ ] `bun run test:v2` passes.
- [ ] `bun run test:integration:v2` passes.

## Documentation updates

- `v2/docs/state-store.md` — typed terminal-stage seam and absent/corrupt/legacy read semantics.
- `v2/docs/v1-behaviors.md` — v2 additive terminal pipeline-stage evidence.
