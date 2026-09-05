---
name: watchdog-timers-never-hold-the-event-loop
---

# Armed watchdog timers never keep a bun process alive

Unsplit rationale: Wall-segment and ceiling watchdog arms in `write-loop.ts` and the review-role wall clock in `review-role-invocation.ts` are one execution-loop concern; pinning tests and the operator doc update do not cross persistence, daemon, or CLI boundaries.

## Primary implementation surface

- Execution loop (`v2/src/execution/`)

## Prerequisites

## Problem

The wall-segment, ceiling, and review-role watchdog timers are real `setTimeout` arms that must not keep a Bun process alive after early settle. `.unref?.()` calls landed in #3060's hand-finish (2026-08-29) at `defaultWallSegmentSchedule`, the `awaitIteration` ceiling arm, and `invokeReviewRole`, but nothing pins them — a new watchdog site or a removed unref can silently regress. (#3060's `pipeline-execution.test.ts` hang was misattributed to these timers; the true cause was stub steps without `worktree` starving microtask spin loops — owned by [[typed-step-stubs-and-bounded-spins]], not here.)

## Decision ledger

- Pin liveness: a process that arms each watchdog kind and reaches settle exits without waiting out the timer; rules out unpinned hygiene that the next timer site regresses.
- Watchdog-behavior tests drive fake timers and never wait out a real watchdog bound; rules out reintroducing wall-clock hangs in the v2 suite.
- Do not own the microtask-spin idiom that hid the #3060 misdiagnosis; rules out two seeds fixing the same test hazard.

## Acceptance criteria

- [ ] `v2/src/execution/` regression coverage proves a process that arms each watchdog kind (wall-segment via `defaultWallSegmentSchedule`, ceiling via `awaitIteration`, review-role via `invokeReviewRole`), settles early, and would otherwise wait out a long bound exits without holding the event loop; the test fails when the armed timer is ref'd (reachable on main by omitting `.unref?.()` at those three sites).
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — armed watchdog timers are `.unref?.()`'d; process liveness is owned by the execution loop, not the pending timer.
