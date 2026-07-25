---
name: write-loop-abort-watchdog-ordering-without-real-clock
---

# Write-loop abort-vs-watchdog ordering is tested without real-clock races

## Problem

`write loop > lets an observed abort win before the watchdog, but not after it` races
`setTimeout(() => …abort(), ms)` against `iterationTimeoutMs` on real wall clock. Under CI
load the abort can win the late case and the test flakes (`iteration_timeout` → `progress`).

## Decisions

- Abort-vs-watchdog ordering is decided by injected control, not two real timers — rules out widening the 5 ms / 40 ms margin.
- Both orderings stay asserted (abort before watchdog, watchdog before abort) — rules out dropping the late-abort case.
- Deferred to first consumer: injectable fake clock across the whole write loop — pin if a later caller needs it; out of scope for this intent.

## Acceptance criteria

- [ ] With the process artificially stalled well past every timeout in the case, `write loop > lets an observed abort win before the watchdog, but not after it` fails on pre-fix `setTimeout` wall-clock ordering and passes after injected-control rewrite.
- [ ] Running that case 50 times consecutively yields 50 passes.

## Documentation updates

- None — sibling guard intent owns determinism doc/runbook updates.

## Prerequisites
