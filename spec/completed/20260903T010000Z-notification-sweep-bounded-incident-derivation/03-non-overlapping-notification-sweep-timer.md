# Non-overlapping notification sweep timer

## Problem

The daemon's five-second `setInterval` callback invokes `runNotificationSweep` unconditionally; when a sweep blocks the event loop longer than the interval, overlapping callbacks stack and compound IPC starvation.

## Decision ledger

- A sweep still running when the five-second timer fires skips the tick; rules out queueing overlapping sweeps on the event loop.
- The in-flight guard lives in the daemon `setInterval` callback path that schedules notification sweeps, not only inside `runNotificationSweep`; rules out relying on concurrent `runNotificationSweep` calls to self-serialize.
- Extract a pure `shouldSkipOverlappingNotificationSweep(inProgress: boolean)` predicate for the guard (per `test-writing.md` timer-callback convention); rules out testing only the predicate without wiring proof on the interval path.
- Boot-time initial sweep before the timer starts is unchanged; rules out skipping the first post-reconciliation sweep.
- Deferred to first consumer: whether skipped ticks are counted or logged — pin when an operator-facing diagnostic needs it.

## Prerequisites

none

## Task checklist

- Add an in-flight flag set for the duration of each daemon-scheduled notification sweep.
- Wrap the `setInterval` callback in `daemon.ts` so a tick is skipped when the prior sweep has not finished.
- Export `shouldSkipOverlappingNotificationSweep` for deterministic predicate tests and mutation proof.
- Add `operator-notification-sweep.test.ts` regression `notification sweep timer skips a tick while the prior sweep is still running`: start daemon runtime (or the exported interval-scheduling seam) with a blocking sweep hook, advance the five-second interval while the first sweep is in flight, and assert the second tick does not enqueue another sweep; fails against pre-fix overlap behavior. Concurrent bare `runNotificationSweep` calls alone do not satisfy this AC.

## Acceptance criteria

- [x] `v2/src/daemon/operator-notification-sweep.test.ts` test `notification sweep timer skips a tick while the prior sweep is still running` drives the daemon `setInterval` guard (not concurrent `runNotificationSweep` calls alone) and asserts the second tick is skipped, not queued; it fails against the pre-fix overlap behavior.
- [x] `v2/src/daemon/operator-notification.test.ts` — `boot sweep delivers an incident settled while no daemon was alive` stays green (initial post-reconciliation sweep unchanged).
- [x] `bun run test:v2` passes.

## Documentation updates

- Deferred to subspec 04.
