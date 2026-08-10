# 00 - ISO 8601 UTC absolute detail timestamps

## Problem

`jarvis tui` right-pane detail paints absolute wall-clock fields as raw epoch milliseconds: pipeline `createdAt`/`finishedAtMs`/`terminalPublicationSucceededAt` (`v2/src/tui/tui-monitor-lines.ts:781-786`), stage `startedAt`/`endedAt` (`:813-814`), and run `createdAt`/`finishedAtMs` (`:831-832`). Raw epoch values do not correlate with UTC ISO 8601 logs, git output, or report filenames. Stage `decidedAt` is carried on the snapshot (`v2/src/daemon/pipeline-observation.ts:154`) but never painted in Stage detail at all.

## Decision ledger

- Absolute detail values render as UTC `YYYY-MM-DDTHH:MM:SSZ`, no fractional seconds, no locale or local-timezone formatting — rules out `toLocaleString`, local-offset ISO, and millisecond-bearing `toISOString()` output.
- The formatter lives in a new `v2/src/tui/tui-timestamp-format.ts`, not in `tui-elapsed-format.ts` — rules out mixing absolute-instant formatting into the duration module whose every export is relative.
- The formatter accepts `number | null | undefined` and returns the empty string for `null`/`undefined`, so the existing `isEmptyDetailValue` omission path drops the row unchanged — rules out a nullable-return contract that each call site re-handles.
- Epoch `0` formats as `1970-01-01T00:00:00Z`; only `null`/`undefined` are absent — rules out treating falsy `0` as missing (existing fixtures pin `createdAt: 0` rows as present).
- Non-finite or out-of-range epoch values (`NaN`, `Infinity`, or a value `Date` cannot represent) format as the literal string `"invalid"` rather than propagating a `RangeError` from an unguarded `toISOString()` call — rules out a crash in the right-pane paint when unvalidated snapshot data (`tui-daemon-client.ts:73-78` checks only that `pipelines` is an array) carries a corrupted timestamp.
- Detail wiring goes through one `absoluteDetailRows` seam in `tui-monitor-lines.ts` that maps entries through the formatter before delegating to `detailRows` — rules out per-call-site `formatAbsoluteTimestamp(...)` sprinkling that drifts as fields are added.
- Stage detail gains a `decidedAt` row through that same seam — rules out leaving the durable approval-decision instant unpainted while `startedAt`/`endedAt` render. This is distinct from the existing `decided=` gate-age rollup, which is a relative duration computed from `stage.endedAt`; the new row is the absolute decision instant from `stage.decidedAt`.
- `wallClock`, `elapsed`, `decided` age, `work`, and `idle` keep `formatElapsedWallClock`/`formatAggregateDuration` untouched — rules out applying the absolute formatter to durations.
- Only the eight flat fields named above are in scope; artifact shapes that fall through to `prettyJsonRows` (`tui-monitor-lines.ts:700-701`) keep rendering raw epochs inside nested JSON — rules out reformatting nested artifact payloads.

## Task checklist

- [ ] Add `v2/src/tui/tui-timestamp-format.ts` exporting `export function formatAbsoluteTimestamp(epochMs: number | null | undefined): string`. The function's first statement is the guard `if (epochMs == null) { return ""; }`, exactly as written (this exact line is the mutation anchor below). Non-finite/out-of-range input returns `"invalid"`. Add co-located `tui-timestamp-format.test.ts`.
- [ ] Add `absoluteDetailRows` in `tui-monitor-lines.ts` that maps entries through the formatter, exactly as `value: formatAbsoluteTimestamp(value)` at the call site (this exact fragment is the mutation anchor below), before delegating to `detailRows`. Route pipeline `createdAt`/`finishedAtMs`/`terminalPublicationSucceededAt`, stage `startedAt`/`endedAt`/`decidedAt`, and run `createdAt`/`finishedAtMs` through it.
- [ ] Add a new `tui-monitor-lines.test.ts` fixture with a non-null stage `decidedAt` (the existing fixture at `:116` sets it `null`; non-null cases today only exist in `tui-attention-rows.test.ts`) and pin its ISO 8601 detail row.
- [ ] Update `tui-monitor-lines.test.ts` pins that assert raw-epoch output to the ISO form, and add pins for stage and terminal-publication timestamps. The `createdAt: 0` fixture at `:1717` witnesses the existing falsy-but-present detail guard; after this change that field is a truthy ISO string, so preserve that guard's coverage deliberately via its other falsy witnesses (`isLive: false`, `prNumber: 0`, `iterationsConsumed: 0`) rather than dropping the case.
- [ ] Update the two docs below.

