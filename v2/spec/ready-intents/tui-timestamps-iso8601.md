---
name: tui-timestamps-iso8601
---

# Render TUI absolute timestamps in ISO 8601 UTC

## Surface

- TUI detail presentation and timestamp formatting form one module-boundary surface; splitting does not apply because the formatter has no independent consumer behavior.

## Problem

TUI detail rows expose absolute wall-clock values as raw epoch milliseconds, making them harder to correlate with UTC ISO 8601 logs, git output, and report filenames.

## Decision ledger

- Render every scalar absolute wall-clock detail field in UTC as `YYYY-MM-DDTHH:MM:SSZ`, including pipeline/run `createdAt` and `finishedAtMs`, stage `startedAt` and `endedAt`, approval `decidedAt`, and pipeline `terminalPublicationSucceededAt`. Rules out raw epoch, locale-dependent, timezone-shifted, or fractional-second output.
- Route every absolute timestamp detail field through one pure epoch-ms formatter. Rules out call-site formatting drift.
- Treat epoch `0` as present and format it as the Unix epoch; omit only `null` or absent timestamps. Rules out coercing missing values to epoch `0` or `Invalid Date`.
- Keep elapsed, decided-age, idle-age, work-age, and other duration formatting relative and unchanged. Rules out applying the absolute formatter to durations.
- Paint approval `decidedAt` in selected stage detail through the shared formatter. Rules out leaving the durable decision instant hidden while other stage timestamps render.

## Acceptance criteria

- [ ] A pure helper converts a fixed epoch-ms value to UTC `YYYY-MM-DDTHH:MM:SSZ` without fractional seconds, formats epoch `0`, and returns an omitted detail value for `null`; a co-located regression fails against raw or locale-dependent formatting.
- [ ] Pipeline, selected stage, selected run, approval-decision, and terminal-publication absolute detail values render through the helper; `tui-monitor-lines.test.ts` pins ISO 8601 UTC output that fails against the current raw epoch rendering.
- [ ] A null absolute timestamp paints no row and never paints `Invalid Date` or a fabricated Unix epoch.
- [ ] Existing elapsed, decided-age, idle-age, and work-age regressions remain green with their relative output unchanged.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Observe — absolute TUI detail timestamps use ISO 8601 UTC with trailing `Z`; elapsed and age values remain relative.
- `v2/docs/v1-behaviors.md` § TUI / observability — absolute timestamp fields route through the shared formatter, null values remain omitted, and durations remain relative.

## Prerequisites
