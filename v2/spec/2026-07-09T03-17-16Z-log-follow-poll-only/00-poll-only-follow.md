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
- No directory-missing fallback path remains (poll rescans `tail()` regardless of whether the file exists yet); confirmed as a task step against `tail()`'s current behavior/coverage rather than assumed.
- `daemon.ts`'s `waitFanouts`/`ensureWaitFanout` fanout structure (one `follow()` shared per run ID across N waiters via a single `AbortController`) stays as-is — out of scope. The leak was the `fs.watch`-backed watcher itself, not the fanout sharing; deleting `FsAppendWake` removes the watcher regardless of how many waiters share the resulting poll loop. The runbook's existing "per-waiter poll-only follow" phrasing overstated this and is corrected as part of this subspec's doc update, not implemented.

## Task checklist

- [ ] Delete `FsAppendWake`, `AppendWake`, `AppendWakeFactory`, `unrefWatcher`, `ABORT_POLL_MS`, `defaultAppendWakeFactory` from `v2/src/persistence/log-stream.ts`.
- [ ] Replace the `wake.wait()`/`wake.close()` loop in `follow()` with a poll on `FOLLOW_POLL_MS` (or the injected override).
- [ ] Grep the repo for all remaining `AppendWake`/`wakeFactory` references (including `daemon.ts`'s `ensureWaitFanout` comment "closes its watcher" and `v2/src/testing/run-control.ts` / `createRunControlHandlers().close()`) and update or remove each — no dangling reference to the deleted seam survives.
- [ ] Update `v2/src/persistence/log-stream.test.ts`: remove `ControllableWake`, rewrite the four follow/abort tests against poll-only behavior using a short test poll interval.
- [ ] Update both `v2/docs/v1-behaviors.md` lines that describe watcher semantics: the `FsAppendWake` `.unref()` entry and the `createRunControlHandlers().close()` "releases its watcher deterministically" entry — both become poll-only descriptions.
- [ ] Update the `daemon-wait-run-completion.test.ts` note in `v1/docs/operator-runbook.md` § "The gate": flip to resolved, and correct the "replaces the wait fanout with a per-waiter poll-only follow" phrasing to reflect that the fanout structure is unchanged — only `follow()`'s wake mechanism moved from watch to poll.

## Acceptance criteria

- [x] `FsAppendWake`, `AppendWake`, and `AppendWakeFactory` no longer exist anywhere in the repo; `follow()`'s only blocking wait is the named `FOLLOW_POLL_MS` poll.
- [x] `log-stream.test.ts` stays green with no `fs.watch`/`FSWatcher` usage in the test file.
- [ ] `daemon-wait-run-completion.test.ts` passes across 10 consecutive local runs (`bun test v2/src/daemon/daemon-wait-run-completion.test.ts` x10) with no timeout, **and** across 5 consecutive re-runs of the PR's `Test (v2)` CI job with no timeout — local runs alone don't establish the Linux-CI-specific inotify claim.
- [x] `v1/docs/operator-runbook.md` § "The gate" `daemon-wait-run-completion.test.ts` note reads resolved (structural fix landed) and no longer claims the wait fanout was converted to per-waiter.
- [x] `v2/docs/v1-behaviors.md` no longer describes `FsAppendWake`/watcher `.unref()` or watcher-release behavior anywhere; both affected entries describe poll-only `follow()` instead.

## Documentation updates

- `v1/docs/operator-runbook.md` — flip "The gate" residual-leak note to resolved; correct its fanout-conversion phrasing.
- `v2/docs/v1-behaviors.md` — replace both watcher-semantics entries (`FsAppendWake` unref, `createRunControlHandlers().close()`) with poll-only `follow()` behavior.
