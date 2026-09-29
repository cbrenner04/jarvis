---
name: cleanup-ages-session-logs-through-retention-tiers
---

# Age session logs through hot, cold, and gone

## Problem

Cleanup jumps directly from plain session logs to deletion, and its scanner understands only the flat layout.

## Behavior

`jarvis cleanup` scans month-sharded session logs, keeps hot logs plain, gzips terminal-run and eligible orphan logs after `hotDays`, and deletes their cold `.log.gz` form after `coldDays`. Non-terminal runs remain untouched at every age. Existing orphan classification remains intact, and pre-shard flat logs remain cleanup-eligible while the old layout drains. `--dry-run` reports counts and bytes separately for logs moving hot-to-cold and cold-to-gone, without changing files.

## Primary implementation surface

- Cleanup discovery, preview, and application.

## Acceptance criteria

- [ ] Cleanup tests with an injected clock, state store, and `JARVIS_HOME` fail against the single-window reaper and pin hot preservation, cold gzip, gone deletion, non-terminal preservation, orphan handling, legacy-flat draining, and rerun idempotence.
- [ ] A dry-run test fails against the aggregate expired-log summary and pins per-tier counts and bytes with no filesystem mutation.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — hot/cold/gone behavior, shard layout, dry-run output, and `.log.gz` reading.
- `v2/docs/v1-behaviors.md` — replace the single-window reaper contract with tiered retention.

## Prerequisites

- Machine config exposes validated global `retention.sessions.hotDays` and `retention.sessions.coldDays` settings with committed defaults, and no longer accepts `cleanup.sessionLogRetentionDays`.
- New session logs open under the UTC `sessions/<YYYY-MM>/` shard selected from their opening time while preserving the existing basename and best-effort writer contract.
