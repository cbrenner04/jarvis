---
name: configure-session-log-retention-tiers
---

# Configure hot and cold session-log retention

Superseded for implementation detail by [00-retention-sessions-config.md](./00-retention-sessions-config.md); this file records the original intent scope.

## Problem

Machine config exposes one deletion window as `cleanup.sessionLogRetentionDays`; tiered retention needs separate hot and cold boundaries.

## Behavior

The machine-wide `~/.jarvis/config.json` accepts one global `retention.sessions` block with positive-integer `hotDays` and `coldDays`; committed loader defaults are `14` and `90` when the block is absent, and `coldDays` must exceed `hotDays`. `cleanup.sessionLogRetentionDays` is removed rather than treated as a second source of truth. The session-log reaper reads `retention.sessions.coldDays`, so an override-free config widens the default deletion window from `14` to `90` days (more retention on disk until an operator sets an explicit value). Invalid retention config returns a validation failure with the exact messages in the subspec; invalid values refuse session-log reaping only.

## Primary implementation surface

- Machine-config loading and validation.

## Acceptance criteria

- [x] Config and cleanup tests pin the `hotDays: 14`, `coldDays: 90` defaults, overrides, ordering constraint, invalid-value behavior, legacy-key ignore, preserved top-level throw path, and removal of `cleanup.sessionLogRetentionDays` (see subspec).
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/install-and-config.md` — replace `cleanup.sessionLogRetentionDays` with the `retention.sessions` block, defaults, widen note, and validation messages.
- `v2/docs/v1-behaviors.md` — record the changed retention config contract.
- `v2/docs/operator-runbook.md` § Cleanup — retention window and invalid-config paragraphs.
- `v2/docs/telemetry-capture.md` — `inbound_stderr` backstop bound references `retention.sessions.coldDays`.

## Prerequisites
