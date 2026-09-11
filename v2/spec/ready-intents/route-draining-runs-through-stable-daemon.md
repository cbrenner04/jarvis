---
name: route-draining-runs-through-stable-daemon
---

# Route draining runs through the stable daemon

## Prerequisites

- Daemon upgrades hand off one stable public address: the incoming generation admits new work, the outgoing generation admits nothing new, finishes its owned work, and exits when idle.

## Module-boundary surface

- Daemon run ownership and request routing: run-control handlers, list/wait/log streaming, live controls, and the internal generation handoff channel.

## Problem

Run liveness and control are answered only from the daemon process receiving the request. A run still executing in a superseded process therefore renders `not-live`, cannot be waited on or tailed, and rejects kill or recovery from the reachable generation.

## Behavior

- The stable-address daemon presents draining-generation runs as live and routes each run observation or control request to the generation that owns it without exposing generations to the caller.

## Decision ledger

- Route by authoritative live run ownership, not by source version, socket enumeration, durable row visibility, or process liveness alone.
- Merge current- and draining-generation run rows behind the stable daemon with one row per run and the live owner's row winning; rules out client-side aggregation and `in-progress` plus `not-live` for executing work.
- Route `run log`, `run wait`, `run kill`, and other live controls to the owner over the internal handoff channel; rules out successor-local `terminal_run` or `run_not_active` refusals for a draining live run.
- Keep new `start` and eligible `resume` admission on the incoming generation while an active draining run remains pinned to its outgoing owner; rules out two generations driving one invocation.
- Treat a lost draining-generation channel as an ownership-loss recovery condition rather than silently claiming the run live; preserve existing reconciliation safety for genuinely dead owners.

## Acceptance criteria

- [ ] A daemon routing test proves a run owned by a draining generation appears once with `isLive: true` through the stable address; it fails against the pre-fix per-daemon `activeRuns` projection.
- [ ] A transport test proves `run log` replays and follows the draining owner's log through the stable address.
- [ ] Tests prove `run wait` reaches the draining owner and returns its eventual settlement, and `run kill` aborts that owner's live invocation through the stable address; they fail against the pre-fix successor-local refusals.
- [ ] A test proves a draining active run is never resumed or force-claimed by the incoming generation while its owner remains reachable.
- [ ] A failure-path test proves loss of the internal owner route yields honest reconciliation/recovery behavior without reporting the run live.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — ownership directory, merged run observation, routed streams/waits/controls, and route-loss behavior.
- `v2/docs/v2-architecture.md` — stable-front-door run routing boundary.
- `v2/docs/v1-behaviors.md` — record that draining runs remain live and controllable through the stable daemon.
