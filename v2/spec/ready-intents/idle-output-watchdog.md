---
name: idle-output-watchdog
---
# Idle-output watchdog bounds stalls below the wall-clock timeout

**Scope.** v1 harness — `v1/src/modes/patch/run.ts` (watchdog), config, docs.
Lives in `v2/spec/wip-intents/` for routing.

## Problem

The only iteration bound is wall-clock `iterationTimeoutMs` (default 30 min;
`run.ts:838-859`). An agent that goes idle — no stdout/stderr — still consumes
the full timeout before the watchdog aborts it, wasting ~30 min per stall. There
is no tighter bound keyed to the agent actually producing output.

## Desired behavior

An idle-output watchdog aborts an iteration after a configurable span of no
agent output, well under `iterationTimeoutMs`, distinguishing "idle/blocked"
from "actively working" by output recency. Long legitimate work that keeps
emitting output is unaffected; `iterationTimeoutMs` stays as the outer
wall-clock bound. The idle abort composes with the existing wall-clock watchdog
and descendant kill path — it does not duplicate or fight them, and exit code
`8` plus quota-fallback semantics are preserved.

## Decisions

- Idle bound is a distinct configurable span, defaulting off or to a value the
  finding supports; do not lower `iterationTimeoutMs`. Rules out shrinking the
  wall-clock bound and aborting legit long work.
- Reset the idle timer on agent stdout/stderr data, not on harness chatter.
  Rules out harness log lines masking a truly idle agent.
- Reuse the existing process-group SIGTERM→grace→SIGKILL kill path. Rules out a
  second kill mechanism racing the wall-clock watchdog or descendant reaping.

## Acceptance signals

- A test covers the idle/stall bound: an agent idle past the configured span is
  aborted before `iterationTimeoutMs`, while one emitting output is not.
- The test proves exit codes (`8`) and quota-fallback semantics are preserved.
- `bun run typecheck` and `bun test` pass.

## Documentation updates

- `v1/docs/run-loop.md`: the idle-output watchdog, its config knob, default, and
  telemetry.
- `v1/docs/quota-signals.md`: idle-abort classification relative to quota
  fallback, if it interacts.
- `v2/docs/v1-behaviors.md`: the new idle-stall bounding behavior.

## Out of scope

- Lowering or removing `iterationTimeoutMs`.
- Descendant reaping / orphan cleanup (separate intent).
- Rewriting agent CLIs' own subprocess management.

## Prerequisites
- Stalled iterations record last-output age and child-activity diagnostics.
- A written finding identifies the dominant stall cause and warrants a tighter idle bound.
