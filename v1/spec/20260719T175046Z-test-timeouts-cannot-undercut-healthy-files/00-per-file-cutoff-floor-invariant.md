# Per-file cutoff floor invariant

## Problem

`scripts/run-v2-tests.ts` sets the aggregate/scoped per-file hang cutoff (`PER_FILE_TIMEOUT_MS`) as a bare literal. It once drifted to 60s — below `v1/test/run.test.ts`'s ~120s runtime — and silently reddened the local ready gate (CI never runs the aggregate, so CI stayed green). The emergency bump to 180s restored headroom but left no invariant preventing recurrence: nothing rejects a future edit that lowers the cutoff below the supported healthy-file budget.

Both the aggregate runner (`run-tests.ts`, via `runV2TestFiles`) and the scoped runner (`run-v2-tests.ts` main) consume the same `PER_FILE_TIMEOUT_MS`, so a single floor guards every shared file across both execution paths.

## Decisions

- Enforce the floor with a static assertion on the cutoff constant, not a wall-clock timing test — rules out replacing runner flakiness with load-sensitive test flakiness (intent decision).
- Define the supported healthy-file budget (180_000 ms) as one named exported constant that both the cutoff and the regression test reference — rules out a second literal drifting apart from the cutoff.
- Keep the cutoff declared once in `run-v2-tests.ts` as the single source both aggregate and scoped runners import — rules out a separate aggregate-side cutoff that could diverge below the budget.
- Regression test proves the guard by driving it with a below-budget value and asserting rejection, plus asserting the real cutoff satisfies the floor — rules out a test that only checks the current literal equals 180 and so would not catch a coupled future lowering.
- Doc removal is outcome-scoped: strip any temporary/emergency framing of the timeout and record the permanent invariant — rules out deleting the unrelated red-gate repair-loop gotcha.

## Task checklist

- Export a supported-healthy-file-budget constant (180_000 ms) from `scripts/run-v2-tests.ts` and bind `PER_FILE_TIMEOUT_MS` to at least that budget.
- Add a regression test in `scripts/run-v2-tests.test.ts` that (a) drives the floor guard with a sub-180s cutoff and asserts rejection, and (b) asserts the effective cutoff ≥ budget.
- Update `test/test-slices.test.ts` policy-parity to assert aggregate and scoped runs bind each shared file to the same budget floor, replacing the bare `180_000` literal check.
- Record the permanent budget floor in `v2/docs/v1-behaviors.md` § Test execution.
- Update `v2/docs/operator-runbook.md` and `v1/docs/operator-runbook.md`: reference the permanent invariant, remove any temporary/emergency framing of the per-file timeout or red main ready gate, retain the `red-gate-does-not-feed-back-to-the-agent` repair-loop gotcha.

## Acceptance criteria

- [ ] `scripts/run-v2-tests.ts` exports a named supported-healthy-file-budget constant equal to `180_000` ms, and `PER_FILE_TIMEOUT_MS` is at least that budget.
- [ ] A new regression test in `scripts/run-v2-tests.test.ts` drives the floor guard with a per-file cutoff below the 180-second budget and asserts it is rejected; the test fails against the pre-change code (the budget export does not yet exist) and passes after.
- [ ] The regression test asserts the effective per-file cutoff (`PER_FILE_TIMEOUT_MS`) is ≥ the supported healthy-file budget.
- [ ] `scripts/run-v2-tests.test.ts` hung-file cases stay green: a timed-out file still terminates at the per-file cutoff and its stderr message names the file (behavior unchanged).
- [ ] `test/test-slices.test.ts` policy-parity asserts aggregate (`run-tests.ts`) and scoped (`run-v2-tests.ts`) execution bind each shared file to the same budget floor and fails if either cutoff falls below the budget; it no longer relies on a bare `180_000` literal match.
- [ ] Neither `v1/docs/operator-runbook.md` nor `v2/docs/operator-runbook.md` frames the 180-second per-file timeout or the red main ready gate as a temporary/emergency stopgap; both reference the permanent 180-second budget invariant.
- [ ] The `red-gate-does-not-feed-back-to-the-agent` repair-loop gotcha remains present in `v2/docs/operator-runbook.md`.
- [ ] `v2/docs/v1-behaviors.md` § Test execution records the permanent 180-second per-file budget floor and the invariant that the cutoff cannot drop below it.

## Documentation updates

- `v2/docs/v1-behaviors.md` — record the permanent per-file budget floor (180s) and the cutoff-cannot-undercut invariant under § Test execution.
- `v2/docs/operator-runbook.md` — document the permanent hang bound; remove any temporary red main ready-gate framing; retain the unrelated red-gate repair-loop gotcha.
- `v1/docs/operator-runbook.md` — remove the recovered-incident framing of the per-file timeout; reference the permanent invariant.
