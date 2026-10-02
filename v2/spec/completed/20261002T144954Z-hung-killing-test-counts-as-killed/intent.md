---
name: hung-killing-test-counts-as-killed
---

# A killing test that hangs under a mutant kills it

Unsplit rationale: one execution-loop surface (`diff-derived-mutation-verifier` scoped `bun test` spawning and killing-set settlement); docs and tests follow that behavior.

## Primary implementation surface

- `v2/src/execution/diff-derived-mutation-verifier.ts` (scoped killing-test runs and `runMutatedKillingSet` / baseline measurement)

## Problem

`bunfig.toml` sets the per-test timeout to 30 000 ms and the diff-derived verifier's kill floor `MAX_KILLING_TEST_MS` is also 30 000 ms. A killing test that awaits a promise the mutant never resolves would fail at bun's 30 s per-test timeout, but the verifier aborts the run at its own 30 s floor first, measures a fast clean baseline, and settles `kind: "non-terminating-mutation"` — stranding a run whose tests did detect the mutant.

## Decisions

- Introduce `SCOPED_BUN_PER_TEST_TIMEOUT_MS = MAX_KILLING_TEST_MS - 5_000` (25 000 ms). Every scoped `bun test` spawned by `runDiffDerivedScopedTests` passes `--timeout ${SCOPED_BUN_PER_TEST_TIMEOUT_MS}`; subprocess `timeoutMs` stays at the existing floor/budget/deadline caps so wall clock remains at the floor while Bun's per-test cap fires first.
- The clean baseline, confirmation isolated re-run, and render-observer scoped spawns use the same `--timeout` via `runDiffDerivedScopedTests` (no floor-only path without the cap).
- A clean baseline run uses the same `--timeout`; a clean-run timeout stays inconclusive (no new false kills).
- `kind: "non-terminating-mutation"` remains only when the scoped subprocess hits its wall `timeoutMs` without Bun reporting any failing test (genuine non-termination / hang outside test bodies).

## Prerequisites

## Acceptance criteria

- [ ] `diff-derived-mutation-verifier.test.ts`: a killing set whose test awaits forever under the mutant yields verification pass (candidate killed), not `kind: "non-terminating-mutation"`, within the floor; fails against current code.
- [ ] `a genuinely non-terminating mutant still settles non-terminating-mutation` stays green; same file adds or extends a top-level-await hang constructible on main (subprocess times out at floor with no failing test) so settlement remains `kind: "non-terminating-mutation"` — fails if in-test hangs alone were treated as killed-only.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` § Diff-derived mutation verification and `operator-runbook.md` § Mutation verification (Non-terminating mutants): state the per-test timeout rule (`SCOPED_BUN_PER_TEST_TIMEOUT_MS` vs subprocess floor).
- `v2/docs/v1-behaviors.md`: record the updated non-terminating vs killed classification for hung killing tests.
