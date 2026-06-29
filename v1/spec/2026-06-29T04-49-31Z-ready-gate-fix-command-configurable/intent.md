---
name: ready-gate-fix-command-configurable
---

# Ready-gate: configurable optional autofix

## Problem

Full-tier ready gate hardcodes `bun run fix`. Repos without a `fix` script (or non-bun package managers) fail immediately (`Script not found "fix"`). Only `readyCommand` is configurable today.

## Direction

Add a per-project autofix override parallel to `readyCommand`. When unset, keep `bun run fix`. When the resolved autofix command's script is absent, skip autofix instead of failing the gate.

## Decisions

- `fixCommand` is per-project config (same resolution surface as `readyCommand`) — rules out hardcoded `bun run fix` only.
- Absent configured/default autofix script is a no-op, not a gate failure — rules out exit on repos with no `fix` script.
- `fixCommand` replaces harness autofix only; `readyCommand` stays verification-only — rules out folding verification into `fixCommand`.
- Unset `fixCommand` preserves current default (`bun run fix`) for repos that already pass — rules out behavior churn on the jarvis repo path.
- All `full`-tier gate sites that run harness autofix today honor `fixCommand` — rules out completion-only wiring.
- `fast` tier still skips autofix and pre-ready commit — rules out tier behavior drift.

Deferred to first consumer: exact config key path if not `projects.<key>.fixCommand` — pin when `loadConfig` schema is drafted.

## Documentation updates

- `v2/docs/v1-behaviors.md` — autofix override, absent-script no-op, and updated gate ordering.
- `v1/docs/operator-runbook.md` — configurable autofix in The gate section.

## Prerequisites
