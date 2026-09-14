# 01 — Startup reconciliation during handoff preserves live predecessor rows

## Problem

`startDaemonRuntime` runs `reconcileOrphanedRuns` before handoff wiring; it must keep reconciling genuine orphans during handoff while never reconciling rows whose durable owner is the live predecessor.

## Decisions

- Reconciliation always runs during handoff; orphanhood is decided from durable `owner_identity` plus process liveness — rules out skipping reconciliation when a predecessor is present, and rules out treating mere peer presence as proof of ownership.
- If current code already satisfies this, the subspec lands the pinning regression and docs only.

## Acceptance criteria

- [ ] A startup regression boots a successor with a live predecessor and proves a genuinely orphaned row (dead owner) is reconciled while a row owned by the live predecessor is left untouched; it fails against a successor that skips reconciliation or reconciles by peer presence.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — startup reconciliation during handoff.
- `v2/docs/v1-behaviors.md` — handoff startup keeps live predecessor-owned runs.
