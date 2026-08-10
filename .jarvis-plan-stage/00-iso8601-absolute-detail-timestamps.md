# 00 - ISO 8601 UTC absolute detail timestamps

## Problem

`jarvis tui` right-pane detail paints absolute wall-clock fields as raw epoch milliseconds: pipeline `createdAt`/`finishedAtMs`/`terminalPublicationSucceededAt` (`v2/src/tui/tui-monitor-lines.ts:781-786`), stage `startedAt`/`endedAt` (`:813-814`), and run `createdAt`/`finishedAtMs` (`:831-832`). Raw epoch values do not correlate with UTC ISO 8601 logs, git output, or report filenames. Stage `decidedAt` is carried on the snapshot (`v2/src/daemon/pipeline-observation.ts:154`) but never painted in Stage detail at all.

## Decision ledger

- Absolute detail values render as UTC `YYYY-MM-DDTHH:MM:SSZ`, no fractional seconds, no locale or local-timezone formatting — rules out `toLocaleString`, local-offset ISO, and millisecond-bearing `toISOString()` output.
- The formatter lives in a new `v2/src/tui/tui-timestamp-format.ts`, not in `tui-elapsed-format.ts` — rules out mixing absolute-instant formatting into the duration module whose every export is relative.
- The formatter accepts `number | null | undefined` and returns the empty string for `null`/`undefined`, so the existing `isEmptyDetailValue` omission path drops the row unchanged — rules out a nullable-return contract that each call site re-handles.
- Epoch `0` formats as `1970-01-01T00:00:00Z`; only `null`/`undefined` are absent — rules out treating falsy `0` as missing (existing fixtures pin `createdAt: 0` rows as present).
- Detail wiring goes through one `absoluteDetailRows` seam in `tui-monitor-lines.ts` that maps entries through the formatter before delegating to `detailRows` — rules out per-call-site `formatAbsoluteTimestamp(...)` sprinkling that drifts as fields are added.
- Stage detail gains a `decidedAt` row through that same seam — rules out leaving the durable approval-decision instant unpainted while `startedAt`/`endedAt` render.
- `wallClock`, `elapsed`, `decided` age, `work`, and `idle` keep `formatElapsedWallClock`/`formatAggregateDuration` untouched — rules out applying the absolute formatter to durations.

## Task checklist

- [ ] Add `v2/src/tui/tui-timestamp-format.ts` exporting a pure `formatAbsoluteTimestamp(epochMs: number | null | undefined): string`, plus co-located `tui-timestamp-format.test.ts`.
- [ ] Add `absoluteDetailRows` in `tui-monitor-lines.ts` and route pipeline `createdAt`/`finishedAtMs`/`terminalPublicationSucceededAt`, stage `startedAt`/`endedAt`/`decidedAt`, and run `createdAt`/`finishedAtMs` through it.
- [ ] Update `tui-monitor-lines.test.ts` fixtures/pins that assert `createdAt: 0` to the ISO form and add pins for stage and terminal-publication timestamps.
- [ ] Update the two docs below.

## Mutation directives

Place inside the named pinning test bodies, one physical line each:

```text
// @mutate v2/src/tui/tui-monitor-lines.ts "formatAbsoluteTimestamp(value)" -> "value"
// @mutate v2/src/tui/tui-timestamp-format.ts "epochMs === null || epochMs === undefined" -> "false"
```

## Acceptance criteria

- [ ] `formatAbsoluteTimestamp` converts a fixed epoch-ms value to UTC `YYYY-MM-DDTHH:MM:SSZ` with no fractional seconds, formats `0` as `1970-01-01T00:00:00Z`, and returns the empty string for `null` and `undefined`; the new `tui-timestamp-format.test.ts` covering this fails against the pre-fix tree (the module does not exist) and passes after.
- [ ] Pipeline `createdAt`, `finishedAtMs`, and `terminalPublicationSucceededAt`, selected-stage `startedAt`, `endedAt`, and `decidedAt`, and selected-run `createdAt` and `finishedAtMs` paint ISO 8601 UTC values in `jarvis tui` detail; `tui-monitor-lines.test.ts` pins that output and fails against the current raw-epoch rendering.
- [ ] A `null` absolute timestamp paints no detail row at all — never `Invalid Date`, never a fabricated `1970-01-01T00:00:00Z` — pinned in `tui-timestamp-format.test.ts` and in a `tui-monitor-lines.test.ts` case with null stage boundaries.
- [ ] `tui-monitor-lines.test.ts` — `absent absolute timestamps paint no detail row`; Mutation checkpoint: inverting the absent-value guard turns the scoped suite red.
- [ ] `tui-monitor-lines.test.ts` — `pipeline detail renders absolute timestamps as ISO 8601 UTC`; Keystone checkpoint: reverting the detail seam to the raw value turns the scoped suite red.
- [ ] Existing `wallClock`, `elapsed`, `decided` age, `idle`, and `work` assertions in `tui-monitor-lines.test.ts`, `tui-elapsed-format.test.ts`, and `tui-attention-rows.test.ts` stay green with their relative output unchanged.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Observe — replace "Pipeline detail preserves raw `createdAt` and `finishedAtMs`" with the ISO 8601 UTC (trailing `Z`, whole seconds) rendering, note stage `decidedAt` now paints, and state that `wallClock`, elapsed, and work/idle stay relative.
- `v2/docs/v1-behaviors.md` § TUI / observability — record that absolute detail timestamps route through the shared formatter and paint ISO 8601 UTC, `null` values remain omitted, `0` renders as the Unix epoch, and durations remain relative.
