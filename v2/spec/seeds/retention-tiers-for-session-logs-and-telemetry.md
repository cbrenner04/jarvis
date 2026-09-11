---
name: retention-tiers-for-session-logs-and-telemetry
---

# Session logs age through hot, cold, gone; telemetry rolls monthly and is kept

Depends on [[observability-sinks-honor-jarvis-home-and-cap-blobs]]: size this against post-fix steady state, not the leaked numbers.

## Problem

Retention is one window for one artifact: session logs older than `cleanup.sessionLogRetentionDays` are deleted, `telemetry.jsonl` grows without bound, and there is no middle state. The operator wants data later (prompt and debate analysis, cost trends) but not 9 GB of raw transcripts. Facts and blobs need different lifetimes: telemetry rows are small join-keyed facts (run, attempt, role, agent, model, tokens, cost, duration, exit) and should be kept; session logs are the bulky transcript and should expire, with a compressed middle tier so the option to mine them stays open for a while.

`~/.jarvis/sessions/` is one flat directory. Even at steady state a month of logs is thousands of files, and tier moves are per-file operations rather than a rename.

## Decisions

- Session logs live under `sessions/<YYYY-MM>/`. Tiers: hot (plain, `< hotDays`), cold (gzipped in place, `hotDays..coldDays`), gone (`> coldDays`). Defaults on the order of 14 and 90 days; final numbers belong in config, not prompts or docs prose.
- Telemetry rolls: the current month at `telemetry.jsonl`, closed months at `telemetry/<YYYY-MM>.jsonl` (gzipped once closed). Never deleted by cleanup.
- One `retention` block in `~/.jarvis/config.json` replaces `cleanup.sessionLogRetentionDays`: `{ sessions: { hotDays, coldDays } }`. Telemetry roll has no knob.
- `jarvis cleanup` applies tiers as one slice, previewing counts and bytes per tier in `--dry-run`. Operator-facing readers (runbook grep recipes) accept `.log.gz`.
- Any richer store (SQLite cost tables, per-run rollups) remains a separate additive consumer of the telemetry files; this seed only makes the files durable and bounded.

## Acceptance criteria

- [ ] New session logs open under the month shard; cleanup gzips hot logs past `hotDays`, deletes cold logs past `coldDays`, and leaves logs of non-terminal runs alone; pinned by tests with an injected clock and `JARVIS_HOME`.
- [ ] Telemetry appends go to the current-month file; a month boundary closes the prior file under `telemetry/`; pinned by tests.
- [ ] `--dry-run` reports per-tier counts and bytes; pinned by a test.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/install-and-config.md` — `retention` block, removal of `cleanup.sessionLogRetentionDays`.
- `v2/docs/operator-runbook.md` § Session-log retention and § Reading telemetry — tiers, shard layout, `.gz` reading.
- `v2/docs/telemetry-capture.md` — monthly roll.
- `v2/docs/v1-behaviors.md` — record the retention change.
