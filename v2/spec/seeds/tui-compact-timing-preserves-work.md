---
name: tui-compact-timing-preserves-work
---

# Compact tree timing cell must preserve the work value, not clip it away

## Problem

`formatTreeTiming` (`v2/src/tui/tui-monitor-pipeline-tree.ts:310`) truncates an over-width timing string with `formatted.slice(formatted.length - width)`, which keeps the rightmost `width` characters and drops the leftmost — i.e. the *work* side. In the compact eight-character cell, a value like `w23h/i100d` renders as `3h/i100d` (work reads as "3h", losing "w2"), and even a two-digit work value drops the leading `w`. This contradicts the work-idle spec's explicit decision that the compact form "never silently drops work" (`v2/spec/completed/20260810T015227Z-tui-work-idle-time/00-aggregate-work-and-idle-projection.md`). It is reachable exactly in the motivating parked-pipeline case (large idle, multi-hour/day work) that the feature exists to surface. Found in subagent review of #2797; low severity (narrow terminal + large durations) but a real correctness gap against the spec.

## Decisions

- When the compact timing string exceeds the cell width, preserve the work value and abbreviate the idle side, never the reverse — rules out clipping that corrupts or drops work.
- Prefer dropping the idle segment entirely (compact `w<duration>` with work intact) over a partial idle when both cannot fit — rules out a half-rendered idle that reads as a different magnitude.
- Scope to the compact over-width path in `formatTreeTiming`; normal-width formatting and the non-compact 20-char cell are unchanged — rules out reflowing the normal cell.

## Acceptance criteria

- [ ] A compact timing string wider than eight characters renders with the full work value intact and the idle side abbreviated or dropped, never a left-clipped work value; a `v2/src/tui/tui-monitor-pipeline-tree.test.ts` regression pins a large-work/large-idle case (e.g. `w23h/i100d`) and fails against the current left-clip.
- [ ] A compact string that already fits eight characters is unchanged.
- [ ] The non-compact 20-character cell path is unchanged; existing width/compact tests stay green.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Observe — note that the compact timing cell preserves work and abbreviates idle under width pressure.
