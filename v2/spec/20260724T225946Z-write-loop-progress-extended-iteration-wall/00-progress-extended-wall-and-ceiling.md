# Progress-extended wall and hard ceiling

## Problem

`awaitIteration` arms one flat `setTimeout` for `iterationTimeoutMs`. Slow agents that keep
emitting stdout/stderr are killed at that bound; raising the bound makes silent stalls burn the
same duration before `iteration_timeout`.

## Decisions

- Reset the armed wall segment (`iterationTimeoutMs`) on invocation stdout/stderr progress during `awaitIteration`; rules out today's single non-resetting timer from `iteration_started`.
- Progress for wall extension is stdout/stderr only; rules out workspace mtime or step-marker extension in this change (invocation-liveness consumers own those).
- Enforce a hard ceiling as elapsed time since `iteration_started` without reset on output; rules out unbounded extension when output never stops.
- Ceiling overrun terminates as `iteration_timeout` with the same fence semantics as wall expiry; rules out a new outcome kind for ceiling-only kills.
- Silent stalls (no stdout/stderr progress) still hit `iteration_timeout` when the wall segment elapses without reset; rules out requiring output to start the wall.
- Abort-before-watchdog and post-timeout suppression stay as today; rules out reopening settled `iteration_timeout` races.
- Tests inject short `iterationTimeoutMs` and `iterationCeilingMs` on `WriteLoopInput`; rules out multi-minute CI waits.
- Deferred to first consumer: machine config key and default for ceiling — pinned in [01](./01-write-path-bounds-ordering.md) at write-path load; this subspec wires behavior via loop input only.

## Tasks

- [ ] Replace the flat `awaitIteration` watchdog with a resettable wall segment plus an absolute ceiling timer from iteration start.
- [ ] Hook stdout/stderr progress from the write invocation into wall-segment reset (same stream surface idle detection will use later).
- [ ] Plumb optional `iterationCeilingMs` on `WriteLoopInput` for tests and later config resolution.
- [ ] Add regression tests for extension, ceiling, guard inversion, and stall preservation.
- [ ] Update durable write-loop docs listed below.

## Acceptance criteria

- [ ] `write-loop.test.ts` test `progress output resets the iteration wall so a slow emitter completes` drives an agent that keeps emitting past the configured wall segment and asserts the iteration completes successfully; disabling wall reset on output fails the test.
- [ ] `write-loop.test.ts` test `continuous output cannot extend an iteration past the hard ceiling` drives steady stdout/stderr progress and asserts `iteration_timeout` at the injected ceiling while the wall segment alone would not yet fire; fails against pre-fix flat-timer-only `awaitIteration`.
- [ ] `write-loop.test.ts` `stalled executeWrite terminates the started attempt as iteration_timeout` stays green (silent stall still fences at the wall segment without progress).
- [ ] `write-loop.test.ts` abort-vs-watchdog race coverage for `iteration_timeout` stays green.
- [ ] `bun test v2/src/execution/write-loop.test.ts` passes.

## Documentation updates

- `v2/docs/write-behavior.md` — progress-extended iteration wall segment, hard ceiling, and which bound yields `iteration_timeout` (idle-output interaction deferred to the write-path idle-watchdog intent).
