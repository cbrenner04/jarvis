# Pin armed watchdog timer unref hygiene

## Problem

Wall-segment, ceiling, and review-role watchdog timers in `write-loop.ts` and `review-role-invocation.ts` are real `setTimeout` arms that must not keep a Bun process alive after early settle. `.unref?.()` calls landed at `defaultWallSegmentSchedule`, the `awaitIteration` ceiling arm, and `invokeReviewRole`, but nothing pins them — a new watchdog site or a removed unref can silently regress. (#3060's `pipeline-execution.test.ts` hang was misattributed to these timers; the true cause was stub steps without `worktree` starving microtask spin loops — owned by [[typed-step-stubs-and-bounded-spins]], not here.)

## Surface

`defaultWallSegmentSchedule` and the `awaitIteration` ceiling arm in `v2/src/execution/write-loop.ts`; the review-role wall clock in `v2/src/execution/review-role-invocation.ts`; co-located regressions in `v2/src/execution/write-loop.test.ts` and `v2/src/execution/review-role-invocation.test.ts`; armed-watchdog process-liveness prose in `v2/docs/write-behavior.md`. Idle-output watchdog arms, persistence, daemon, and CLI are out of scope.

## Decision ledger

- Pin each armed watchdog kind by wrapping `globalThis.setTimeout` for the duration of the case and asserting `hasRef() === false` on every handle captured while the wrapper is installed; rules out unpinned hygiene that the next timer site regresses silently, and rules out `jest.useFakeTimers()`, whose fake handles are not the Node `Timeout` objects `hasRef()` is defined on — the unref'd-ness of the real handle is the property under test.
- Scope the assertion to handles armed by these three sites while the wrapper is installed, not to every timer the process arms; rules out a global timer audit that fails on unrelated library arms.
- Exercise `defaultWallSegmentSchedule` through `executeWriteLoop` without a `schedule` override; rules out testing only the injectable manual seam while the production default regresses.
- Early-settle only — fast ok bindings or caller abort before the bound elapses; rules out waiting real watchdog bounds in the v2 suite.
- Capture timer handles via test-local `setTimeout` spy/wrap only; rules out `setInvert*ForTest` / `invert*ForTest` production hooks for regression injection.
- Out of scope: microtask-spin / typed-step-stub starvation fixes; rules out duplicating [[typed-step-stubs-and-bounded-spins]].

## Work

- Add `write-loop.test.ts` regressions with a wrapped `globalThis.setTimeout`: one drives the default wall-segment schedule (no `schedule` injection) through a fast-settling iteration and asserts the armed handle is unref'd; one arms `iterationCeilingMs` through the same early-settle path and asserts the ceiling handle is unref'd.
- Add `review-role-invocation.test.ts` regression with a wrapped `globalThis.setTimeout`: `invokeReviewRole` with a fast ok binding, assert the role wall-clock handle is unref'd after settle.
- Document in `v2/docs/write-behavior.md` that armed wall-segment, ceiling, and review-role watchdog timers call `.unref?.()` so pending timers do not hold the Bun process alive after early settle.

## Acceptance criteria

- [x] `write-loop.test.ts` test `armed wall-segment watchdog timer is unref'd after early iteration settle` wraps `globalThis.setTimeout`, arms the default wall-segment schedule via `executeWriteLoop` without a `schedule` override, settles the iteration before the bound elapses, and asserts the captured `setTimeout` handle reports `hasRef() === false`; it fails when `.unref?.()` is omitted at `defaultWallSegmentSchedule` (reachable on main).
- [x] `write-loop.test.ts` test `armed iteration ceiling watchdog timer is unref'd after early iteration settle` wraps `globalThis.setTimeout`, arms `iterationCeilingMs` through `executeWriteLoop`, settles before the ceiling elapses, and asserts the ceiling `setTimeout` handle reports `hasRef() === false`; it fails when `.unref?.()` is omitted at the `awaitIteration` ceiling arm (reachable on main).
- [x] `review-role-invocation.test.ts` test `armed review-role wall-clock timer is unref'd after early ok settle` wraps `globalThis.setTimeout`, calls `invokeReviewRole` with a fast ok binding, and asserts the role wall-clock `setTimeout` handle reports `hasRef() === false`; it fails when `.unref?.()` is omitted at `invokeReviewRole` (reachable on main).
- [x] `v2/docs/write-behavior.md` states armed wall-segment, ceiling, and review-role watchdog timers are `.unref?.()`'d so pending timers do not hold the Bun process alive after early settle.
- [x] `bun run typecheck` passes.
- [x] `bun run test:v2` passes.

## Documentation updates

- `v2/docs/write-behavior.md` — armed wall-segment, ceiling, and review-role watchdog timers are `.unref?.()`'d; process liveness is owned by the execution loop, not the pending timer.
