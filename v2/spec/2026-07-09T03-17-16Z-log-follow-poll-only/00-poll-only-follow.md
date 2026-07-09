# 00 - Replace FsAppendWake with poll-only follow

## Problem

`LogReader.follow` (`v2/src/persistence/log-stream.ts`) uses `FsAppendWake`
(`fs.watch` on the storage file/dir, dirty flag, directory-missing fallback)
as its primary wake signal, plus a 500ms `ABORT_POLL_MS` poll already layered
on top. The `fs.watch`-backed `FSWatcher` is the residual, only-`.unref()`-ed
(not removed) source of the intermittent `daemon-wait-run-completion.test.ts`
Linux CI timeout (#1191 reduced it, #1204 shows it recurs).

## Direction

Delete `FsAppendWake`, the `AppendWake` interface, and the
`AppendWakeFactory`/`wakeFactory` seam. `follow()` blocks only on a fixed
poll interval between `tail()` rescans.

## Decisions

- Poll interval is a single named constant `FOLLOW_POLL_MS`, 250-500ms — rules out an unnamed/duplicated magic number at each call site.
- `openLogReader`/`follow` gain an optional numeric poll-interval override for test use, replacing the deleted `wakeFactory` injection seam — rules out tests wall-clock-sleeping the full production interval per assertion.
- Follow latency changes from near-immediate (`fs.watch` event) to bounded by the poll interval — flagged, not hidden, since it's an observable behavior change for daemon `wait` callers.
- No directory-missing fallback path remains (poll rescans `tail()` regardless of whether the file exists yet), since polling already tolerates a not-yet-created storage file without a separate code path.

## Task checklist

- [ ] Delete `FsAppendWake`, `AppendWake`, `AppendWakeFactory`, `unrefWatcher`, `ABORT_POLL_MS`, `defaultAppendWakeFactory` from `v2/src/persistence/log-stream.ts`.
- [ ] Replace the `wake.wait()`/`wake.close()` loop in `follow()` with a poll on `FOLLOW_POLL_MS` (or the injected override).
- [ ] Update `v2/src/persistence/log-stream.test.ts`: remove `ControllableWake`, rewrite the four follow/abort tests against poll-only behavior using a short test poll interval.
- [ ] Update the `FsAppendWake` line in `v2/docs/v1-behaviors.md` to describe poll-only `follow()` behavior (interval, no watcher).
- [ ] Flip the `daemon-wait-run-completion.test.ts` residual-leak note in `v1/docs/operator-runbook.md` § "The gate" to resolved.

## Acceptance criteria

- [ ] `FsAppendWake`, `AppendWake`, and `AppendWakeFactory` no longer exist in `v2/src/persistence/log-stream.ts`; `follow()`'s only blocking wait is the named `FOLLOW_POLL_MS` poll.
- [ ] `log-stream.test.ts` stays green with no `fs.watch`/`FSWatcher` usage in the test file.
- [ ] `daemon-wait-run-completion.test.ts` passes across 10 consecutive local runs (`bun test v2/src/daemon/daemon-wait-run-completion.test.ts` x10) with no timeout.
- [ ] `v1/docs/operator-runbook.md` § "The gate" `daemon-wait-run-completion.test.ts` note reads resolved (structural fix landed), not residual.
- [ ] `v2/docs/v1-behaviors.md` no longer describes `FsAppendWake`/watcher `.unref()` behavior; describes poll-only `follow()` instead.

## Documentation updates

- `v1/docs/operator-runbook.md` — flip "The gate" residual-leak note to resolved.
- `v2/docs/v1-behaviors.md` — replace the `FsAppendWake` watcher-unref entry with the poll-only `follow()` behavior.
