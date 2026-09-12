# Run observation serves the durable failure record

## Problem

`jarvis run list` and `jarvis run wait` report failures only through `composeRunOperatorError` (`v2/src/daemon/run-operator-error.ts`), which rebuilds evidence from the run row plus terminal log records. The durable `runs.operator_failure_record` written at settlement is never served, so the operator sees composer-reconstructed text that can disagree with the expectation/observation the producer actually settled.

## Behavior

Daemon `list` rows and the `wait` completion result carry the run row's `OperatorFailureRecord` verbatim as a dedicated `failure` field, read from `Run.operatorFailureRecord` with no log input. The existing `error` (`reason` / `nextAction` / per-kind fields) is unchanged; this subspec only adds the durable evidence channel. A row with no record, or a corrupt one (`operatorFailureRecordCorrupt`), omits `failure`.

## Decisions

- `failure` carries the stored record object unchanged — no re-derivation, no field merging with `error`; rules out a composer-shaped summary that drifts from settlement evidence.
- Read only `Run.operatorFailureRecord`; do not fall back to composing a record from logs when the column is null; rules out manufacturing evidence for legacy rows, which would make the field untrustworthy.
- `operatorFailureRecordCorrupt` rows omit `failure` rather than emitting a partial record; rules out shipping half-parsed evidence to the operator.
- Keep `RunOperatorError` in place for this subspec; rules out bundling the reason/action projection change (subspec 03) into the evidence change.
- Deferred to first consumer: no CLI/TUI renderer reads `failure` yet — pin its display when an operator-facing surface needs it.

## Task checklist

- [ ] Add `failure?: OperatorFailureRecord` to `DaemonListRunRow` and `WaitRunCompletionResult`.
- [ ] Project it from the loaded run row in the `list` and `wait` paths of `v2/src/daemon/daemon-run-lifecycle-handlers.ts`.
- [ ] Tests for present, absent, and corrupt records on both paths.

## Acceptance criteria

- [ ] `v2/src/daemon/daemon-start-list.test.ts` gains a test proving a failed run's `list` row returns the stored record byte-for-byte (deep-equal to the settled record) with no terminal log records loaded; it fails against the pre-fix composer-only row.
- [ ] `v2/src/daemon/daemon-wait-run-completion.test.ts` gains a test proving `wait` returns the identical record for the same run; it fails against the pre-fix result shape.
- [ ] A test proves a run whose stored column is corrupt (`operatorFailureRecordCorrupt`) omits `failure` on both `list` and `wait` while still reporting `error`.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — the durable record as the `list`/`wait` failure source and its wire field.
- `v2/docs/v1-behaviors.md` — record the added v2 run-observation failure projection.
