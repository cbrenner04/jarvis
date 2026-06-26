# Inject fake sleep into classifyAgentError

## Behavior

The flaky test exercises a transient stderr (`"connection reset: refresh token
revoked"` matches `sharedTransportPatterns`), so `runAgent` runs the full
transient-retry loop. Because the test helper `classifyAgentError` does not pass
`opts.sleepMs`, the loop uses `defaultSleepMs` (real timers) over the backoff
schedule `[1000, 2000, 4000]`ms (~7000ms nominal across three attempts). The
effective per-test timeout is 30000ms (`timeout = 30000` in `bunfig.toml`), so
~7000ms nominal does not by itself trip it — it would fail every run, not
intermittently.

The real mechanism is event-loop starvation amplification under `bun test
--parallel`: with the loop saturated by the full suite, the `setTimeout` backoff
callbacks fire far later than their nominal delays, ballooning the ~7000ms well
past the 30000ms bound during the ready gate's `bun test` step.

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
- [ ] The `spawn classification order: transient → auth → model_config → quota` describe block (all six tests) stays green with its current expected results; the transient test (`"connection reset: refresh token revoked"`) — the only one that enters the backoff path — no longer depends on the real `[1000, 2000, 4000]`ms backoff wall-time.

## Documentation updates

None. Test-only change; no v1 runtime behavior changes, so `v2/docs/v1-behaviors.md` does not apply.
