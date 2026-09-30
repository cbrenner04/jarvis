---
name: retiring-sole-daemon-self-heals-admission
---

# A retiring sole daemon reopens admission when it still owns the public listener

## Problem

After a failed self-handoff the incumbent can remain retiring with no pending handoff, no committed successor on the public address, and the public listener bound as the only owner — admission stays closed and nothing clears `retiring` until operator intervention.

## Decisions

- Export a pure predicate for the self-heal condition and evaluate it on each stable-digest sampling tick before the retiring skip would block handoff sampling, so a matching sole owner reopens admission without a process restart.
- Self-heal uses only in-process state (no probes): while this process holds the public listener and no handoff is pending, no successor can be serving the public address.
- Self-heal applies only to a handoff-origin retire (changeover, handoff fallback/rollback); a generation retiring after operator stop, a non-successor `supersede`, or a committed handoff keeps draining and exits via `shouldShutdownNow` unchanged.

## Acceptance criteria

- [x] Unit tests cover the exported self-heal predicate in both truth directions.
- [x] A regression proves a retiring incumbent matching the predicate reopens admission and admits a subsequent start; it fails against the pre-fix code.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — retiring sole-owner self-heal reopens admission.
- `v2/docs/operator-runbook.md` — expected self-recovery from stranded `daemon_superseded` without operator `daemon start` when self-heal applies.
- `v2/docs/v1-behaviors.md` — `[v2-only]` autonomous self-handoff / handoff bullets: sole-owner self-heal on the stable-digest sampling tick.

## Prerequisites

- Rollback on a pending handoff clears handoff-origin `supersede` and reopens admission when the public rebind succeeds.
