---
name: hung-killing-test-counts-as-killed
---

# A killing test that hangs under a mutant kills it

## Problem

`bunfig.toml` sets the per-test timeout to 30 000 ms and the diff-derived verifier's kill floor `MAX_KILLING_TEST_MS` (`v2/src/execution/diff-derived-mutation-verifier.ts:146`) is also 30 000 ms. A killing test that awaits a promise the mutant never resolves would fail at bun's 30 s per-test timeout, but the verifier aborts the run at its own 30 s floor first, measures a fast clean baseline, and settles `non_terminating_mutation_failed` — stranding a run whose tests did detect the mutant.

## Evidence

- 2026-10-02 gate-slot lane: guard-flip `!liveGateInvocationLeases.delete(lease)` at `v2/src/execution/gate-invocation-lease.ts:46` stranded run `c6030e65` (FIFO test awaiting a never-granted lease) and, after a hand fix, run `61460dfe` (a new agent-written test awaiting the same grant). Under the mutant, bun reports `(fail) … [30000.89ms]` — a real failure. Hand fix both times: assert the grant after a microtask flush before the unbounded await.
- Ledger: 3 more `non_terminating_mutation_failed` on write-loop mutants 2026-10-01/02.

## Decisions

- The verifier runs mutated killing sets with a per-test timeout strictly below its kill floor (pass `bun test --timeout <n>`), so a hung test reports `(fail)` and the mutant counts as killed.
- The clean baseline runs with the same `--timeout`; a clean-run timeout stays inconclusive (no new false kills).
- `non_terminating_mutation_failed` remains only for a set that exceeds the floor without bun reporting any failing test.

## Acceptance criteria

- [ ] `diff-derived-mutation-verifier.test.ts`: a killing set whose test awaits forever under the mutant settles killed (not `non_terminating_mutation_failed`) within the floor; fails against current code.
- [ ] Same file: a set that hangs outside any test (e.g. top-level await) still settles `non_terminating_mutation_failed`.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` § Diff-derived mutation verification and `operator-runbook.md` § Mutation verification (Non-terminating mutants): state the per-test timeout rule.
