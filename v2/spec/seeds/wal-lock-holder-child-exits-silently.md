---
name: wal-lock-holder-child-exits-silently
---

# The WAL concurrency lock-holder child exits before its marker, and the failure hides why

## Problem

`v2/src/persistence/state-store-wal-concurrency.test.ts` ("second writer on separate connection commits without database is locked") spawns `bun --eval <lock holder>` and awaits `jarvis-lock-held` via `waitForStdoutMarker` (`v2/src/testing/subprocess-marker.ts`). Since #3648 there is no startup deadline, yet the test still fails intermittently with `child closed stdout without reporting jarvis-lock-held (startup or exit, not a deadline)` — the child is exiting early. The rejection carries neither the child's stderr nor its exit code (the `end` listener fires before `exit`), so the cause is invisible and every occurrence costs a re-run and a diagnosis.

## Evidence

2026-09-16: failed in CI on PR #3954 (run 35172007671, a diff not touching persistence); 2026-09-17: failed again in a local `test:v2` gate on the `pipeline-lane-ready-pr-notifies` lane under concurrent load, passing 4/4 alone. Two occurrences in one day; the test's #3648 fix removed the deadline shape but not this one.

## Decisions

- `waitForStdoutMarker` buffers the child's stderr and, on rejection, waits for `exit` (bounded by the test timeout) and includes exit code, signal, and a stderr tail in the error. Rules out a rejection that names no cause.
- The lock-holder script itself is then fixed for whatever the captured stderr shows (likely a busy/locked open or a cwd/module-resolution failure under load); the fix is decided from evidence, not guessed here.
- If the cause is contention on the shared database path, the test isolates its database per spawn; the WAL assertion is unchanged.

## Acceptance criteria

- [ ] A test in `v2/src/testing/subprocess-marker.test.ts` asserts a child that writes to stderr and exits non-zero before the marker rejects with an error containing its exit code and stderr text; it fails against the current `end`-first rejection.
- [ ] The root cause of the early exit is recorded in the spec with the captured stderr, and the lock-holder script or test setup is changed to remove it.
- [ ] `state-store-wal-concurrency.test.ts` passes 20 consecutive runs under `JARVIS_TEST_CONCURRENCY` at the CI pool width with other `test:v2` files co-running.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/test-writing.md` — subprocess marker failures carry child stderr and exit code.
