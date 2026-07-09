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
- Preserve the existing immediate-resolve short-circuit: if the run is already
  terminal at subscribe time, `wait` resolves from that snapshot without
  entering `follow()` at all — the per-waiter rewrite replaces only the
  follow-loop path, not this case.
- `follow()` errors are per-waiter: a thrown error from one waiter's own
  `follow()` call rejects only that waiter's promise; it has no effect on
  other concurrent waiters on the same run.
- On resolution (terminal record reached via `follow()`), re-fetch current run
  status from the store rather than reusing the subscribe-time snapshot —
  matches existing fanout behavior; rules out returning stale status observed
  before another concurrent event updated the run.
- `createRunControlHandlers`'s returned `close()` must still deterministically
  unwind every in-flight `wait` follow loop (so its log watcher releases) —
  track live per-request `AbortController`s in a `Set` and abort them all.
- Each per-request `AbortController` is removed from the `Set` when its
  `follow()` call settles — resolve, abort, or error — not only on `close()`;
  otherwise the `Set` accumulates one stale entry per completed wait for the
  life of the daemon.
- Disconnect-abort behavior is unchanged: aborting a request's own signal
  rejects only that `wait` call; it does not affect other waiters on the same
  run or the durable run status.

## Task checklist

- [ ] Remove `Waiter`, `WaitFanout`, `detachWaiter`, `resolveWaiters`,
      `ensureWaitFanout`, `waitFanouts` from `daemon.ts`.
- [ ] Rewrite the `wait` handler: keep the immediate-resolve short-circuit for
      an already-terminal run; otherwise call `logReader.follow(runId,
      signal)` per request, skip records at or before the subscribe cursor,
      and resolve on the first `loop_finished` or `run_execution_failed` by
      re-fetching current run status from the store.
- [ ] Track each in-flight wait's `AbortController` in a `Set` on the handler
      factory closure; add on start, remove on settle (resolve/abort/error);
      `close()` aborts every remaining entry and clears the set.
- [ ] Size down `daemon-wait-run-completion.test.ts`: delete cases that assert
      fanout-internal mechanics (e.g. shared-subscriber/registry bookkeeping);
      keep and pass cases asserting observable behavior (immediate resolve on
      already-terminal run, two-concurrent-waits, disconnect-one-waiter
      leaving the other and the run status unaffected, `close()` unwinding
      in-flight waits).

## Documentation updates

- Update `v2/docs/v1-behaviors.md`'s `close()` entry (~line 400), which names
  the fanout mechanism by name ("aborts every live wait fanout"), to describe
  the per-waiter follow-loop mechanism instead.

## Acceptance criteria

- [ ] `daemon-wait-run-completion.test.ts` stays green for all behavior-level
      cases: immediate resolve on an already-terminal run, two-concurrent-
      waits, disconnect-one-waiter (leaves the other waiter and the durable
      run status unaffected), and `close()` unwinding in-flight waits.
- [ ] A test confirms the per-request `AbortController` `Set` does not
      accumulate entries across normal (non-abort) wait completions.
- [ ] `Waiter`, `WaitFanout`, `detachWaiter`, `resolveWaiters`,
      `ensureWaitFanout` no longer exist in `v2/src/daemon/daemon.ts`.
- [ ] `bun run typecheck` passes.
- [ ] `v2/docs/v1-behaviors.md`'s `close()` entry describes the current
      per-waiter mechanism, not the removed fanout.
