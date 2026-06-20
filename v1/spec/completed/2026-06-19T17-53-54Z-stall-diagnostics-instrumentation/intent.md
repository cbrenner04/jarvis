---
name: stall-diagnostics-instrumentation
---
# Stalled iterations record last-output age and child activity

**Scope.** v1 harness — `v1/src/agents/spawn.ts` (last-data tracking),
`v1/src/modes/patch/run.ts` (watchdog telemetry), docs. Lives in
`v2/spec/wip-intents/` for routing.

## Problem

When an iteration runs the full `iterationTimeoutMs` and aborts via the
watchdog (`run.ts:838-859`), the harness has no record of *why* the agent went
idle. `spawn.ts` buffers stdout/stderr (`outBuf`/`errBuf`) but never timestamps
the last data event, and the watchdog timeout telemetry carries only
`exitReason` and `watchdog_pgid`. A stall is indistinguishable from active work
after the fact.

## Desired behavior

When the iteration watchdog fires, telemetry and the watchdog log line carry
diagnostic signal: the age of the last agent stdout/stderr output, and whether
the agent's process group still has live descendants doing work at kill time.
A stalled iteration is diagnosable from `~/.jarvis/runs.jsonl` and the session
log without re-running it.

## Decisions

- Track last-output time at the spawn layer where data events arrive; surface it
  to the watchdog path. Rules out inferring idleness from coarse iteration
  wall-clock alone.
- Capture descendant liveness at kill time (process-group sample), not a polling
  loop. Rules out a continuous child-poller that competes with the agent.
- Diagnostic-only: no new abort or exit behavior here. Rules out coupling
  instrumentation to a watchdog policy change.

## Acceptance signals

- A test proves a watchdog-fired iteration records last-output age (and child
  activity when present) in telemetry, and the watchdog log line carries it.
- Existing watchdog exit code (`8`) and quota-fallback semantics unchanged.
- `bun run typecheck` and `bun test` pass.

## Documentation updates

- `v1/docs/run-loop.md`: the new last-output-age / child-activity fields on
  watchdog-timeout telemetry and the watchdog log line.
- `v2/docs/v1-behaviors.md`: the changed watchdog-timeout telemetry shape.

## Out of scope

- Any new abort bound (idle-output watchdog is a separate behavior).
- Descendant reaping / orphan cleanup (separate intent).

## Prerequisites
