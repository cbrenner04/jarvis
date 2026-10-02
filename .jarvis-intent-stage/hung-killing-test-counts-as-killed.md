---
name: hung-killing-test-counts-as-killed
---

# A killing test that hangs under a mutant kills it

Unsplit rationale: one execution-loop surface (`diff-derived-mutation-verifier` scoped `bun test` spawning and killing-set settlement); docs and tests follow that behavior.

## Primary implementation surface

- `v2/src/execution/diff-derived-mutation-verifier.ts` (scoped killing-test runs and `runMutatedKillingSet` / baseline measurement)

## Problem

`bunfig.toml` sets the per-test timeout to 30 000 ms and the diff-derived verifier's kill floor `MAX_KILLING_TEST_MS` is also 30 000 ms. A killing test that awaits a promise the mutant never resolves would fail at bun's 30 s per-test timeout, but the verifier aborts the run at its own 30 s floor first, measures a fast clean baseline, and settles `non_terminating_mutation_failed` — stranding a run whose tests did detect the mutant.

## Decisions

- The verifier runs mutated killing sets with a per-test timeout strictly below its kill floor (pass `bun test --timeout <n>`), so a hung test reports `(fail)` and the mutant counts as killed.
- The clean baseline runs with the same `--timeout`; a clean-run timeout stays inconclusive (no new false kills).
- `non_terminating_mutation_failed` remains only for a set that exceeds the floor without bun reporting any failing test.

## Prerequisites

## Acceptance criteria

- [ ] `diff-derived-mutation-verifier.test.ts`: a killing set whose test awaits forever under the mutant settles killed (not `non_terminating_mutation_failed`) within the floor; fails against current code.
- [ ] Same file: a set that hangs outside any test (e.g. top-level await) still settles `non_terminating_mutation_failed`.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` § Diff-derived mutation verification and `operator-runbook.md` § Mutation verification (Non-terminating mutants): state the per-test timeout rule.
- `v2/docs/v1-behaviors.md`: record the updated non-terminating vs killed classification for hung killing tests.
