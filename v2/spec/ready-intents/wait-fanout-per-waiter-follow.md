---
name: wait-fanout-per-waiter-follow
---

# Replace shared wait fanout with per-waiter follow

## Problem

`v2/src/daemon/daemon.ts` (`Waiter`, `WaitFanout`, `detachWaiter`, `resolveWaiters`,
`ensureWaitFanout`) shares one log-follow loop across N concurrent `wait`
requests for a run. Realistic concurrent waiters per run is 1-2 (TUI plus
maybe one CLI wait), so the fanout bookkeeping buys nothing.

## Direction

Give each `wait` request its own `logReader.follow()` call; delete the shared
fanout machinery.

## Decisions

- Drop `Waiter`/`WaitFanout`/`detachWaiter`/`resolveWaiters`/`ensureWaitFanout`;
  the `wait` handler follows directly — rules out keeping a shared-subscriber
  registry sized for concurrency the daemon never sees.
- `daemon-wait-run-completion.test.ts` stays green, sized down with the
  removed fanout paths.

## Prerequisites
