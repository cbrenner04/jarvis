# 00 - Compact over-width timing drops idle instead of clipping work

## Problem

`formatTreeTiming` (`v2/src/tui/tui-monitor-pipeline-tree.ts:307`) clips any over-width timing string with `formatted.slice(formatted.length - width)`, keeping the rightmost characters. In the eight-column compact cell `w23h/i100d` (10 chars) renders as `3h/i100d`: the `w` marker is gone and work reads as "3h". That contradicts the work-idle decision that the compact cell never drops work within its rendered string, and it is reachable today in the parked-pipeline case (multi-hour work, multi-day idle) the feature exists to surface.

## Decisions

- An over-width compact string re-renders as work-only (`w<duration>`, the existing `idleMs === null` form) — rules out clipping that corrupts or truncates the work value.
- Idle is dropped whole, never partially rendered and never marked with an ellipsis — rules out a half-rendered idle reading as a different magnitude.
- A work-only string that still exceeds eight columns renders in full rather than clipped — rules out reintroducing left-clipping at the pathological tail; work integrity outranks column bounding.
- The non-compact 20-column path keeps its existing right-clip — rules out reflowing the normal cell in this change.

## Task checklist

- [ ] Branch the over-width path in `formatTreeTiming` so compact re-renders work-only and non-compact keeps `slice`.
- [ ] Add pinning tests in `v2/src/tui/tui-monitor-pipeline-tree.test.ts` with `@mutate` directives.
- [ ] Retitle the existing `w59m/i10d` overflow test (its "right-clips" wording is now stale) and tighten it to assert the rendered `w59m`.
- [ ] Update both doc homes describing the right-clip.

## Acceptance criteria

- [ ] A compact timing cell whose paired form exceeds eight columns renders the full work value with idle dropped (`w23h/i100d` → a right-aligned `w23h`), never a left-clipped work value; the new large-work/large-idle test in `v2/src/tui/tui-monitor-pipeline-tree.test.ts` fails against the pre-fix left-clip and passes after. `v2/src/tui/tui-monitor-pipeline-tree.test.ts` — `the compact timing cell keeps full work and drops idle when the paired form overflows`; Keystone checkpoint: reverting the work-only re-render to the baseline `formatted.slice(...)` leaves the cell left-clipped and the test red.
- [ ] A compact timing string that already fits eight columns keeps both segments. `v2/src/tui/tui-monitor-pipeline-tree.test.ts` — `a compact timing string that fits eight columns keeps its idle segment`; Mutation checkpoint: inverting the fits-in-width guard so a fitting string takes the over-width path turns this test red.
- [ ] The non-compact 20-column path is unchanged: the existing `v2/src/tui/tui-monitor-pipeline-tree.test.ts` test `pipeline timing has full and compact tree representations` stays green, as does the existing eight-column overflow test.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Observe (the pipeline/branch timing paragraph): the compact cell drops idle and keeps work whole under width pressure; the 20-column cell still right-clips.
- `v2/docs/v1-behaviors.md` (the `jarvis tui` monitor bullet): same correction — it currently states the compact cell is "right-clipped to fit".
