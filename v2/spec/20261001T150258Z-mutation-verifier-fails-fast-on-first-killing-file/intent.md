---
name: mutation-verifier-fails-fast-on-first-killing-file
---

# Mutation verifier kills a candidate on its first failing killing file

Unsplit rationale: scoped parallel spawns, candidate floor-budget killing-set runs, and verifier docs all live on one execution module (`diff-derived-mutation-verifier`).

## Problem

Parallel killing-set `bun test` spawns await every sibling before treating a non-timeout failure as caught. A sibling that **never settles** (not merely one that times out — `returns caught when a sibling scoped test fails before a parallel timeout` already covers timeout siblings under `allSettled`) can leave the waiter blocked until the per-candidate budget fires while another file already failed, so the candidate wrongly settles `non_terminating_mutation_failed`.

## Decisions

- Fail-fast + abort applies to both `runDiffDerivedScopedTests` wait paths: default `Promise.allSettled` and `options?.isolated` → `settleBounded`.
- Return caught as soon as any scoped killing file fails (non-timeout); do not await siblings.
- On that first failure, abort remaining spawns' process groups (`trackProcessGroup`) and release their verifier semaphore slots.
- When every file times out and none failed, keep today's non-terminating and confirmation re-run semantics.

## Acceptance criteria

- [ ] `diff-derived-mutation-verifier.test.ts`: fake runner — file A fails fast, file B never settles → `runDiffDerivedScopedTests` returns `false` without awaiting B and B's process group is aborted; fails against the pre-fix `allSettled` wait.
- [ ] `diff-derived-mutation-verifier.test.ts` and/or `write-loop.test.ts`: candidate path — A fails and B exceeds `KILLING_TEST_BUDGET_FLOOR_MS` → mutation caught (killed), not `non_terminating_mutation_failed`; fails against pre-fix.
- [ ] `diff-derived-mutation-verifier.test.ts` — `bounds a never-settling detached subprocess and settles verification` and `classifies scoped-test timeout separately from caught and surviving mutations` stay green.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — on first non-timeout killing-file failure, return caught immediately, abort never-settling (and still-running) sibling spawns, and release their semaphore slots; distinguish from the existing rule where a sibling **timeout** already settles under parallel wait.
- `v2/docs/v1-behaviors.md` — align the parallel scoped killing-set settlement bullet (~L145) with fail-fast on failure plus abort/release for siblings that never settle.

## Primary implementation surface

v2/src/execution/diff-derived-mutation-verifier.ts

## Prerequisites
