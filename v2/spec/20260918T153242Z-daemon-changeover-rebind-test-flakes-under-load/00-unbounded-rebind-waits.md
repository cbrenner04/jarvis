# Unbounded waits in committed-handoff rebind tests

## Problem

Positive `waitFor(..., N_000)` calls in `v2/src/daemon/daemon-changeover.sandbox-unrunnable.test.ts` are private wall-clock deadlines that fail under `test:integration:v2` load.

## Decisions

- In-scope waits (line numbers on the current file), by test:
  - killed-successor test: `!existsSync` 2s (`:844`), `existsSync` 3s (`:849`), `answersHealth` 8s (`:858`)
  - watch-retry test: `answersHealth` 3s (`:897`)
  - slow-successor test: `publicBindCount() >= 3` 3s (`:928`) only
- Add a test-local unbounded poll helper (predicate and `AbortSignal`, no deadline arg); use it for exactly those five calls. Rules out raising the numbers or a bound near the suite timeout.
- Leave every other `waitFor` call unchanged, including negative-window ones (`rolledBackEarly`) and the slow-successor test's `!existsSync` 2s (`:916`) — out of scope, stays bounded.
- Stopping: a file-level `AbortController` is renewed in `beforeEach` and aborted in `afterEach`; the poll helper and the retry-bind await both reject on abort, so a timed-out test's body unwinds through its `finally` (closing the incumbent) instead of polling or hanging into later tests. Rules out fire-and-forget loops that survive the test.
- Watch-retry test: the injected `bind` resolves a one-shot promise when `startIpcServer` succeeds on public bind `>= 3` (the first successful public bind after the injected failure at bind 2). The test awaits it (aborts with the test), then confirms health through the unbounded poll rather than one immediate `answersHealth`. Rules out a single immediate health check, which reintroduces the load flake.
- Test-only; no production change, no `*ForTest` seams.

## Task checklist

- [ ] Add unbounded poll helper.
- [ ] Add per-test abort (`beforeEach`/`afterEach`) consumed by the helper and the retry-bind await.
- [ ] Replace the five in-scope bounded waits.
- [ ] Convert the watch-retry test to await the retry-bind event.

## Acceptance criteria

- [ ] The five in-scope waits in `daemon-changeover.sandbox-unrunnable.test.ts` carry no private deadline (the per-test suite timeout is the only deadline), and the watch-retry test awaits the retry-bind event before its unbounded health poll.
- [ ] Temporarily making the injected `bind` throw on every public bind after the first makes the watch-retry test fail by suite timeout, not pass, while every other test in the file still passes (no leaked poll or pending promise affects later tests); change reverted afterward.
- [ ] `for i in 1 2 3 4 5; do bun test v2/src/daemon/daemon-changeover.sandbox-unrunnable.test.ts || break; done` passes 5 consecutive times while `bun run test:integration:v2` runs concurrently for the whole span of all five passes (restarted whenever it finishes early).
- [ ] `bun run typecheck`, `bun run test:v2` and `bun run test:integration:v2` pass.

## Documentation updates

- None (test-only).
