---
name: tui-shell-layout
---

# TUI slice 1 — command-center shell layout

First slice of [tui-overhaul-brief.md](../tui-overhaul-brief.md). Ships the window geometry only.
Pipeline nesting (slice 2), elapsed columns (slice 3), detail depth (slice 4), and the command
parser (slice 5) are out of scope.

## Problem

`jarvis tui` renders one flat, space-separated run table plus workflow steps and outcome in a
single vertical scroll (`v2/src/tui/tui-monitor-lines.ts`). The brief's operator surface is a
horizontal split — scrollable tree left, structured detail right, fixed 4-line command dock at the
bottom — sized from the live terminal. None of that geometry exists, and every downstream slice
needs it first.

Two related gaps are folded in here rather than queued separately:

- `seeds/tui-tests-bypass-the-render-path` — the repo has no supported way to assert real ink
  output. A test that drives real ink is green locally and red on CI (#2417, recovered by #2418).
  Slice 1 must decide this before writing layout tests, or it repeats the failure.
- `seeds/queue-widget-refactor` — a stub with operator notes and no acceptance criteria.

## Decisions

- Layout regions are computed by a **pure function** of `(columns, rows)`, not read off a rendered tree. Rules out geometry that can only be observed by painting.
- Reference full-window geometry `245x72` yields left tree `94` cols, right detail `151` cols, both `68` lines, plus a fixed `4`-line dock. Split default `38/62`.
- `[` and `]` nudge the divider by 2 cols, clamped to a `72`-col floor on the left pane and a ceiling of 40% of width. Session-scoped, not persisted.
- Below `120` cols the layout falls back to stacked (tree above detail, same dock). Rules out a two-pane layout that squeezes the tree to unusable width.
- Tree rows use a fixed-width column grid; values truncate with `…` and never wrap. Detail pane wraps and never truncates ids, paths, or error text.
- Column visibility is a pure function of left-pane width per the brief's degradation table; `state` and `elapsed` are never dropped. Columns not yet populated (elapsed) reserve their slot and render empty.
- Slice 1 ships with the **existing** run rows as the left pane's content and the selected run's existing detail as the right pane's content — the shell lands with a real consumer, not behind a flag.
- Existing keybindings (`j`/`k`/arrows select, `e` expand, `k` kill, `q` quit) keep working. `[`/`]` are added. No command input parsing yet — dock line 2 renders an inert prompt.
- **Test strategy, recorded once for the whole TUI phase:** rendered-output assertions through real ink are unsupported; ink does not paint into a fake stdout on CI. Layout and column selection are proved by their pure functions, keybindings by the injected input hook, behavior by production monitor state. Rules out re-litigating this per slice.
- Out of scope: pipeline rows, `pipeline_list` polling, elapsed values, command grammar, steering actions, unattributed segment.

## Acceptance criteria

- [ ] A pure layout function maps `(columns, rows)` to left/right/dock regions; `245x72` yields left `94`, right `151`, pane height `68`, dock `4`.
- [ ] The same function returns a stacked mode below `120` columns, with the dock still `4` lines.
- [ ] Divider nudge respects both clamps: `[` cannot take the left pane below `72` cols, `]` cannot take it above 40% of width.
- [ ] A pure column-selection function reproduces every row of the brief's degradation table (`>=90`, `72-89`, `58-71`, `48-57`, `<48`); `state` and `elapsed` appear in all five.
- [ ] A tree row whose value exceeds its column width is truncated with `…` to exactly the column width; no rendered tree row exceeds the left pane width.
- [ ] `jarvis tui` renders existing run rows in the left pane, the selected run's detail in the right pane, and a 4-line dock whose first line shows active-run count and refresh interval.
- [ ] `j`/`k`/arrows, `e`, `k`, and `q` behave as before, proved through the injected input hook.
- [ ] `v2/docs/test-writing.md` records the TUI test-strategy decision and names the substitutes for rendered-output assertions.
- [ ] `v2/docs/operator-runbook.md` gate-trust wording covers both failure modes (green-while-broken, and green-locally/red-on-CI) and no longer points at an unresolved seed.
- [ ] `v2/spec/seeds/tui-tests-bypass-the-render-path.md` and `v2/spec/seeds/queue-widget-refactor.md` are deleted, folded into this work.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/test-writing.md` — TUI test strategy and what is not assertable.
- `v2/docs/operator-runbook.md` — gate-trust TUI bullet; `jarvis tui` observation row reflects the new shell.

## Prerequisites

- `v2/spec/tui-overhaul-brief.md` — layout, region geometry, and column degradation tables
- `v2/src/tui/tui-monitor-lines.ts` — current flat segment-row renderer
- `v2/src/tui/tui-ink-monitor.tsx` — production ink tree and input handling
- `v2/src/tui/tui-entry.tsx` — session host, refresh loop, and selection state
- #2418 — the recovery that moved the one real-ink assertion off painting
