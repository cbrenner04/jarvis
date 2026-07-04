# Cut the pending-poll timeout budget

## Problem

`v1/test/triage-command.test.ts` — `--merge classifies all spec check statuses
correctly` (line ~3013) loops 12 CI-check statuses. The 5 "shouldWait" cases
(`pending`, `queued`, `in_progress`, `action_required`, `stale`) each call
`triageCommand` with `pollIntervalMs: 0, pollTimeoutMs: 1000`. Because the
mock `getChecks` keeps returning the same pending-class status after the
first poll, `waitForCiGreen` (`v1/src/commands/triage.ts:1603`) spins for the
full `timeoutMs` wall-clock budget before giving up — 5 × 1000ms ≈ 5000ms,
which sits right at bun:test's default 5000ms per-test timeout. Under CI
load this tips over (~5040ms observed), and the test is reported as timed
out even though the classification logic under test is correct.

The test's own assertion for these cases is only `pollCount >=
1` — it never depends on the 1000ms budget elapsing.

## Decisions

- Use `pollTimeoutMs: 0` for the 5 shouldWait cases, matching the existing
  pattern in `--merge on plan worktree CI poll timeout uses plan PR refusal
  class` (line ~2563), which already relies on `pollTimeoutMs: 0` to force
  `waitForCiGreen` to return after exactly one poll. Rules out leaving
  `pollTimeoutMs` at 1000 with a raised per-test `bun:test` timeout instead —
  that hides the same 5s+ real-time cost rather than removing it.
- No change to `waitForCiGreen`, `classifyCiChecks`, or any other
  classification code — this is a test time-budget fix only.
- `waitForCiGreen` classifies fresh on every loop iteration (single
  `classifyCiChecks(getChecks(branch))` call, no state carried across polls)
  and only checks elapsed time against `timeoutMs` after that classification.
  Dropping from multiple polls to exactly one poll therefore cannot skip any
  second-poll-only behavior — there is none. Rules out the risk that
  `pollTimeoutMs: 0` silently drops coverage of a multi-poll code path.

## Task checklist

- [x] In the `--merge classifies all spec check statuses correctly` test,
      change `pollTimeoutMs: 1000` to `pollTimeoutMs: 0`.
- [x] Confirm the test still exercises at least one poll per shouldWait case
      and its existing assertions (`pollCount >= 1`) still pass.

## Acceptance criteria

- [x] `v1/test/triage-command.test.ts` — `--merge classifies all spec check
      statuses correctly` stays green (behavior unchanged; classification
      assertions for all 12 statuses still pass).
- [x] The test file's total runtime (`bun test v1/test/triage-command.test.ts`)
      is under 2000ms, comfortably below bun:test's 5000ms default per-test
      timeout.

## Documentation updates

- None. This is an internal test-timing fix with no operator-facing,
  architectural, or workflow behavior change.
