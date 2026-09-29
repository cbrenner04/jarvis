---
name: configure-session-log-retention-tiers
---

# Configure hot and cold session-log retention

## Problem

Machine config exposes one deletion window as `cleanup.sessionLogRetentionDays`; tiered retention needs separate hot and cold boundaries.

## Behavior

The machine-wide `~/.jarvis/config.json` accepts one global `retention.sessions` block with positive-integer `hotDays` and `coldDays`; committed loader defaults are `14` and `90` when the block is absent, and `coldDays` must exceed `hotDays`. `cleanup.sessionLogRetentionDays` is removed rather than treated as a second source of truth, and the existing single-window reaper reads `coldDays` as its deletion window so removal lands without behavior drift. Invalid retention config returns a validation failure naming the new keys.

## Primary implementation surface

- Machine-config loading and validation.

## Acceptance criteria

- [ ] Config tests fail against the current single-window loader and pin the `hotDays: 14`, `coldDays: 90` defaults, overrides, ordering constraint, invalid-value behavior, and removal of `cleanup.sessionLogRetentionDays`.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/install-and-config.md` — replace `cleanup.sessionLogRetentionDays` with the `retention.sessions` block and its validation contract.
- `v2/docs/v1-behaviors.md` — record the changed retention config contract.

## Prerequisites
