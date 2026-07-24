---
name: write-loop-progress-extended-iteration-wall
---

# Write-loop iteration wall extends on output, capped by a hard ceiling

## Problem

`awaitIteration` arms one flat `setTimeout` for `iterationTimeoutMs` (`write-loop.ts`). A
slow-but-emitting agent is killed at that bound; raising the bound makes silent stalls burn the
same duration before `iteration_timeout`.

## Decisions

- Reset the iteration wall-clock budget on stdout/stderr progress during `awaitIteration`; rules out keeping today's single flat timer.
- Terminate the iteration at a hard ceiling elapsed since iteration start regardless of output rate; rules out an unbounded progress extension.
- Reject at config load when `idleOutputTimeoutMs` exceeds the iteration wall clock or the wall clock exceeds the ceiling, naming both values; rules out silently disarming bounds when ordering is inverted (new write-path loader policy — review roles do not validate idle vs wall today).
- Deferred to first consumer: default hard-ceiling duration and config key name — pin when the loader and tests need a concrete value.

## Acceptance criteria

- [ ] A write-loop test drives an agent that keeps emitting output past the configured iteration wall clock and asserts the iteration completes successfully; inverting the extension (ignoring output) fails the test.
- [ ] A write-loop test drives an agent that emits output continuously and asserts the iteration terminates at the hard ceiling before unbounded extension; fails against the pre-fix flat timer-only code.
- [ ] Loading machine config with `idleOutputTimeoutMs` greater than the iteration wall clock, or iteration wall clock greater than the ceiling, fails with a message naming both compared bounds.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — progress-extended iteration wall clock and hard ceiling; which bound fires when (idle coverage deferred to the idle-watchdog intent).
- `v2/docs/install-and-config.md` — iteration wall, ceiling, and ordering against `idleOutputTimeoutMs`.
- `v2/docs/v1-behaviors.md` — v2 write-loop wall/ceiling vs v1 flat `iterationTimeoutMs` parity baseline.

## Prerequisites
