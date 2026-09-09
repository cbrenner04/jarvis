# 00 - Baseline-derived per-candidate budget and inconclusive settlement

## Problem

`runDiffDerivedScopedTests` runs every killing test with `timeoutMs: MAX_KILLING_TEST_MS` (30s) and `testCandidate` maps `ETIMEDOUT` to `non-terminating-mutation`, a diagnosis of the mutant. Nothing measures whether the same killing set finishes inside the bound unmutated, so a slow set — its own test or any resolved sibling — reports every candidate as non-terminating, the run settles `non_terminating_mutation_failed`, and resume re-runs the identical measurement.

## Decisions

- The mutated killing set runs at the floor budget first; only when that times out does the verifier run the same set once on the unmutated tree with the ceiling bound and record its wall time (cached per killing-set key, counted against `MAX_VERIFICATION_MS`). A baseline inside the floor proves the mutant hangs; a slower baseline widens the bound and the mutated set runs once more. Rules out inferring mutant behaviour from a bound the baseline also exceeds, and rules out an eager baseline run per set, which would double the test cost of every verification whose suites are fast (revised at implementation from the eager form; the observable settlements are unchanged).
- The per-candidate bound is `clamp(baselineMs × KILLING_TEST_BUDGET_FACTOR, KILLING_TEST_BUDGET_FLOOR_MS, KILLING_TEST_BUDGET_CEILING_MS)` with factor `2`, floor `MAX_KILLING_TEST_MS` (30s, retained as the floor), ceiling `120_000`; `RunScopedTests` takes the bound per call; rules out a fixed constant a growing suite silently outgrows.
- A killing set whose unmutated run exceeds the ceiling, or a mutated run that times out at a bound the baseline could not establish, settles that candidate **inconclusive**: a `SkippedCandidate` whose reason names the measured baseline (or the ceiling it exceeded) and the killing set; inconclusive candidates ride on the `pass` result's `skippedCandidates` and the run's mutation log fields, and do not by themselves settle the run non-publishable; rules out one settlement kind carrying two meanings and rules out a deterministic fixed point resume cannot clear.
- `non-terminating-mutation` is claimed only when the baseline finished inside the bound and the mutated run exceeded it; rules out the false confident diagnosis.
- `MAX_VERIFICATION_MS` (5 minutes) is unchanged as the overall ceiling; a baseline measurement that would cross the deadline is not started and its candidates settle inconclusive; rules out unbounded verification.

## Tasks

- Thread a per-call `timeoutMs` through `RunScopedTests` / `runDiffDerivedScopedTests` and the verifier seams.
- Add baseline measurement and caching keyed by the sorted killing-set paths in the candidate loop; derive and clamp the bound.
- Distinguish baseline-timeout and mutated-timeout-without-baseline (inconclusive `SkippedCandidate`) from mutated-timeout-with-baseline (`non-terminating-mutation`) in `testCandidate`.
- Extend `diff-derived-mutation-verifier.test.ts` with a `runScopedTests` fake that honours the bound it is given and reports elapsed time.

## Acceptance criteria

- [x] `diff-derived-mutation-verifier.test.ts` test `a killing set slower than the ceiling settles inconclusive naming the measured baseline` proves a killing test whose unmutated run exceeds the per-candidate ceiling settles a `SkippedCandidate` whose reason names the baseline and the killing set, not `non-terminating-mutation`; it fails against the current unconditional `ETIMEDOUT` classification.
- [x] `diff-derived-mutation-verifier.test.ts` test `a genuinely non-terminating mutant still settles non-terminating-mutation` proves a baseline well inside the bound and a mutated run exceeding it still settles `non-terminating-mutation`.
- [x] `diff-derived-mutation-verifier.test.ts` test `the per-candidate bound scales with the whole resolved killing set and is clamped` proves the bound passed to `runScopedTests` is `2 ×` the measured runtime of the whole set (a fast own test plus a slow sibling), floored at `MAX_KILLING_TEST_MS` and capped at the ceiling; it fails against the current constant.
- [x] `diff-derived-mutation-verifier.test.ts` test `an inconclusive candidate is recorded and does not fail the run` proves the verification result is `pass` with the candidate in `skippedCandidates`, and `write-loop.test.ts` proves the run publishes with the inconclusive candidate recorded in its mutation log fields.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — per-candidate budget derivation, inconclusive versus non-terminating.
- `v2/docs/operator-runbook.md` — § Mutation verification: a timeout is not proof of a non-terminating mutant; read the baseline in the inconclusive reason.
- `v2/docs/v1-behaviors.md` — record the changed settlement.
