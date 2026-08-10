# 00 - Compact over-width timing elides idle instead of clipping work

## Problem

`formatTreeTiming` (`v2/src/tui/tui-monitor-pipeline-tree.ts:307`) clips any over-width timing string with `formatted.slice(formatted.length - width)`, keeping the rightmost characters. In the eight-column compact cell `w23h/i100d` (10 chars) renders as `3h/i100d`: the `w` marker is gone and work reads as "3h". That contradicts the work-idle decision that the compact cell never drops work within its rendered string, and it is reachable today in the parked-pipeline case (multi-hour work, multi-day idle) the feature exists to surface.

A naive fix — re-rendering over-width compact strings as the work-only form (`w<work>`) — collides with the existing `idleMs === null` running-form output, which is already exactly `w<work>` (`formatAggregateTiming`, `tui-elapsed-format.ts:19`). `workIdleTiming` returns `idleMs: null` whenever a pipeline/branch is actively running, so a parked pipeline with large idle would render byte-identical to an actively-running one — the opposite of what the feature exists to surface. The fix must keep the two cases visually distinguishable.

## Decisions

- An over-width compact string re-renders as `w<work>/i…` — full work value plus an idle-elided marker — left-padded to the eight-column cell (`padEnd`), distinct from the right-aligned (`padStart`) running form. The alignment difference plus the `/i…` marker rule out the running-form collision.
- Idle collapses to the `…` marker whole, never a partially rendered magnitude (e.g. `i10` standing in for `i100d`) — rules out a half-rendered idle that misreads as a different duration.
- A work-only-with-marker string that still exceeds eight columns (`w<work>/i…` itself over 8 chars) renders `w<work>` with no marker rather than clipped — defensive; unreachable given the day-capped duration formatter (`formatAggregateDuration` never exceeds a few digits plus unit), so it carries no acceptance obligation.
- The non-compact 20-column path keeps its existing right-clip. Clipping `work <dur> · idle <dur>` costs at most one character off the `work` *label*, never off a duration digit — unlike the compact case, where clipping corrupted the work *value*. That asymmetry is why only the compact path changes.
- `formatTreeTiming` is shared by pipeline rows and branch rows (`tui-monitor-pipeline-tree.ts:409`) at the same width budget, so branch rows get the same elision behavior with no separate handling.
- Scope is the compact over-width branch only; normal-width formatting is untouched.

## Task checklist

- [ ] Branch the over-width path in `formatTreeTiming`: compact re-renders as `w<work>/i…` (`padEnd(8)`), falling back to bare `w<work>` only if even that overflows; non-compact keeps `slice`.
- [ ] Add pinning tests in `v2/src/tui/tui-monitor-pipeline-tree.test.ts` with `@mutate` directives (keystone + guard).
- [ ] Retitle and tighten the existing `w59m/i10d` overflow test — its "right-clips" title and vacuous `toHaveLength(8)` assertion are stale under the new behavior — to assert the elided literal.
- [ ] Add a non-compact over-width pinning test (currently uncovered) asserting the retained right-clip.
- [ ] Update both doc homes describing the compact-cell behavior and the branch-row sharing.

## Acceptance criteria

- [ ] A compact timing cell whose paired form exceeds eight columns renders the full work value with idle elided to `w<work>/i…`, padded right to fill the cell (e.g. `w23h/i100d` input → cell `"w23h/i… "`), never a left-clipped or running-form-colliding value. `v2/src/tui/tui-monitor-pipeline-tree.test.ts` — `the compact timing cell keeps full work and elides idle when the paired form overflows`; fails against the current left-clip. Keystone checkpoint: `v2/src/tui/tui-monitor-pipeline-tree.test.ts` — `the compact timing cell keeps full work and elides idle when the paired form overflows`; // @mutate v2/src/tui/tui-monitor-pipeline-tree.ts "return elided.length > width ? `w${formatAggregateDuration(timing.workMs)}` : elided.padEnd(width);" -> "return formatted.slice(formatted.length - width);"
- [ ] A compact timing string that overflows by any margin, not just the pinned large-work/large-idle case, elides idle rather than partially rendering a truncated digit (e.g. `w59m/i10d`, 9 chars → cell `"w59m/i… "`). `v2/src/tui/tui-monitor-pipeline-tree.test.ts` — the retitled `the compact timing cell elides idle instead of right-clipping work when the paired form overflows`.
- [ ] A compact timing string of exactly eight columns (`w59m/i1m`) is unchanged, keeping both segments — pins the `>` vs `>=` width-comparison boundary. `v2/src/tui/tui-monitor-pipeline-tree.test.ts` — `a compact timing string that fits eight columns keeps its idle segment`; Mutation checkpoint: `v2/src/tui/tui-monitor-pipeline-tree.test.ts` — `a compact timing string that fits eight columns keeps its idle segment`; // @mutate v2/src/tui/tui-monitor-pipeline-tree.ts "if (formatted.length <= width) return formatted.padStart(width);" -> "if (formatted.length < width) return formatted.padStart(width);"
- [ ] The non-compact 20-column path retains its right-clip on overflow (unchanged): a 21-character `work <dur> · idle <dur>` string clips to its rightmost 20 characters. `v2/src/tui/tui-monitor-pipeline-tree.test.ts` — new test `the non-compact timing cell still right-clips a value too wide for twenty columns`, pinning `"work 100d · idle 100d"` (21 chars) → cell `"ork 100d · idle 100d"`.
- [ ] `pipeline timing has full and compact tree representations` stays green (behavior unchanged for in-width strings).
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Observe (the pipeline/branch timing paragraph): the compact cell elides idle to `w<work>/i…` and keeps work whole under width pressure, distinct from the running form's plain `w<work>`; the 20-column cell still right-clips, costing only a label character; branch rows share the same behavior via `formatTreeTiming`.
- `v2/docs/v1-behaviors.md` (the `jarvis tui` monitor bullet): same correction — it currently states the compact cell is "right-clipped to fit".
