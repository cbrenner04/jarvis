---
name: cleanup-reaps-dead-daemon-companions
---

# Cleanup reaps every dead daemon digest artifact

## Prerequisites

## Module-boundary surface

- Daemon: keyed daemon artifact classification and liveness in `v2/src/commands/daemon.ts` and `v2/src/paths.ts`.

## Problem

Cleanup removes a dead digest's socket but leaves its paired PID and process log, so dead daemon generations accumulate under `JARVIS_HOME`.

## Behavior

- Cleanup treats each keyed daemon digest as one lifecycle unit: a dead socket makes its matching `.sock`, `.pid`, and `.log` removable, while a live or ambiguously probed socket preserves the whole triplet.
- Normal and `--dry-run` output report the dead daemon artifacts selected for removal without changing the existing fail-safe liveness classification.

## Decision ledger

- Reap the matching `.pid` and `.log` with each provably dead `.sock`; rules out socket-only cleanup that leaves one pair per dead digest.
- Preserve every companion when the socket probe is live, times out, or fails ambiguously; rules out inferring daemon death from stale-looking PID or log metadata.
- Remove all companions for a provably dead digest; rules out an unconfigured most-recent-N log exception whose ordering and retention contract have no current caller.

## Acceptance criteria

- [ ] `v2/src/commands/daemon.test.ts` or `v2/src/commands/cleanup.test.ts` test `dead daemon digest reaps socket pid and log` proves apply removes the triplet and `--dry-run` reports it without mutation; it fails against the pre-fix socket-only reaper.
- [ ] The same regression fixture proves a live daemon's triplet and an ambiguously probed daemon's triplet are preserved.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — dead daemon digest artifact preview, reaping, and fail-safe preservation.
- `v2/docs/v1-behaviors.md` — record v2 cleanup's keyed daemon triplet lifecycle.

## Primary implementation surface

v2/src/commands/daemon.ts
