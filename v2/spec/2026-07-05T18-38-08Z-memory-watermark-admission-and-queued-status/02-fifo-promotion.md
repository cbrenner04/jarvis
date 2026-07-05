# 02 - FIFO promotion of queued runs

Once a run is admitted or a running run finishes, the daemon must notice free
memory and promote queued runs — oldest first — without preempting whatever
is already running.

## Decisions

- Promotion is checked from two trigger points, not a poll timer: (1) right
  after `start` admits or queues a run, and (2) inside `spawnWriteLoop`'s
  `finally` block in `v2/src/daemon/daemon.ts` — the single place that
  releases a run's `activeRuns` entry and `_registry` claim on every exit path
  (terminal outcomes and graceful pause both resolve `writeLoopExecutor`
  without throwing, so both reach this `finally`; abort/kill and
  spawn-failure paths reach it too). Anchoring here — rather than at each of
  the several `store.setRunStatus` call sites in
  `v2/src/execution/write-loop.ts` and `v2/src/daemon/daemon.ts` that record
  individual terminal/paused transitions — gives one reliable integration
  point instead of one per status-setting call site, and it's exactly when a
  `(project, branch)` key frees up.
- Promotion at trigger (1) additionally covers the idle-queue case: when a
  `start` is queued because memory was briefly tight and no other run is
  live to later hit trigger (2), there is no future exit event to promote
  it. `start` re-checks `hasMemoryHeadroom` immediately after persisting the
  queued row (same synchronous call, no wait) and promotes right away if it
  now clears — covering the common case where memory recovers between the
  first check and the row being persisted. Beyond that immediate recheck, a
  queued run that stays queued while no other run is active has no further
  promotion trigger until the next `start`/exit event occurs; this repo
  accepts that scope boundary rather than adding a poll timer.
- FIFO order is queued runs' `createdAt` ascending — the oldest queued run is
  always considered first; a younger queued run is never promoted ahead of an
  older one still blocked on its own `(project, branch)` claim conflicting
  with something live (skip it and try the next-oldest instead, since a
  strict head-of-line block on an unrelated key would starve unrelated queued
  work indefinitely).
- **Settle delay between admissions:** after promoting one queued run, wait a
  fixed delay (config: `memory.settleDelayMs`, default `2000`) before
  measuring headroom again for the next promotion — rules out re-measuring
  immediately, which races ahead of the just-admitted run's actual memory
  footprint ramping up (the thundering-herd case the architecture doc calls
  out). The immediate recheck in the idle-queue decision above is a one-time
  exception scoped to the row just queued, not a repeated re-measurement.
- No preemption: promotion only ever admits queued runs into free headroom.
  It never pauses, kills, or otherwise touches an already-running run, even
  when memory later drops below the floor — matches the intent's explicit
  "(no preemption of already-running runs)".
- Promotion reconstructs `spawnWriteLoop`'s call from the queued run's
  persisted `WriteLoopInput` (from [01](./01-queued-admission-on-start.md))
  and transitions status `queued` -> `in-progress` before spawning, so a
  concurrent `list` never observes a run as simultaneously queued and live.

## Task checklist

- [ ] Add a promotion routine invoked from both trigger points: the `start`
      handler (after queuing, and after admitting) and `spawnWriteLoop`'s
      `finally` block — find the oldest `queued` run whose `(project,
      branch)` is unclaimed (per [01](./01-queued-admission-on-start.md)'s
      extended claim check), check `hasMemoryHeadroom`, and if clear, promote
      it.
- [ ] Enforce the settle delay: after a promotion, suppress further
      promotions for `memory.settleDelayMs` before checking again, except for
      the one-time immediate recheck a `start` performs on the row it just
      queued.
- [ ] Add `memory.settleDelayMs` to the machine config validation from
      [00](./00-memory-watermark-config.md) (positive integer, default
      `2000` when absent).
- [ ] Skip-and-continue past a queued run whose key is currently claimed,
      trying the next-oldest queued run instead of stopping.

## Acceptance criteria

- [ ] Given two queued runs for distinct `(project, branch)` keys queued in
      order A then B, once memory clears the watermark and the settle delay
      has elapsed, A is promoted to `in-progress` (spawned) before B.
- [ ] A queued run is never promoted while memory stays below the configured
      watermark; it remains `status: "queued"`.
- [ ] Promoting one queued run does not change the status of any other
      already-running run, even when a subsequent headroom check (before the
      settle delay elapses) would report insufficient memory.
- [ ] A queued run whose `(project, branch)` key is claimed by a live run is
      skipped in favor of the next-oldest eligible queued run.
- [ ] A `start` that queues a run because memory is briefly below the
      watermark, where memory has already recovered by the time the row is
      persisted, results in that run being promoted without waiting for a
      later run to exit.
- [ ] A run reaching a paused state (not just a terminal outcome) frees its
      `(project, branch)` key for promotion of an eligible queued run.

## Documentation updates

- `v2/docs/daemon-host.md`: extend the memory-watermark section from
  [00](./00-memory-watermark-config.md) with the promotion trigger points
  (post-`start` and the shared run-exit cleanup path), FIFO-with-skip
  ordering, `memory.settleDelayMs`, the idle-queue immediate-recheck
  behavior and its scope boundary, and the no-preemption guarantee.
