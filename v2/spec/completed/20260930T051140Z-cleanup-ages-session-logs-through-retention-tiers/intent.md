---
name: cleanup-ages-session-logs-through-retention-tiers
---

# Age session logs through hot, cold, and gone

## Problem

Cleanup jumps directly from plain session logs to deletion, and its scanner understands only the flat layout.

## Behavior

`jarvis cleanup` scans month-sharded session logs, keeps hot logs plain, gzips terminal-run and eligible orphan logs after `hotDays`, and deletes their cold `.log.gz` form after `coldDays`. Terminal logs age by their owning run's durable `finishedAt`; eligible orphans age by mtime. Non-terminal runs remain untouched at every age. Existing orphan classification remains intact, and pre-shard flat logs remain cleanup-eligible while the old layout drains. `--dry-run` reports per-tier counts and the plain source bytes moving hot-to-cold and stored gzip-file bytes moving cold-to-gone, without changing files.

## Primary implementation surface

- Cleanup discovery, preview, and application.

## Acceptance criteria

- [ ] Cleanup tests with an injected clock, state store, and `JARVIS_HOME` fail against the single-window reaper and pin `finishedAt` terminal aging, mtime orphan aging, hot preservation, cold gzip, gone deletion, non-terminal preservation, legacy-flat draining, and rerun idempotence.
- [ ] A dry-run test fails against the aggregate expired-log summary and pins per-tier counts, plain source bytes for hot-to-cold, gzip-file bytes for cold-to-gone, and no filesystem mutation.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — hot/cold/gone behavior, shard layout, dry-run output, and `.log.gz` reading.
- `v2/docs/v1-behaviors.md` — replace the single-window reaper contract with tiered retention.

## Prerequisites

- Machine-wide `~/.jarvis/config.json` exposes validated global `retention.sessions.hotDays` and `retention.sessions.coldDays` settings with committed `14`- and `90`-day defaults, and no longer accepts `cleanup.sessionLogRetentionDays`.
- New session logs open under the UTC `sessions/<YYYY-MM>/` shard selected from their opening time while preserving the existing basename and best-effort writer contract.
