---
name: mutation-candidates-isolated-across-files
---

# A mutant in one file never runs under another file's killing set

Unsplit rationale: candidate scheduling, optional per-candidate worktree isolation or import-aware serialization, regression tests, and operator docs all live on the diff-derived mutation verifier execution surface; confirmation re-runs already use the existing semaphore exclusive mode and stay unchanged.

## Primary implementation surface

- `v2/src/execution/diff-derived-mutation-verifier.ts` (concurrent per-production-file candidate scheduling and scoped killing-set runs)

## Problem

The diff-derived verifier runs candidates in distinct production files concurrently (`MAX_CONCURRENT_VERIFIER_TEST_RUNS`, same worktree). A killing set imports transitively, so while candidate A (file X) runs, candidate B's mutant in file Y can be on disk; if X's tests import Y, B's mutant can hang or fail A's killing set. A's verdict is then wrong — false `non_terminating_mutation_failed` or a false kill hiding a survivor.

## Decisions

- Concurrent candidates never share one worktree when one's killing set can import another's mutated production file: either run each risky concurrent candidate in its own detached worktree copy, or serialize candidates whose killing sets' transitive imports include another in-flight mutated file; plan picks, preferring bounded wall-clock cost.
- Mutation-confirmation isolated re-runs stay as today (`runScopedTests` `isolated` / `VerifierTestRunSemaphore.runExclusive`).

## Prerequisites

## Acceptance criteria

- [ ] `diff-derived-mutation-verifier.test.ts`: two candidates in files X and Y where X's killing test imports Y and Y's mutant hangs on import-use yield X's correct verdict (killed or survived per X's own mutant), not a cross-file contamination verdict; fails against current concurrent same-worktree scheduling.
- [ ] `isolates a confirmation re-run from a concurrent scoped test run via the real subprocess semaphore` stays green (confirmation isolation unchanged).
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` § Diff-derived mutation verification: state the cross-file mutant isolation rule (when concurrent candidates may share a worktree vs not).
- `v2/docs/operator-runbook.md` § Mutation verification (Operational caveats): same isolation rule for operators inspecting concurrent `.jarvis-diff-derived-mutations/` sidecars.
