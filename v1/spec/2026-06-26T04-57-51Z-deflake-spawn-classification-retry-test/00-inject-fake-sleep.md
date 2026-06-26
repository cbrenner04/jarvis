# Inject fake sleep into classifyAgentError

## Behavior

The flaky test exercises a transient stderr (`"connection reset: refresh token
revoked"` matches `sharedTransportPatterns`), so `runAgent` runs the full
transient-retry loop. Because the test helper `classifyAgentError` does not pass
`opts.sleepMs`, the loop uses `defaultSleepMs` (real timers) and burns the
backoff schedule `[1000, 2000, 4000]`ms of real wall-time per run. Under
full-suite CPU pressure that real sleep time tips the test over its bun-test
timeout during the ready gate's `bun test` step.

Fix: inject a no-op `sleepMs` into the `classifyAgentError` helper so the retry
backoff performs no real sleeps. Classification outcome is independent of sleep
timing, so the six existing assertions keep their current expected results; the
describe block just stops depending on wall-time.

## Decisions

- Inject via `runAgent`'s existing `opts.sleepMs` hook — no production code change. Rules out forking `defaultSleepMs` or adding a test-only branch in `spawn.ts`.
- No-op sleep (resolve immediately), not a fake-clock with controllable advance — the test asserts only final classification, never retry timing or `onTransientRetry` counts. Rules out building unused timer-control scaffolding.

## Task checklist

- [ ] Pass `sleepMs: async () => {}` (or equivalent immediate-resolve) through `classifyAgentError`'s `runAgent` call in `v1/test/agents/spawn-classification.test.ts`.

## Acceptance criteria

- [ ] `classifyAgentError` in `v1/test/agents/spawn-classification.test.ts` injects an immediate-resolve `sleepMs` so the transient-retry loop performs no real backoff sleeps.
- [ ] The `spawn classification order: transient → auth → model_config → quota` describe block (all six tests) stays green with its current expected results, and its runtime no longer depends on the real `[1000, 2000, 4000]`ms backoff wall-time.

## Documentation updates

None. Test-only change; no v1 runtime behavior changes, so `v2/docs/v1-behaviors.md` does not apply.
