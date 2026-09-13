---
name: route-draining-run-logs-to-owner
---

# Route draining run logs to the owner

## Prerequisites

- Daemon upgrades hand off one stable public address: the incoming generation admits new work, the outgoing generation admits nothing new, finishes its owned work, and exits when idle.
- The stable daemon merges its direct predecessor's authoritative live run rows into `run list`, with one row per run and the live owner's row winning.
- The stable daemon routes waits and owner-sensitive live controls for a draining run to its direct owner over the internal handoff channel.

## Module-boundary surface

- Run-log replay/follow stream bridging over the internal handoff channel.

## Problem

The stable daemon opens `run log` against its own log reader. A draining run's authoritative replay and follow stream remains on the predecessor, so the stable address can return incomplete history or fail to follow live output.

## Behavior

- The stable daemon replays and follows a draining run's log from its direct owner, preserving one caller-visible stream across the internal owner route.

## Decisions

- Select the stream source from the authoritative live-run directory and keep current-generation streams local.
- Proxy replay and follow frames in order, including normal end, caller cancellation, and owner disconnect, without exposing the private endpoint.
- Route only live predecessor-owned runs; terminal and historical log lookup keeps existing stable-daemon behavior.
- Preserve the single-daemon stream path without an ownership RPC.

## Acceptance criteria

- [ ] A transport regression proves `run log` replays a direct predecessor owner's records in order through the stable address; it fails against the pre-fix successor-local reader.
- [ ] A transport regression proves `run log --follow` forwards new owner records and closes when the owner stream ends.
- [ ] Tests prove caller cancellation and owner disconnect close both sides without a leaked follow stream or a false successful end.
- [ ] Single-daemon replay/follow regressions stay green without an internal routing RPC.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — direct-owner log replay/follow bridging and stream loss behavior.
- `v2/docs/v2-architecture.md` — stable-front-door run-stream routing boundary.
- `v2/docs/v1-behaviors.md` — draining-run logs remain replayable and followable through the stable daemon.
