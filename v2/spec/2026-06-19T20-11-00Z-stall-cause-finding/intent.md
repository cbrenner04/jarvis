---
name: stall-cause-finding
---
# Written finding identifies the dominant iteration-stall cause

**Scope.** Investigation deliverable — analysis of stalled-iteration
telemetry/logs; written finding committed to the spec tree. Lives in
`v2/spec/wip-intents/` for routing.

## Problem

Iterations repeatedly burn the full 30-min `iterationTimeoutMs` before the
watchdog aborts them (telemetry for one spec recorded `iter=1 timeout` three
times; a run sat ~2.5h on one idle agent). The dominant cause is unconfirmed:
agent waiting on a hung subprocess it spawned (e.g. a `bun test`) vs. the agent
genuinely thinking. Remediation scope can't be chosen until this is settled with
evidence.

## Desired behavior

A written finding, committed in the spec tree, names the dominant stall cause
backed by concrete evidence (last-output age, child activity, telemetry rows,
log excerpts) from real stalled iterations. The finding states whether a tighter
idle bound is warranted and, if so, sketches the bound — so a remediation
decision is grounded, not guessed.

## Decisions

- The deliverable is the written finding itself; this slice ships no harness code
  change. Rules out folding investigation into a remediation PR that presumes the
  cause.
- Finding must cite per-iteration evidence, not aggregate impressions. Rules out
  an unfalsifiable "agents are slow" conclusion.

## Acceptance signals

- A finding in the spec names the dominant stall cause with cited evidence from
  telemetry/logs.
- The finding records an explicit warranted/not-warranted verdict on a tighter
  idle bound.

## Documentation updates

- Finding lives in the spec tree (per documentation-standard.md: work intent /
  evidence for a specific change). No durable `v1/docs` change in this slice.

## Out of scope

- Implementing any abort bound or watchdog change.
- Changing telemetry shape (consumes existing/instrumented signal, adds none).

## Prerequisites
- Stalled iterations record last-output age and child-activity diagnostics.
