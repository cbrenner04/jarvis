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

- Pin with fake timers and `hasRef()` on armed watchdog handles: each kind armed and early-settled leaves the handle unref'd; rules out unpinned hygiene that the next timer site regresses.
- Never wait out a real watchdog bound in tests; rules out wall-clock hangs in the v2 suite.
- Do not own the microtask-spin idiom that hid the #3060 misdiagnosis; rules out two seeds fixing the same test hazard.

## Acceptance criteria

- [ ] `v2/src/execution/` regression coverage uses fake timers, arms each watchdog kind (wall-segment, ceiling via write-loop paths, review-role via `invokeReviewRole`), settles early, and asserts armed handles are unref'd via `hasRef()`; fails when `.unref?.()` is omitted at `defaultWallSegmentSchedule`, the `awaitIteration` ceiling arm, or `invokeReviewRole` (reachable on main).
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — armed watchdog timers are `.unref?.()`'d; process liveness is owned by the execution loop, not the pending timer.