## Mutation directives

| Directive | Lives inside test | File |
| --- | --- | --- |
| Absent-value guard | `absent absolute timestamps paint no detail row` | `v2/src/tui/tui-monitor-lines.ts` (test in `v2/src/tui/tui-monitor-lines.test.ts`) |
| Detail seam | `pipeline detail renders absolute timestamps as ISO 8601 UTC` | `v2/src/tui/tui-monitor-lines.ts` (test in `v2/src/tui/tui-monitor-lines.test.ts`) |

```text
// @mutate v2/src/tui/tui-timestamp-format.ts "if (epochMs == null) { return \"\"; }" -> "if (false) { return \"\"; }"
// @mutate v2/src/tui/tui-monitor-lines.ts "value: formatAbsoluteTimestamp(value)" -> "value: String(value)"
```

## Acceptance criteria

- [ ] `formatAbsoluteTimestamp` converts a fixed epoch-ms value to UTC `YYYY-MM-DDTHH:MM:SSZ` with no fractional seconds, formats `0` as `1970-01-01T00:00:00Z`, and returns the empty string for `null` and `undefined`; `tui-timestamp-format.test.ts` covers this and fails against raw or locale-dependent formatting.
- [ ] A non-finite or out-of-range epoch-ms value passed to `formatAbsoluteTimestamp` returns `"invalid"` and never throws; pinned in `tui-timestamp-format.test.ts` and it fails against an unguarded `toISOString()` implementation.
- [ ] Pipeline `createdAt`, `finishedAtMs`, and `terminalPublicationSucceededAt`, selected-stage `startedAt`, `endedAt`, and `decidedAt`, and selected-run `createdAt` and `finishedAtMs` paint ISO 8601 UTC values in `jarvis tui` detail; `tui-monitor-lines.test.ts` pins that output and fails against the current raw-epoch rendering.
- [ ] A `null` absolute timestamp paints no detail row at all — never `Invalid Date`, never a fabricated `1970-01-01T00:00:00Z` — pinned in `tui-timestamp-format.test.ts` and in a `tui-monitor-lines.test.ts` case with null stage boundaries.
- [ ] `tui-monitor-lines.test.ts` — `absent absolute timestamps paint no detail row`; Mutation checkpoint: inverting the absent-value guard turns the scoped suite red.
- [ ] `tui-monitor-lines.test.ts` — `pipeline detail renders absolute timestamps as ISO 8601 UTC`; Keystone checkpoint: reverting the detail seam to the raw value turns the scoped suite red.
- [ ] Existing `wallClock`, `elapsed`, `decided` age, `idle`, and `work` assertions in `tui-monitor-lines.test.ts`, `tui-elapsed-format.test.ts`, and `tui-attention-rows.test.ts` stay green with their relative output unchanged.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Observe — replace "Pipeline detail preserves raw `createdAt` and `finishedAtMs`" with the ISO 8601 UTC (trailing `Z`, whole seconds) rendering; also fix the table row near `:280` ("Pipeline detail carries forensic `wallClock` plus raw creation/finish timestamps") to match. Note stage `decidedAt` now paints as an absolute instant, distinct from the existing `decided=` age rollup which stays a relative duration off `stage.endedAt`. State that `wallClock`, elapsed, and work/idle stay relative, and that non-finite/out-of-range timestamps render `"invalid"` instead of crashing the paint.
- `v2/docs/v1-behaviors.md` § TUI / observability — record that absolute detail timestamps route through the shared formatter and paint ISO 8601 UTC, `null` values remain omitted, `0` renders as the Unix epoch, malformed input renders `"invalid"`, nested artifact JSON is out of scope, and durations remain relative.
