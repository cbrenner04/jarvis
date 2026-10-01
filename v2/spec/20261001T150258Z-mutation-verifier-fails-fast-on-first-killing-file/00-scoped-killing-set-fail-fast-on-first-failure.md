# Scoped killing-set fail-fast on first non-timeout failure

## Problem

`runDiffDerivedScopedTests` (`v2/src/execution/diff-derived-mutation-verifier.ts`) fans out scoped `bun test` spawns and waits for every sibling before treating a non-timeout `AsyncSubprocessError` as caught (`Promise.allSettled` on the default path; `settleBounded` when `options.isolated`). A sibling that never settles (distinct from `ETIMEDOUT`, which already rejects and is covered by `returns caught when a sibling scoped test fails before a parallel timeout`) can keep the waiter blocked until the per-candidate budget fires while another file already failed, so the candidate wrongly settles `non_terminating_mutation_failed` instead of killed.

## Decisions

- Apply fail-fast and sibling abort to both wait paths in `runDiffDerivedScopedTests` — default `Promise.allSettled` and `options?.isolated` → `settleBounded`; rules out fixing only the default path and leaving confirmation/isolated batches hung on never-settling siblings.
- Return caught (`false`) as soon as any scoped killing file fails with a non-timeout `AsyncSubprocessError`; do not await remaining siblings for that classification; rules out retaining today's wait-for-all-then-`some()` ordering, which is what lets a never-settling sibling dominate.
- On that first non-timeout failure, abort every still-running scoped spawn via the existing group-mode subprocess `AbortSignal` seam (`shared/subprocess.ts`), invoking each spawn's `trackProcessGroup` `settle` in `spawnOne`'s `finally` so recorded pgids clear and `VerifierTestRunSemaphore` slots release; rules out returning early while semaphore holds or process groups stay recorded.
- Do not start additional scoped files in `settleBounded` after fail-fast triggers; rules out workers continuing to dequeue while the batch is already caught.
- When no non-timeout failure occurred and every settled sibling is `ETIMEDOUT`, keep today's throw-on-timeout and `non-terminating-mutation` / inconclusive confirmation semantics unchanged; rules out folding timeout-only batches into caught.
- When one sibling fails non-timeout and another only `ETIMEDOUT`, keep caught dominant (`returns caught when a sibling scoped test fails before a parallel timeout` on `main`); rules out reclassifying that mix as non-terminating.
- Add regression coverage at `runDiffDerivedScopedTests` with a fake runner before wiring the full `verifyDiffDerivedMutations` / write-loop candidate path; rules out only an integration test that cannot pin abort without the helper fix.

## Tasks

- [ ] Implement shared fail-fast wait + abort in `runDiffDerivedScopedTests` for both parallel wait shapes; ensure `spawnOne` passes abort through to `runAsync` and never-settling mocks unblock on abort.
- [ ] Add `returns caught without awaiting a never-settling sibling and settles the sibling runAsync on abort` (default parallel path) and `returns caught on isolated scoped runs without dequeuing after a never-settling sibling` (`options.isolated` / `settleBounded`) in `diff-derived-mutation-verifier.test.ts`; add `kills the candidate when one killing file fails and a sibling never settles through the floor budget` via `verifyDiffDerivedMutations` / `verifyTimeout`; keep preservation tests cited in acceptance criteria green.
- [ ] Update `v2/docs/write-behavior.md` and `v2/docs/v1-behaviors.md` per Documentation updates.

## Acceptance criteria

- [ ] `diff-derived-mutation-verifier.test.ts` — `returns caught without awaiting a never-settling sibling and settles the sibling runAsync on abort`: file A fails fast with a non-timeout `AsyncSubprocessError`, file B's fake `runAsync` never resolves until `options` abort fires and then settles; `runDiffDerivedScopedTests` returns `false` within a short wall-clock bound without awaiting B's hang; fails against pre-fix `allSettled` wait if B still blocks after A fails.
- [ ] `diff-derived-mutation-verifier.test.ts` — `returns caught on isolated scoped runs without dequeuing after a never-settling sibling`: with `options.isolated: true`, scope sized so `settleBounded` would dequeue a third file after A fails and B never settles, helper returns `false` quickly, B's `runAsync` settles on abort, and the third path is never started; fails against pre-fix if only the default `Promise.allSettled` path is fixed.
- [ ] `diff-derived-mutation-verifier.test.ts` — `kills the candidate when one killing file fails and a sibling never settles through the floor budget`: through `verifyDiffDerivedMutations` / `verifyTimeout`, one killing file fails non-timeout and a sibling would exceed `KILLING_TEST_BUDGET_FLOOR_MS` if awaited → verification passes (candidate killed), not `non-terminating-mutation` / `non_terminating_mutation_failed`; fails against pre-fix behavior.
- [ ] `diff-derived-mutation-verifier.test.ts` — `returns caught when a sibling scoped test fails before a parallel timeout` stays green (reachable on `main`).
- [ ] `diff-derived-mutation-verifier.test.ts` — `treats a caught failure as dominant when co-located and sibling scoped tests run in parallel` stays green (reachable on `main`).
- [ ] `diff-derived-mutation-verifier.test.ts` — `bounds a never-settling detached subprocess and settles verification` stays green (reachable on `main`).
- [ ] `diff-derived-mutation-verifier.test.ts` — `classifies scoped-test timeout separately from caught and surviving mutations` stays green (reachable on `main`).
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` § Diff-derived mutation verification — on the first non-timeout killing-file failure, return caught immediately, abort never-settling and still-running sibling scoped spawns (group-mode abort + `trackProcessGroup` settle), and release their verifier semaphore slots; distinguish from the existing parallel rule where a sibling **timeout** (`ETIMEDOUT`) already settles under the parallel wait and caught remains dominant over timeout.
- `v2/docs/v1-behaviors.md` — update the `[v2 behavior change]` diff-derived scoped killing-set settlement bullet (~L145) to match fail-fast on non-timeout failure plus abort/release for siblings that never settle; sources: `diff-derived-mutation-verifier.ts`, `write-behavior.md`.
