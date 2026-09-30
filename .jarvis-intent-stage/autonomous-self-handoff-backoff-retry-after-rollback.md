---
name: autonomous-self-handoff-backoff-retry-after-rollback
---

# Autonomous self-handoff backoff retry runs after a failed handoff rolls back

## Problem

`startStableDigestTrigger` schedules doubled backoff after a rolled-back self-handoff, but the daemon sampling interval skips every tick while `isRetiring()`, so the retry never fires and no path clears the stranded retiring state from the trigger side.

## Decisions

- After rollback (and when self-heal applies), sampling ticks past the backoff window invoke `startHandoff` again on the same digest cadence as today.
- Do not permanently stop the sampling interval on a failed self-handoff; only real teardown stops it.

## Acceptance criteria

- [ ] A `startStableDigestTrigger` regression with a fake clock and scheduler asserts that after a failed handoff and rollback, the next sampling tick past the backoff window calls `startHandoff` again; it fails against the pre-fix code.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — autonomous self-handoff backoff retry is reachable after rollback restores admission or self-heal.

## Prerequisites

- Rollback on a pending handoff clears handoff-origin `supersede` and reopens admission when the public rebind succeeds.
- A retiring sole daemon that still owns the public listener with no pending handoff and no live public successor can self-heal admission open.
