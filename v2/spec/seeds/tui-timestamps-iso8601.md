---
name: tui-timestamps-iso8601
---

# TUI absolute timestamps render in ISO 8601 UTC

## Problem

The TUI's absolute timestamp fields (pipeline/stage/run `createdAt`, `startedAt`, `endedAt`, `finishedAtMs`, approval `decidedAt`) render in a locale/epoch-ish form that is ambiguous to read and hard to correlate with logs, git, and `reports/` filenames (which are already UTC ISO 8601). The operator wants absolute times shown in ISO 8601 UTC (e.g. `2026-08-10T02:57:51Z`) so a timestamp in the detail pane matches the same instant everywhere else.

## Decisions

- Render every absolute wall-clock timestamp the TUI shows in ISO 8601 UTC with a trailing `Z`, from the durable epoch-ms value — rules out locale-dependent or timezone-shifted rendering.
- Scope to *absolute* timestamps only; elapsed / work-idle / age durations keep their existing relative format — rules out reformatting duration displays.
- Centralize the epoch-ms → ISO 8601 UTC conversion in one pure helper so every timestamp field routes through it — rules out per-call-site date formatting that drifts.
- A null/absent timestamp still renders nothing (no `Invalid Date`, no epoch 0) — rules out fabricating a value for missing times.

## Acceptance criteria

- [ ] A pure helper converts a non-null epoch-ms to `YYYY-MM-DDTHH:MM:SSZ` (UTC, trailing `Z`) and returns null/empty for a null input; a new regression pins both, including a fixed known epoch, and fails against the pre-fix formatter.
- [ ] Every detail-pane absolute-timestamp field (`createdAt`, `startedAt`, `endedAt`, `finishedAtMs`, `decidedAt`) renders through the helper; a `tui-monitor-lines.test.ts` regression asserts one such field paints ISO 8601 UTC and fails against the pre-fix rendering.
- [ ] A null timestamp field paints no value (not `Invalid Date` / not epoch 0); a regression pins the null case.
- [ ] Elapsed / age / work-idle duration displays are unchanged; the existing duration tests stay green.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Observe — record that the TUI renders absolute timestamps in ISO 8601 UTC (trailing `Z`) while durations stay relative.
- `v2/docs/v1-behaviors.md` § TUI / observability — absolute timestamp fields render ISO 8601 UTC through the shared helper.
