---
name: mutation-verifier-fails-fast-on-first-killing-file
---

# Mutation verifier kills a candidate on its first failing killing file

## Problem

`runDiffDerivedScopedTests` (`v2/src/execution/diff-derived-mutation-verifier.ts` ~529) spawns one `bun test` per killing-set file and awaits `Promise.allSettled` (~558) before checking for a failure (~566), so a candidate's verdict waits for its slowest file. The candidate path (`runMutatedKillingSet` ~1297, caller comment ~1379) claims "returns false on the first failure"; it does not. A ~100 s file under 4-way verifier concurrency (`MAX_CONCURRENT_VERIFIER_TEST_RUNS` ~214) overruns the per-candidate bound (`KILLING_TEST_BUDGET_FLOOR_MS` ~149, baseline widening ~1314) and the candidate settles `non_terminating_mutation_failed` although another killing file already failed.

## Evidence

- 2026-10-01: #4332 candidate `write-loop.ts:612` settled `non_terminating_mutation_failed`; one killing file failed in ~14 ms while `write-loop.test.ts` (~100 s) ran to the bound. Exact timeout-vs-failure path to confirm at plan.

## Decisions

- A candidate is killed as soon as any killing-set file fails (non-timeout exit); do not await the rest.
- On that first failure, abort the remaining files' process groups (tracked via `trackProcessGroup`) and release their semaphore slots.
- Timeouts still settle non-terminating only when no file failed; isolated confirmation re-runs keep their semantics.

## Acceptance criteria

- [ ] Test with a fake runner: file A fails fast, file B never settles → `runDiffDerivedScopedTests` returns `false` without awaiting B and B's process group is aborted; fails against the pre-fix `allSettled`.
- [ ] Test: candidate path with A failing and B exceeding the floor budget → candidate killed, not non-terminating.
- [ ] Test: all files time out, none fail → unchanged non-terminating settlement.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — mutation verifier kills a candidate on its first failing killing file and aborts the rest.
