# 00 - Extract terminal-outcome mapping, drop subset/redundant tests

`v2/src/daemon/daemon-start-list.test.ts` mixes a pure run-status →
`terminalOutcome` mapping (currently exercised only through the full IPC
list-handler stack) with composed list/workflow behavior, carries a kill
test that's a strict subset of another, and duplicates the operator-error
mapping matrix already owned by `run-operator-error.test.ts`.

## Decisions

- Export `stoppedOutcomeForRun` from `v2/src/daemon/daemon.ts` (currently
  module-private) so it can be unit-tested directly.
- Replace `"list maps stopped workflow steps to budget-exhausted, paused,
  killed, and contract_miss outcomes"` with direct unit tests calling
  `stoppedOutcomeForRun` for each branch (`blocked`+`contract_miss` attempt,
  `blocked` without `contract_miss`, `budget-soft-stopped`, `paused`,
  `killed`, `awaiting-human`, and the `invocation_failure` fallback).
- Keep `"list returns workflow step snapshots for live, stopped, and
  completed workflow-backed runs"` unmodified as the one composed list test
  covering the mapping wired end-to-end through `list`.
- Drop `"kill aborts the abort signal that bindings can observe"` — strict
  subset of `"kill aborts an active run and records killed status"` (same
  setup, same `isAbortSignalTriggered`/`status: "killed"` assertions, minus
  the response-shape check the surviving test also makes).
- Consolidate `"list includes error on terminal rows and omits it on
  in-progress and completed"` and `"list without logReader composes
  store-only error"` into one wiring test. This file never wires a real
  `LogReader` (handlers are always constructed without one), so both tests
  already exercise the same store-only surface. Keep proof that `list`
  attaches `error` from `composeRunOperatorError` on a terminal row (via a
  real `kill` call) and omits it on in-progress/completed rows; drop the
  enumerated paused/budget/blocked/failed reason checks and the
  duplicate no-logReader test — those exact reason mappings already live in
  `run-operator-error.test.ts`'s direct `composeRunOperatorError` tests.
- `run-operator-error.test.ts` stays untouched — it remains the sole owner
  of the operator-error mapping matrix.

## Out of scope

- Any src change beyond exporting `stoppedOutcomeForRun`.
- Changes to `run-operator-error.test.ts`.
- Any other test file.

## Acceptance criteria

- [ ] `stoppedOutcomeForRun` is exported from `v2/src/daemon/daemon.ts` and
      has direct unit test coverage in `daemon-start-list.test.ts` for every
      branch: `blocked`+`contract_miss`, `blocked` without `contract_miss`,
      `budget-soft-stopped`, `paused`, `killed`, `awaiting-human`, and the
      `invocation_failure` fallback.
- [ ] `daemon-start-list.test.ts` retains exactly one composed test proving
      the run/step-status → `terminalOutcome` mapping wired end-to-end
      through `list` (`"list returns workflow step snapshots for live,
      stopped, and completed workflow-backed runs"`).
- [ ] `"kill aborts the abort signal that bindings can observe"` no longer
      exists in `daemon-start-list.test.ts`; `"kill aborts an active run and
      records killed status"` still passes.
- [ ] `daemon-start-list.test.ts` contains exactly one operator-error wiring
      test (proving `list` attaches/omits `error` via `composeRunOperatorError`
      on terminal vs. live/completed rows); the enumerated
      paused/budget/blocked/failed reason matrix and the separate
      no-logReader test are gone.
- [ ] `run-operator-error.test.ts` is byte-for-byte unchanged (`git diff
      --stat` shows no entry for that path).
- [ ] `bun test v2/src/daemon/daemon-start-list.test.ts
      v2/src/daemon/run-operator-error.test.ts` and `bun run typecheck` pass.
- [ ] PR body states the test-count diff vs. baseline for
      `daemon-start-list.test.ts` and names, for every dropped test, the
      test that now owns its coverage.

## Documentation updates

None — internal test-suite structure only, no operator-facing or v1-parity
behavior changes.
