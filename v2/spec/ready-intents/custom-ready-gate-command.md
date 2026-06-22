---
name: custom-ready-gate-command
---

# Per-project alternate command for the completion ready gate

## Problem

The patch completion ready gate hardcodes `bun run ready`. Repos whose verification command
differs (or whose script isn't named `ready`) fail the gate every iteration, driving the agent into
fix-up flailing it cannot resolve. There is no way to point the gate at a repo's real command.

## Direction

Let a repo configure an alternate completion-gate command, bound to the existing config. When set,
every ready-gate call site (completion transition, pre-shrink, review baseline/final, `maybeMarkReady`)
runs the configured command in place of `bun run ready`; the `check:fix`/commit/push and tier
selection behavior around it is unchanged. Repos that set nothing keep `bun run ready` exactly.
Opt-in, default-off. Validate the new config.

For plan to decide: config location (per-project, global patch default, or both) and precedence;
validation rules; how (or whether) the `JARVIS_READY_TIER` tier signal reaches a custom command.

## Out of scope

- Skipping the gate entirely (separate behavior).
- Plan-mode gate behavior.
- Changing `bun run ready` for repos that set no override.

## References

- `v1/src/ready-gate.ts` — `runReadyAndCommit` (hardcoded `bun run ready`), `runReadyGateWithTier`.
- `v1/src/modes/patch/*` — gate call sites.
- `v1/src/config.ts` — per-project / mode config + validation.

## Prerequisites
