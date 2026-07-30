# Emit gate failing-file evidence

## Problem

`runV2TestFiles` (`scripts/run-v2-tests.ts`) captures per-file output behind `--- <file> ---`
headers, but the ready gate subprocess boundary (`createDefaultRunReadyGate` in
`v2/src/execution/ready-finalize.ts`) only receives combined stdout/stderr. Without
machine-readable failing-file records in that stream, downstream classification cannot
distinguish attributed test failures from unattributed gate red.

## Decision ledger

- Export a marker constant from `scripts/run-v2-tests.ts`; emit one deterministic
  repo-relative failing-file record per non-zero or timed-out settled file — rules out
  inferring paths from human-oriented headers or test output prose.
- Records cover pooled concurrent and isolated load-sensitive phases — rules out
  attribution gaps when multiple files settle out of roster order.
- Healthy settled files emit no record — rules out treating the full roster as failed.
- Non-test ready steps (`install`, `check`, `typecheck`, `lint:md`) do not emit records —
  rules out claiming complete test attribution when an earlier step failed.
- Record wire shape is owned here: one marker-prefixed line per failing file, path
  repo-relative — rules out duplicating a divergent literal in `v2/src`.

## Task checklist

- Add the exported marker and per-failing-file emission to `runV2TestFiles`.
- Pin emission with unit tests, including concurrent and isolated cases.
- Document the contract in the runner durable home.

## Acceptance criteria

- [ ] `scripts/run-v2-tests.test.ts` adds pre-fix-failing coverage that every non-zero or
      timed-out settled file emits exactly one marker-prefixed repo-relative record and healthy
      files emit none, including a concurrent multi-file case.
- [ ] Inverting emission turns that test RED; a case with only healthy files stays record-free
      when the guard is restored.
- [ ] Existing `scripts/run-v2-tests.test.ts` attribution, fail-fast, timeout, pool, and
      load-sensitive cases stay green.

## Documentation updates

- `v2/docs/test-writing.md` — marker, one-line-per-failing-file records, and that non-test ready
  steps do not emit them.
