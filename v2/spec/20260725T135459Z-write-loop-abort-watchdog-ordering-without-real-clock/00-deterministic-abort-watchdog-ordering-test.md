# Deterministic abort-vs-watchdog ordering test

## Problem

`write-loop.test.ts` case `lets an observed abort win before the watchdog, but not after it` races
bare `setTimeout(() => …abort(), ms)` against `iterationTimeoutMs`. Under CI load the late-abort
subcase can settle `progress` instead of `iteration_timeout`.

## Decisions

- Abort-vs-watchdog ordering in that case is exercised through injected schedule control plus explicit
  `AbortSignal` abort, not competing real timers — rules out widening the 5 ms / 40 ms margin.
- Both orderings stay asserted in one case (abort before watchdog → `progress`; watchdog before abort
  → `iteration_timeout`) — rules out dropping the late-abort subcase.
- Add a `WriteLoopInput` seam for wall-segment scheduling in `awaitIteration` only: `schedule` receives
  `fire`, `delayMs`, and a cancel hook; production default is current `setTimeout` behavior. The seam
  covers every wall-segment schedule and **cancel/reschedule** on progress via `bumpWallSegment`, not
  only the initial schedule. `iterationCeilingMs` may stay on real timers until a later consumer — rules
  out a repo-wide injectable fake clock.
- The rewritten case never auto-fires scheduled callbacks; wall clock may elapse past configured delays
  without driving outcomes — rules out scheduler slack as proof of precedence.
- Early subcase: production settles abort on a microtask and the watchdog on synchronous `fire()`; the
  harness must establish abort **before** a synchronous watchdog `fire()` in those terms (e.g.
  `abort()`, then flush microtasks/settlement, then `fire()`), not both in one undifferentiated sync
  turn.
- The rewritten case must not use wall-clock waits to sync with the loop; it waits on a barrier (promise
  or equivalent) until injected `schedule` has registered `fire` before calling `fire()` or `abort()`.
- This case does not set or assert `iterationCeilingMs` or ceiling-vs-abort ordering — “no real-clock
  races here” is not “no real timers anywhere in the write loop.”
- Deferred to first consumer: injectable fake clock across the whole write loop — pin when a caller
  needs it.
- Documentation updates: none — sibling `guard-bare-settimeout-in-deterministic-tests` owns
  determinism doc/runbook alignment.

## Task checklist

- [ ] Add the wall-segment schedule seam on `WriteLoopInput` and wire it in `awaitIteration` (including
      `bumpWallSegment` cancel/reschedule).
- [ ] Rewrite `lets an observed abort win before the watchdog, but not after it` to use the seam,
      schedule-registration barrier, microtask-aware early ordering, and explicit abort; remove bare
      `setTimeout` abort delays from that case.
- [ ] Add a 50-run stability loop in the same file (no real-clock sync waits) proving the case stays
      green under repetition.
- [ ] Add a committed, CI-runnable inversion guard (comment/skip or sibling-guard style) targeting
      abort-vs-watchdog precedence; late-ordering must fail when precedence is wrong.

## Acceptance criteria

- [ ] With wall-segment schedules that never auto-fire, `write-loop.test.ts` case `lets an observed
      abort win before the watchdog, but not after it` waits on schedule registration before driving
      the harness; early subcase calls `abort()`, flushes abort settlement, then `fire()` and asserts
      `progress`; late subcase calls `fire()` then `abort()` and asserts `iteration_timeout`; it fails
      against pre-fix `setTimeout` wall-clock ordering and passes after the injected-control rewrite.
- [ ] The same case runs 50 consecutive subcase iterations inside the test (early ordering then late
      ordering each iteration) without real-clock synchronization waits and completes with 50 passes.
- [ ] A committed inversion check on abort-vs-watchdog precedence in `awaitIteration` (or the
      `timed_out` vs `aborted` settlement branch) fails at least one test in `write-loop.test.ts` when
      enabled; `lets an observed abort win before the watchdog, but not after it` late-ordering
      assertions prove wrong `iteration_timeout` when precedence is inverted.
- [ ] `write-loop.test.ts` cases `progress output resets the iteration wall so a slow emitter completes`
      and `continuous output cannot extend an iteration past the hard ceiling` stay green.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- None.
