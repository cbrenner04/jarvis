---
name: mutation-verifier-fails-fast-on-first-killing-file
---

# Mutation verifier kills a candidate on its first failing killing file

Unsplit rationale: scoped parallel spawns, candidate floor-budget killing-set runs, and verifier docs all live on one execution module (`diff-derived-mutation-verifier`).

## Problem

Parallel killing-set `bun test` spawns await every sibling before treating a non-timeout failure as caught, so a slow file can hit the per-candidate budget while another file already failed and the candidate wrongly settles `non_terminating_mutation_failed`.

## Decisions

- Return caught as soon as any scoped killing file fails (non-timeout); do not await siblings.
- On that first failure, abort remaining spawns' process groups (`trackProcessGroup`) and release their verifier semaphore slots.
- When every file times out and none failed, keep today's non-terminating and confirmation re-run semantics.

## Acceptance criteria

- [ ] Fake runner: file A fails fast, file B never settles → `runDiffDerivedScopedTests` returns `false` without awaiting B and B's process group is aborted; fails against the pre-fix `allSettled` wait.
- [ ] Candidate path: A fails and B exceeds `KILLING_TEST_BUDGET_FLOOR_MS` → mutation caught (killed), not `non_terminating_mutation_failed`; fails against pre-fix.
- [ ] All scoped files time out with no failure → unchanged non-terminating settlement.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — mutation verifier kills a candidate on its first failing killing file and aborts the rest.

## Primary implementation surface

v2/src/execution/diff-derived-mutation-verifier.ts

## Prerequisites
