# Completion ready gate reliably rides the 10-min iteration watchdog

## Problem

Every patch run this session (2026-07-11) hit the `iterationTimeoutMs` watchdog
(600000ms) on its **completion ready gate**: the gate goes silent (no stdout, no
file activity) for ~5–8 min, then the watchdog kills the agent
(`last_output_age_ms` ~300000–480000, `descendants_alive=false`). The run then
recovers via the shrink → review → final-ready path and still lands, so it is not
fatal — but it adds ~10 min of dead wall-clock to nearly every run and muddies
timeout diagnostics.

Per the operator runbook, "a normal operation riding that wall is a defect to
fix, not tolerated runtime." The likely cause is the full `bun run ready` suite
(run sandbox-off at completion) executing the slow `*.sandbox-unrunnable.test.ts`
subprocess-spawning tests with no incremental output, so the watchdog can't tell
progress from a hang.

## Decisions

- Make the completion ready gate emit heartbeat/progress output (or reset the
  idle timer on child test output) so a legitimately-slow-but-progressing gate is
  not killed as idle.
- Or scope/parallelize the completion gate so it finishes well under the
  iteration wall, or give the gate its own (longer, or output-aware) budget
  distinct from an agent iteration.

## Prerequisites

- none

## Out of scope

- Raising `iterationTimeoutMs` globally (masks the defect).

## Reference

- Operator runbook § The gate, § Manual-finalize recovery (iteration-timeout).
