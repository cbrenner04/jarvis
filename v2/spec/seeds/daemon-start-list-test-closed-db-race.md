---
name: daemon-start-list-test-closed-db-race
---

# `daemon-start-list.test.ts` races a closed database on CI

## Problem

`v2/src/daemon/daemon-start-list.test.ts` deterministically failed CI twice in a row
(2026-07-19, PR #1799, unrelated diff — a `scripts/`-only change that pulled in the
full aggregate suite):

```text
# Unhandled error between tests
RangeError: Cannot use a closed database
      at prepare (bun:sqlite:345:37)
      at listQueuedRuns (v2/src/persistence/state-store.ts:613:10)
      at promoteQueuedRunImpl (v2/src/daemon/daemon.ts:443:27)
      at <anonymous> (v2/src/daemon/daemon.ts:566:9)
```

`daemon.ts`'s run-cleanup path calls `promoteQueuedRun()` from inside a fire-and-forget
async IIFE's `finally` block (`daemon.ts:566`), which calls `promoteQueuedRunImpl` →
`store.listQueuedRuns()`. If a test's teardown closes the `StateStore`'s SQLite
connection before this deferred promise settles, the query throws on a closed
database — an "unhandled error between tests" that fails the whole file, not a single
assertion.

Both CI failures were bit-for-bit identical (same file, same line, same stack), so
this reproduces reliably under CI's timing/load, not a one-off. Passed locally
(macOS, less loaded) both times it was checked — consistent with the runbook's
documented "green on your machine, red on CI" timing-race pattern.

## Decisions

- The daemon (or its tests) must ensure every in-flight `promoteQueuedRun()` (and
  similar fire-and-forget cleanup work) settles before a test's `StateStore` closes —
  either by awaiting a drain/quiesce hook in teardown, or by the daemon guarding
  `listQueuedRuns`/similar calls against an already-closed store; rules out papering
  over with a longer test delay (load-sensitive, not deterministic).
- Prefer fixing the production race (unawaited fire-and-forget cleanup outliving its
  caller) over only hardening the test, since the same unawaited pattern could surface
  identically outside tests (e.g. daemon shutdown while a promotion is in flight).

## Acceptance criteria

- [ ] `v2/src/daemon/daemon-start-list.test.ts` (and any sibling test exercising
      run-cleanup → `promoteQueuedRun`) does not hit "Cannot use a closed database"
      across repeated CI runs.
- [ ] Either: the daemon awaits/quiesces in-flight `promoteQueuedRun()` work before a
      test-owned `StateStore` may close, or `listQueuedRuns`/`promoteQueuedRunImpl`
      fail closed (no-op or named error) against an already-closed store instead of
      throwing an unhandled `RangeError`.
- [ ] A regression test forces the race (close the store while a promotion is
      in-flight) and fails against the pre-fix code, passes after.
- [ ] `bun run typecheck`, `test:v2`, `test:integration:v2` pass.

## Documentation updates

None beyond test/reliability fix — no documented behavior changes.
