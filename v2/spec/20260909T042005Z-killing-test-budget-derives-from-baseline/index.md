# Killing-test budget derives from the unmutated baseline

`MAX_KILLING_TEST_MS = 30_000` in `diff-derived-mutation-verifier.ts` cannot tell a non-terminating mutant from a killing set that is slower than 30s, so every candidate in a file whose resolved killing set exceeds the budget (`workflow-runner-resume.test.ts` runs 32s clean) settles `non_terminating_mutation_failed` deterministically and `run resume` is a fixed point.

- [ ] [00 - Baseline-derived per-candidate budget and inconclusive settlement](./00-baseline-derived-budget-and-inconclusive-settlement.md)
