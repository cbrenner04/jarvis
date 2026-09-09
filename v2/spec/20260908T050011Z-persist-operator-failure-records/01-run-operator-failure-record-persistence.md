# Run operator failure record persistence

Module boundary: persistence (`v2/src/persistence/state-store.ts`).

Run rows retain binding-chain `terminal_failure_detail` but no typed operator evidence. This subspec adds independently recoverable `OperatorFailureRecord` run evidence and its migration, settlement, corruption, and transaction guarantees. Pipeline-stage storage is deferred to [02](./02-pipeline-stage-operator-failure-record-contract.md).

## Decision ledger

- Add nullable `runs.operator_failure_record` TEXT JSON and surface `operatorFailureRecord: OperatorFailureRecord | null` plus `operatorFailureRecordCorrupt: boolean` on `Run`; rules out reconstructing evidence from `terminal_failure_detail`, attempts, or logs.
- Keep `terminal_failure_detail` and `InvocationFailureDetail` unchanged; rules out replacing binding-chain detail with operator evidence.
- Parse `operator_failure_record` through `parseOperatorFailureRecord`; malformed JSON and invalid record/path shapes load as `operatorFailureRecord: null, operatorFailureRecordCorrupt: true` without throwing; rules out loader crashes or partial evidence.
- Legacy rows and rows with no record load `operatorFailureRecord: null, operatorFailureRecordCorrupt: false`; rules out migrations inventing expectation or observation text.
- `commitTerminalRunSettlement` and settlement-backed `commitCompletionBoundary` accept optional `operatorFailureRecord` with the same omitted-preserves and explicit-null-clears semantics as `terminalFailureDetail`; rules out an ad-hoc writer or forced clearing.
- The baselined `runs` create includes the column and every open adds it when missing, including databases already stamped `031-baseline-squash`; rules out treating the stamp as proof that every baseline column exists.

## Prerequisites

- [00 - Shared operator failure record](./00-shared-operator-failure-record.md)

## Task checklist

- Add `operator_failure_record` to the baselined `runs` create, run column mapping, and idempotent open-time column repair.
- Extend `Run`, terminal settlement evidence, and settlement-backed completion-boundary writes with operator failure evidence and corruption state.
- Parse stored values non-throwingly in every run loader.
- Add state-store regressions for settlement preservation, explicit clearing, completion-boundary persistence, corruption, rollback, legacy absence, fresh-baseline reopen, and already-stamped baseline repair.
- Update the baseline fixture create in `state-store-baseline-migration.test.ts` for the baselined runs shape.
- Document run ownership and migration behavior in `state-store.md`, and record the run-row addition in `v1-behaviors.md`.

## Acceptance criteria

- [ ] `v2/src/persistence/state-store.test.ts` test `operator failure record round-trips on a run row` writes a record with expectation, observation, near miss, retryability, and both path origins through terminal settlement, reopens the store, and asserts `loadRun` field equality; it fails against the pre-fix run schema reachable on main without `operator_failure_record`.
- [ ] `v2/src/persistence/state-store.test.ts` terminal-settlement evidence tests prove omitting `operatorFailureRecord` preserves a prior record and explicit `null` clears it; they fail against the pre-fix settlement contract reachable on main.
- [ ] `v2/src/persistence/state-store.test.ts` completion-boundary terminal-evidence test proves `commitCompletionBoundary` persists an operator failure record with its attempt outcome; it fails against the pre-fix boundary contract reachable on main.
- [ ] `v2/src/persistence/state-store.test.ts` transactional-settlement test injects the existing mid-settlement failure after the status write and proves the operator failure record, status, and other settlement evidence roll back together; it fails against the pre-fix new-column transaction path reachable on main.
- [ ] `v2/src/persistence/state-store.test.ts` run-loader corruption test seeds malformed JSON syntax and each invalid record/path shape, then proves `loadRun` and `listRuns` do not throw and expose `operatorFailureRecord: null, operatorFailureRecordCorrupt: true`; it fails against the pre-fix loader contract reachable on main.
- [ ] `v2/src/persistence/state-store-baseline-migration.test.ts` test `legacy rows load without operator failure evidence and current rows retain it across reopen` opens a pre-column fixture, asserts absent evidence, seeds a fresh baseline row with a record, reopens, and asserts the record survives; it fails against the pre-fix schema reachable on main.
- [ ] `v2/src/persistence/state-store-baseline-migration.test.ts` test `stamped baseline databases repair a missing operator failure record column` opens a database stamped `031-baseline-squash` without the column, persists a record, reopens, and asserts it survives; it fails against the pre-fix early-return migration path reachable on main.
- [ ] `v2/docs/state-store.md` documents `runs.operator_failure_record`, `Run.operatorFailureRecord`, legacy `null` absence, corrupt-value handling, and repair of missing columns on stamped baselines.
- [ ] `v2/docs/v1-behaviors.md` records the v2 additive durable operator failure evidence on run rows.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:shared` passes.
- [ ] `bun run test:integration:shared` passes.
- [ ] `bun run test:v2` passes.
- [ ] `bun run test:integration:v2` passes.

## Documentation updates

- `v2/docs/state-store.md` — run-row ownership, legacy absence, corrupt-value handling, and stamped-baseline repair.
- `v2/docs/v1-behaviors.md` — v2 additive run-row operator failure evidence.
