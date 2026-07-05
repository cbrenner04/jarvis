# 02 - FIFO promotion of queued runs

Once a run is admitted or a running run finishes, the daemon must notice free
memory and promote queued runs — oldest first — without preempting whatever
is already running.

## Decisions

- Promotion is checked at admission boundaries: right after a `start` admits
  or queues, and right after a run reaches a terminal or paused state
  (wherever `setRunStatus` currently records that transition in
  `daemon.ts`) — rules out a separate poll timer as the only trigger, which
  would add unbounded promotion latency on an otherwise idle daemon.
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
  out).
- No preemption: promotion only ever admits queued runs into free headroom.
  It never pauses, kills, or otherwise touches an already-running run, even
  when memory later drops below the floor — matches the intent's explicit
  "(no preemption of already-running runs)".
- Promotion reconstructs `spawnWriteLoop`'s call from the queued run's
  persisted `WriteLoopInput` (from [01](./01-queued-admission-on-start.md))
  and transitions status `queued` -> `in-progress` before spawning, so a
  concurrent `list` never observes a run as simultaneously queued and live.

## Task checklist

- [ ] Add a promotion routine invoked after every admission-relevant status
      change (queue/spawn on `start`, terminal/paused settle elsewhere in
      `daemon.ts`): find the oldest `queued` run whose `(project, branch)` is
      unclaimed, check `hasMemoryHeadroom`, and if clear, promote it.
- [ ] Enforce the settle delay: after a promotion, suppress further
      promotions for `memory.settleDelayMs` before checking again.
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

## Documentation updates

- `v2/docs/daemon-host.md`: extend the memory-watermark section from
  [00](./00-memory-watermark-config.md) with the promotion trigger points,
  FIFO-with-skip ordering, `memory.settleDelayMs`, and the no-preemption
  guarantee.
