# Scoped Bun per-test timeout under subprocess floor

## Problem

`bunfig.toml` sets `timeout = 30000` and `MAX_KILLING_TEST_MS` / `KILLING_TEST_BUDGET_FLOOR_MS` are 30 000 ms. `runDiffDerivedScopedTests` spawns `bun test <path>` with only subprocess `timeoutMs` (no CLI `--timeout`). A killing test that awaits a promise the mutant never resolves would fail at Bun's 30 s per-test cap, but the verifier's 30 s subprocess floor can fire first, the unmutated baseline finishes quickly, and `testCandidate` settles `kind: "non-terminating-mutation"` even though the mutant was detectable in-test.

Reachable today: `bounded killing-test execution` → `a genuinely non-terminating mutant still settles non-terminating-mutation` (`diff-derived-mutation-verifier.test.ts`) models subprocess `ETIMEDOUT` at the floor with a fast baseline — the same race shape as a hung killing test. Same file → `bounds scanDaemonRunControlHandlerForbiddenSymbols while (true) exit-guard flip via real killing test` (real `runDiffDerivedScopedTests`) also expects `non-terminating-mutation` today; under the per-test-cap rule that expectation must change or the gate fails with no AC owner.

## Decisions

- Export `SCOPED_BUN_PER_TEST_TIMEOUT_MS = MAX_KILLING_TEST_MS - 5_000` (25 000 ms) beside the existing killing-test constants; rules out reusing `bunfig.toml` alone or setting per-test timeout equal to the subprocess floor.
- Every `runDiffDerivedScopedTests` spawn passes `bun test --timeout ${SCOPED_BUN_PER_TEST_TIMEOUT_MS}` before the test path; subprocess `timeoutMs` stays the existing floor, derived budget, or deadline cap; rules out shortening subprocess wall clock to make Bun win.
- Baseline measurement, confirmation isolated re-runs, and render-observer scoped runs share the same CLI cap because they all go through `runDiffDerivedScopedTests`; rules out a baseline-only spawn without `--timeout`.
- A clean baseline subprocess timeout still settles inconclusive (unchanged); rules out treating baseline timeout as killed.
- `kind: "non-terminating-mutation"` remains only when the scoped subprocess hits wall `timeoutMs` with `ETIMEDOUT` and no prior non-timeout killing-file failure — in-test hang or sync callee busy-loop under mutation after Bun's scoped per-test cap fails the test counts as killed; rules out classifying every timeout as non-terminating.
- `bounds scanDaemonRunControlHandlerForbiddenSymbols while (true) exit-guard flip via real killing test` must expect verification `pass` (mutant caught via scoped test failure), not `non-terminating-mutation`; rules out a sync-loop exception that keeps the pre-fix classification.

## Tasks

- [ ] Add `SCOPED_BUN_PER_TEST_TIMEOUT_MS` and thread `--timeout` into `spawnOne` in `runDiffDerivedScopedTests`.
- [ ] Add regression under `bounded killing-test execution` that exercises scoped spawn fidelity: argv includes `--timeout` with `SCOPED_BUN_PER_TEST_TIMEOUT_MS`, mutated in-test hang surfaces as a non-`ETIMEDOUT` scoped failure before subprocess `timeoutMs` hits `MAX_KILLING_TEST_MS`, and `verifyDiffDerivedMutations` settles `pass` (candidate killed).
- [ ] Keep `a genuinely non-terminating mutant still settles non-terminating-mutation` green; add or extend coverage with a top-level-await (or equivalent) hang constructible on main so the subprocess still hits floor `ETIMEDOUT` with no Bun-reported failing test — pins non-terminating vs scoped per-test failure.
- [ ] Update `bounds scanDaemonRunControlHandlerForbiddenSymbols while (true) exit-guard flip via real killing test` to expect verification `pass` (mutant caught); retain bounded elapsed and pgid reaping assertions.
- [ ] In `diff-derived-mutation-verifier.test.ts`, fix scoped-spawn mocks to resolve the test path with a stable argv rule (last `*.test.ts` path segment or flag-aware helper), not bare `args[1]`.
- [ ] Align `v2/docs/write-behavior.md` § Diff-derived mutation verification, `v2/docs/operator-runbook.md` § Mutation verification (Non-terminating mutants), and `v2/docs/v1-behaviors.md` with the per-test vs subprocess timeout rule.

## Acceptance criteria

- [ ] `diff-derived-mutation-verifier.test.ts` — new or extended regression under `bounded killing-test execution` asserts scoped `bun test` argv includes `--timeout` equal to `SCOPED_BUN_PER_TEST_TIMEOUT_MS`, a mutated in-test hang fails the scoped run (non-`ETIMEDOUT`) before subprocess `timeoutMs` reaches `MAX_KILLING_TEST_MS`, and verification settles `pass`; fails against pre-fix spawn without `--timeout` when floor `ETIMEDOUT` wins the race (reachable via mock or real subprocess — not a mutation-only stub that always returns `passed: false`).
- [ ] `diff-derived-mutation-verifier.test.ts` — `a genuinely non-terminating mutant still settles non-terminating-mutation` stays green; same file adds or extends a top-level-await hang reachable on main (subprocess times out at floor with no failing test) so settlement remains `kind: "non-terminating-mutation"` — fails if in-test hangs alone were treated as killed-only.
- [ ] `diff-derived-mutation-verifier.test.ts` — `bounds scanDaemonRunControlHandlerForbiddenSymbols while (true) exit-guard flip via real killing test` expects verification `pass`, not `kind: "non-terminating-mutation`; fails against pre-fix expectations reachable on main today.
- [ ] `diff-derived-mutation-verifier.test.ts` — scoped-spawn test doubles resolve the killing-test path without assuming `args[1]` is the path after `--timeout` is inserted.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- [ ] `v2/docs/write-behavior.md` § Diff-derived mutation verification: document `SCOPED_BUN_PER_TEST_TIMEOUT_MS` vs subprocess `timeoutMs` on scoped `bun test` spawns.
- [ ] `v2/docs/operator-runbook.md` § Mutation verification (Non-terminating mutants): same per-test vs wall-clock rule for operators.
- [ ] `v2/docs/v1-behaviors.md`: record hung killing-test under mutant → killed; genuine non-terminator (floor `ETIMEDOUT`, no failing test) unchanged.
