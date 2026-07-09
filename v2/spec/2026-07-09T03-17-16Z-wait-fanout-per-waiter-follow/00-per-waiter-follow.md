# Per-waiter follow

## Problem

`v2/src/daemon/daemon.ts`'s `wait` handler shares one `logReader.follow()` loop
across all concurrent `wait` requests for a run, via `Waiter`/`WaitFanout`/
`detachWaiter`/`resolveWaiters`/`ensureWaitFanout`. Realistic concurrency per
run is 1-2 waiters, so the shared-subscriber bookkeeping is unneeded
complexity.

## Decisions

- Each `wait` request calls `logReader.follow()` directly and resolves on the
  first record past its own subscribe cursor — rules out a shared per-run
  registry sized for concurrency the daemon never sees.
- Delete `Waiter`, `WaitFanout`, `detachWaiter`, `resolveWaiters`,
  `ensureWaitFanout`, and the `waitFanouts` map.
- `createRunControlHandlers`'s returned `close()` must still deterministically
  unwind every in-flight `wait` follow loop (so its log watcher releases) —
  track live per-request `AbortController`s in a `Set` and abort them all.
- Disconnect-abort behavior is unchanged: aborting a request's own signal
  rejects only that `wait` call; it does not affect other waiters on the same
  run or the durable run status.

## Task checklist

- [ ] Remove `Waiter`, `WaitFanout`, `detachWaiter`, `resolveWaiters`,
      `ensureWaitFanout`, `waitFanouts` from `daemon.ts`.
- [ ] Rewrite the `wait` handler to call `logReader.follow(runId, signal)`
      per request, skipping records at or before the subscribe cursor and
      resolving on the first `loop_finished` or `run_execution_failed`.
- [ ] Track each in-flight wait's `AbortController` in a `Set` on the handler
      factory closure; `close()` aborts every entry and clears the set.
- [ ] Size down `daemon-wait-run-completion.test.ts` for the removed fanout
      paths; keep it green.

## Documentation updates

- Update `v2/docs/v1-behaviors.md`'s `close()` entry (~line 400), which names
  the fanout mechanism by name ("aborts every live wait fanout"), to describe
  the per-waiter follow-loop mechanism instead.

## Acceptance criteria

- [ ] `daemon-wait-run-completion.test.ts` stays green (all tests, including
      the two-concurrent-waits and disconnect-one-waiter cases).
- [ ] `Waiter`, `WaitFanout`, `detachWaiter`, `resolveWaiters`,
      `ensureWaitFanout` no longer exist in `v2/src/daemon/daemon.ts`.
- [ ] `bun run typecheck` passes.
- [ ] `v2/docs/v1-behaviors.md`'s `close()` entry describes the current
      per-waiter mechanism, not the removed fanout.
