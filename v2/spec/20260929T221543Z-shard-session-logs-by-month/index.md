# Open new session logs in month shards

New session logs open under `sessions/<YYYY-MM>/`, chosen from the log's injected opening time in UTC, preserving the existing `<namespace>-<timestamp>.log` basename and the best-effort no-op failure contract.

## Subspecs

- [ ] [00-month-shard-session-log-writer.md](./00-month-shard-session-log-writer.md)

## Out of scope

- The cleanup session-log reaper only considers regular `.log` files **directly** under the sessions directory, so from this change forward it becomes a total no-op for every newly-opened log, not just some — a separate reaper-surface intent must teach it to descend one month level before retention resumes. This is an accepted regression, corrected (not just noted) in `operator-runbook.md`, `telemetry-capture.md`, `install-and-config.md`, and `v1-behaviors.md` so operators don't act on a stale retention claim. The reaper itself is a different module-boundary surface and is not changed here.
- Migration or relocation of existing flat logs. Readers must tolerate both layouts.
- `scripts/real-home-guard.ts`'s session-snapshot depth is in scope (see subspec Decisions) — it is a reader whose sensitivity this change directly degrades, not a deferred surface.
