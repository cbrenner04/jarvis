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
- Killed-successor test's failure (reproduced: `handoff_commit` returns `state: "rolled_back"`; retire log shows `handoff_fallback`/`rollback` before `handoff_commit`): `beginChangeover` arms the pre-commit fallback (`scheduleFallback`) before the real `bun` successor spawns, and the test's `fallbackMs: 3_000` often expired before the successor bound, so the fallback rolled back first. Not an admission race: listen→`setAdmitting` in `tickWatch` is microtask-only. Fix: the test uses the production `DEFAULT_HANDOFF_FALLBACK_MS` (omits `fallbackMs`), plain `startWork` (no `daemon_superseded` retry), and a suite timeout covering one committed-watch tick at that cadence.
- Committed-watch test: its `!existsSync` 2s, `answersHealth` 3s and settlement-log 500ms waits gate the verdict, so they use the unbounded poll too.
- Test-only; no production change, no `*ForTest` seams.

## Task checklist

- [x] Add unbounded poll helper.
- [x] Add per-test abort (`beforeEach`/`afterEach`) consumed by the helper and the retry-bind await.
- [x] Replace the five in-scope bounded waits.
- [x] Convert the watch-retry test to await the retry-bind event.
- [x] Root-cause and fix the killed-successor test's pre-commit fallback rollback.

## Acceptance criteria

- [x] The five in-scope waits in `daemon-changeover.sandbox-unrunnable.test.ts` carry no private deadline (the per-test suite timeout is the only deadline), and the watch-retry test awaits the retry-bind event before its unbounded health poll.
- [x] Retry falsifiability, proven against production code, not a test stub: on a scratch copy (uncommitted edit), make `tickWatch` in `v2/src/daemon/daemon.ts` not reschedule after a failed rebind (the watch never retries); the watch-retry test then fails by suite timeout, not pass, and no leaked poll or pending promise fails other tests in the file; revert and confirm `git diff --quiet v2/src/daemon/daemon.ts`.
- [ ] The killed-successor test passes under the same concurrent-load loop below, and it uses the production fallback default with no `daemon_superseded` retry. (Unticked at archival: on `main` it passes an explicit `fallbackMs: 30_000`, not the production default; no retry.)
- [ ] `for i in 1 2 3 4 5; do bun test v2/src/daemon/daemon-changeover.sandbox-unrunnable.test.ts || break; done` passes 5 consecutive times while `bun run test:integration:v2` runs concurrently for the whole span of all five passes (restarted whenever it finishes early). (Unticked at archival: the lane's tick was false; it still failed 3/5 under load. Hand-finish #4060 replaced the masking retry; #4070/#4071 fixed the remaining races.)
- [ ] `bun run typecheck`, `bun run test:v2` and `bun run test:integration:v2` pass. (typecheck and test:v2 pass; test:integration:v2 fails only on `daemon-dead-socket-reclaim` "a fresh start binds over a SIGKILLed daemon…", which also fails serially on `main`.)

## Documentation updates

- None (test-only).
