---
name: write-loop-iteration-timeout-on-stall
---

# Write-loop iteration timeout terminates stalled iterations

When a write loop emits `iteration_started` and makes no further progress (including paths where no agent subprocess is spawned), `iterationTimeoutMs` must fire, terminate the run with a named terminal outcome in the structured log, and clear in-memory liveness. No stall may be silent or unbounded.

## Decisions

- Arm the per-iteration wall-clock budget at `iteration_started` — rules out arming only after agent spawn.
- Emit a named terminal loop outcome (not bare hang) — rules out silent process exit with no structured-log record.
- Verify with injected short `iterationTimeoutMs` in tests — rules out waiting the 10-minute default in CI.

## Out of scope

- Replacing the spawn-gap root cause (see `plan-workflow-write-step-invokes-agent`).
- Redesigning invocation-liveness profiles.

## Documentation updates

- `v2/docs/workflow-runner.md` — write-loop stall timeout contract for write steps.
- `v2/docs/v1-behaviors.md` — v2 write-loop `iterationTimeoutMs` enforcement on stall paths.

## Prerequisites

- Write loop emits `iteration_started` before invoking the agent.
- `iterationTimeoutMs` is the operator-configurable per-iteration wall-clock budget (default 10 min).
