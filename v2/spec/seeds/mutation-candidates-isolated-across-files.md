---
name: mutation-candidates-isolated-across-files
---

# A mutant in one file never runs under another file's killing set

## Problem

The diff-derived verifier runs candidates in distinct production files concurrently (`MAX_CONCURRENT_VERIFIER_TEST_RUNS = 4`, `v2/src/execution/diff-derived-mutation-verifier.ts:215`; runbook § Mutation verification: "distinct production files may overlap") in one worktree. A killing set imports transitively, so while candidate A (file X) runs, candidate B's mutant in file Y is on disk; if X's tests import Y, B's mutant can hang or fail A's killing set. The verdict for A is then wrong — a false `non_terminating_mutation_failed` (or a false kill, hiding a survivor).

## Evidence

- 2026-10-02 gate-slot lane: `ready-finalize.ts:1470` was reported non-terminating; a dedicated killing test settles in a microtask, but the report persisted. Hand-verification showed lease-module mutants (`gate-invocation-lease.ts` 39/43/46/56/58/60/156/182) on disk concurrently, which `ready-finalize.test.ts` imports, hanging the whole file. One of six strands on that lane today; operator hand-hardened tests to make every lease mutant fail fast.

## Decisions

- Concurrent candidates never share a worktree when one's killing set can import the other's mutated file: either run each concurrent candidate in its own detached worktree copy, or serialize candidates whose killing sets' transitive imports include another in-flight mutated file. Plan picks; prefer the one with bounded wall-clock cost.
- Confirmation re-runs (already isolated) stay as today.

## Acceptance criteria

- [ ] `diff-derived-mutation-verifier.test.ts`: two candidates in files X and Y, where X's killing test imports Y and Y's mutant hangs on import-use, produce X's correct verdict (killed / survived per X's own mutant); fails against current concurrent same-worktree scheduling.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` § Diff-derived mutation verification and `operator-runbook.md` § Mutation verification (Operational caveats): state the isolation rule.
