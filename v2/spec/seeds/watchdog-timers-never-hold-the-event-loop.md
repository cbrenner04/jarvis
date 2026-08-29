---
name: watchdog-timers-never-hold-the-event-loop
---

# Armed watchdog timers never keep a bun process alive

## Problem

The wall-segment, ceiling, and review-role watchdog timers were real timers not `.unref()`'d; a short-lived process that arms one and settles early stays alive until the timer fires. The `.unref()` fix landed in #3060's hand-finish (2026-08-29) as hygiene, but nothing pins it — a new watchdog timer can silently regress. (Historical note: #3060's `pipeline-execution.test.ts` hang was originally attributed to these timers; the true cause was stub steps without `worktree` making the stamp throw before `wait()`, starving the tests' microtask spin loops. The unrefs are correct independent of that hang.)

## Decisions

- Pin the landed behavior: a process that arms each watchdog kind and reaches settle exits without waiting out the timer. Rules out unpinned hygiene that the next timer site regresses.
- Tests that assert watchdog behavior drive fake timers; no test waits out a real watchdog. Rules out reintroducing wall-clock hangs.
- The microtask-spin hazard that hid the real failure is owned by [[typed-step-stubs-and-bounded-spins]], not here. Rules out two seeds fixing the same idiom.

## Acceptance criteria

- [ ] A process that arms each watchdog kind (wall-segment, ceiling, review-role) and reaches settle exits without waiting for the timer, pinned by a test that fails against a ref'd timer.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — watchdog timers are unref'd; liveness is owned by the loop, not the timer.
