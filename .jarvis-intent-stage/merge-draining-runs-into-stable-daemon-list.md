---
name: merge-draining-runs-into-stable-daemon-list
---

# Merge draining runs into the stable daemon list

## Prerequisites

- Daemon upgrades hand off one stable public address: the incoming generation admits new work, the outgoing generation admits nothing new, finishes its owned work, and exits when idle.

## Module-boundary surface

- Predecessor drain observation and daemon `list` projection.

## Problem

The serving generation derives run rows from its own store and `activeRuns`, while predecessor drain observation carries only an advisory live-id set. That does not establish an authoritative owner route or merge the draining owner's row into the stable view.

## Behavior

- The stable daemon returns one row per current or direct-predecessor run, with a draining live owner's row winning and `isLive: true` only while that owner reports the run live.

## Decisions

- Build the ownership directory only from the direct outgoing generation's live rows; do not enumerate versions, retain terminal ownership, or forward through predecessor chains.
- Merge behind the stable daemon, not in clients, and deduplicate by run id with the live owner's row winning.
- Preserve the single-daemon fast path: no routing readiness gate, predecessor RPC, or per-row log read when no predecessor is draining; apply retention before per-row projection.
- Routing setup failure falls back to the daemon's existing local list behavior and never refuses unrelated verbs.

## Acceptance criteria

- [ ] A daemon routing regression proves a direct predecessor's live run appears once through the stable address with the owner's row and `isLive: true`; it fails against the pre-fix per-daemon projection.
- [ ] Tests prove terminal predecessor rows are not retained as routed owners and a drained predecessor does not keep its successor alive.
- [ ] A single-daemon regression proves `list` performs no predecessor RPC or extra per-row log reads and preserves retention order and output.
- [ ] A setup-failure regression proves `list` falls back to local behavior without a routing-wide refusal.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — direct-predecessor ownership directory, merged list rules, fallback, and single-daemon fast path.
- `v2/docs/v2-architecture.md` — stable-front-door run observation boundary.
- `v2/docs/v1-behaviors.md` — draining runs remain live through the stable daemon's merged view.
