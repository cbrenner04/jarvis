---
name: route-draining-run-wait-and-kill-to-owner
---

# Route draining run wait and kill to the owner

## Prerequisites

- Daemon upgrades hand off one stable public address: the incoming generation admits new work, the outgoing generation admits nothing new, finishes its owned work, and exits when idle.
- The stable daemon merges its direct predecessor's authoritative live run rows into `run list`, with one row per run and the live owner's row winning.

## Module-boundary surface

- Unary run wait and live-control handlers over the internal handoff channel.

## Problem

The serving generation handles `wait`, `kill`, and other live controls only against its local run context. A predecessor-owned live run therefore settles locally as terminal/not-active or cannot be controlled even though `run list` exposes its owner.

## Behavior

- The stable daemon routes `run wait`, `run kill`, and owner-sensitive live controls for a draining run to its direct owner without exposing daemon generations to the caller.

## Decisions

- Resolve ownership from the stable daemon's authoritative live-run directory and execute current-generation requests locally.
- Forward only to the direct predecessor; do not enumerate sockets or permit hop-by-hop forwarding.
- `wait` returns the owner's eventual settlement, and `kill` aborts and settles the owner's invocation rather than applying successor-local terminal/not-active logic.
- Preserve single-daemon request paths and existing result, error, and exit-code contracts.
- A failed owner call never reports a successful wait or kill; route-loss recovery is completed by the later admission/reconciliation surface.

## Acceptance criteria

- [ ] A transport regression proves `run wait` reaches a direct predecessor-owned live run through the stable address and returns its eventual settlement; it fails against the pre-fix successor-local result.
- [ ] A transport regression proves `run kill` through the stable address aborts and settles the predecessor owner's live invocation; it fails against the pre-fix `run_not_active` refusal.
- [ ] Tests prove owner-sensitive live controls use the same direct owner route without client-visible generation data or forwarding chains.
- [ ] Single-daemon wait/control regressions stay green without an internal routing RPC.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — direct-owner waits and live controls over the handoff channel.
- `v2/docs/v2-architecture.md` — stable-front-door unary run routing boundary.
- `v2/docs/v1-behaviors.md` — draining runs remain waitable and killable through the stable daemon.
