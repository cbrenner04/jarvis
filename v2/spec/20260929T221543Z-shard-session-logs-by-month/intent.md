---
name: shard-session-logs-by-month
---

# Open new session logs in month shards

## Problem

The session-log writer places every transcript directly under `~/.jarvis/sessions/`, leaving thousands of files in one directory and forcing cleanup to operate on a flat store.

## Behavior

New session logs open under `sessions/<YYYY-MM>/`, using the log's injected opening time to choose the UTC month while preserving the existing basename and best-effort no-op failure contract.

## Primary implementation surface

- Shared session-log persistence.

## Acceptance criteria

- [ ] Session-log tests with an injected clock and `JARVIS_HOME` fail against the flat writer and pin the UTC month shard, unchanged basename, append behavior, and failure degradation.
- [ ] `bun run typecheck`, `bun run test:v2`, `bun run test:integration:v2`, `bun run test:shared`, and `bun run test:integration:shared` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — session-log shard layout and lookup recipes.
- `v2/docs/telemetry-capture.md` — update the session-log join path without duplicating retention semantics.
- `v2/docs/v1-behaviors.md` — record the changed session-log layout.

## Prerequisites
