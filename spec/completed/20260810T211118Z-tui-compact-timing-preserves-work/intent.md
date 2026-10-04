---
name: tui-compact-timing-preserves-work
---

# Compact tree timing cell preserves work, abbreviates idle

Single module-boundary surface — the over-width branch of `formatTreeTiming` in `v2/src/tui/tui-monitor-pipeline-tree.ts` and its co-located test — so splitting does not apply.

## Problem

`formatTreeTiming` clips an over-width timing string with `formatted.slice(formatted.length - width)`, keeping the rightmost characters and dropping the work side. In the eight-character compact cell `w23h/i100d` renders as `3h/i100d`, so work reads as "3h"; even two-digit work loses its leading `w`. That contradicts the work-idle spec decision that the compact form never silently drops work (`v2/spec/completed/20260810T015227Z-tui-work-idle-time/00-aggregate-work-and-idle-projection.md`), and it is reachable in the motivating parked-pipeline case (large idle, multi-hour/day work) the feature exists to surface.

## Decisions

- Over-width compact strings preserve the full work value and abbreviate or drop the idle side — rules out any clipping that corrupts or truncates work.
- Drop the idle segment entirely (`w<duration>`) rather than render a partial idle when both cannot fit — rules out a half-rendered idle that reads as a different magnitude.
- Scope to the compact over-width path; normal-width formatting and the non-compact 20-character cell are untouched — rules out reflowing the normal cell.

## Acceptance criteria

- [ ] A compact timing string wider than eight characters renders with the full work value intact and the idle side abbreviated or dropped, never a left-clipped work value; a `v2/src/tui/tui-monitor-pipeline-tree.test.ts` regression pins a large-work/large-idle case (e.g. `w23h/i100d`) and fails against the current left-clip.
- [ ] A compact string that already fits eight characters is unchanged.
- [ ] The non-compact 20-character cell path is unchanged; existing width/compact tests stay green.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Observe — the compact timing cell preserves work and abbreviates idle under width pressure.

## Prerequisites
