# 00 - Red test file fails the ready gate

## Problem

`bun run ready` has reported green twice on trees CI then rejected (#1422): once with a red
`v1/test/ready-script.sandbox-unrunnable.test.ts`, once with a red slice-boundary roster test. A green
gate currently proves nothing about the test suite.

## Root-cause first

Reproduce before changing anything. PR #1422 added a sync-guard suffix to the `check` script and needed a
same-PR fixup because `v1/test/ready-script.sandbox-unrunnable.test.ts` asserted the old `check` string. On
that tree, `bun run ready` (sandbox off) exits 0 while `bun test v1/test/ready-script.sandbox-unrunnable.test.ts`
exits non-zero. That squash-merged parent may not be reachable — reproduce the shape directly instead: append a
suffix to the `check` script in `package.json` that the test's assertion does not expect, then compare the two
exit codes. Revert the fixture edit once the reproduction is captured.

Candidates, in order:

- `scripts/ready.ts` serial retry: on a test-step failure it re-runs bare `bun test`, not the `bun run test`
  aggregation that failed, and a green retry is reported as "parallel-load flake recovered" and continues.
- `JARVIS_READY_TEST_SCOPE` substituting scoped scripts for `bun run test` (empty scope `[]` resolves to zero
  test steps) and dropping the integration slice.
- `runBunTest`'s exit code in `scripts/run-tests.ts` not reflecting a `bun test` failure.
- The test's `readFileSync("./package.json")` resolving against a different CWD under the gate.

Fix the gate, not the tests — the tests were right both times. Do not narrow the fix to `sandbox-unrunnable`
files unless the reproduction proves that is the actual boundary; the slice-boundary failure was an ordinary
test file.

## Decisions

- Retry recovery is legitimate only when the retried command is byte-for-byte the command that failed; a retry
  that checks less than the original step must never turn a real failure green. Rules out the current bare
  `bun test` retry, which is a narrower run than the `bun run test` aggregation it replaces.
- The serial retry stays (genuine parallel-load flakes exist); it is repaired, not deleted.
- A resolved test scope that yields zero test steps is a gate failure, not a green gate. Rules out treating an
  empty `JARVIS_READY_TEST_SCOPE` as "nothing to run, all good".
- Fix stays inside the gate's own scripts (`scripts/ready.ts`, and `scripts/run-tests.ts` only if the
  reproduction implicates it). `scripts/ci-test-scope.ts` is out of scope unless it is the cause.

## Regression coverage

Guard the end-to-end shape, not just the unit seam: a deliberately failing test file inside the suite the gate
resolves must make `bun run ready` exit non-zero. A `*.sandbox-unrunnable.test.ts` that spawns
`bun scripts/ready.ts` against a fixture checkout whose test script is red is one workable form; pick whatever
the fixed code supports, but the assertion must be on the gate's real exit code, not on a stub.

## Acceptance criteria

- [ ] A test drives the ready gate over a resolved suite containing a deliberately failing test file and asserts
      a non-zero exit; it fails against the pre-fix code and passes after the change.
- [ ] A test asserts the serial retry re-runs the exact command that failed (same argv), and that a retry can
      never be a narrower invocation than the failed step; it fails against the pre-fix code.
- [ ] A resolved test scope with zero test steps makes the gate exit non-zero, covered by a test.
- [ ] Existing `v1/test/ready-script.sandbox-unrunnable.test.ts` and `v1/test/ready-gate.test.ts` stay green.

## Documentation updates

- `v1/docs/operator-runbook.md` § The gate — what a green `ready` does and does not prove, and the retry rule
  (a retry re-runs the identical failed step).
- `v2/docs/v1-behaviors.md` — record the corrected ready-gate failure/retry semantics.
