---
name: cleanup-reaps-orphan-session-logs
---

# Cleanup reaps orphan session logs by mtime, streamed

The session-log reaper (`cleanup.sessionLogRetentionDays`, default 14) needs a terminal run row with `finishedAt`; logs with no run row (purged store, fixtures, v1-era `project:spec` names) live forever, and scanning a huge directory stalls every `jarvis cleanup`.

## Decisions

- When the name does not parse or the run row is gone, fall back to file mtime against the same retention window; a live run row still protects its logs.
- Reap streamed (directory iterator), not `readdirSync`-then-filter.
- No hand purge of already-leaked fixtures; the fallback reaps them once aged.

## Acceptance criteria

- [ ] Cleanup reaps an orphan session log older than the window and keeps one younger than it or owned by a non-terminal run; pinned by tests.
- [ ] `bun run typecheck`, `bun run test:v2`, `bun run test:shared`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Session-log retention — orphan fallback rule.
- `v2/docs/v1-behaviors.md` — record the reaper fallback.

## Prerequisites

- Requires `session-logs-honor-jarvis-home` merged: session logs default to `join(jarvisHome(), "sessions")`, so tests exercising session-log content stay isolated from the real home.
- Requires `telemetry-caps-exit-reason-blobs` merged: telemetry rows cap `exit_reason` and `warnings` with the full text retained in the session log.
