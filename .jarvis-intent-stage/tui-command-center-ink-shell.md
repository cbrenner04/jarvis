---
name: tui-command-center-ink-shell
---

# TUI command-center ink shell

Ship the horizontal split + 4-line dock in production ink, wiring existing run rows and detail as
first consumers. Session `[`/`]` divider nudge; existing navigation keybindings preserved.

## Problem

`jarvis tui` renders one flat vertical scroll (`tui-monitor-lines.ts` → `tui-ink-monitor.tsx`). The
brief's command center needs scrollable tree left, structured detail right, fixed dock bottom — with
real content on day one, not behind a flag.

## Decisions

- Slice 1 uses existing run rows as the left pane and the selected run's existing detail as the right pane — rules out a flag-gated empty shell.
- Tree rows use the fixed-width column grid from pure layout helpers; values truncate, never wrap. Detail pane wraps and never truncates ids, paths, or error text.
- Dock line 1 shows active-run count and refresh interval; line 2 is an inert `>` prompt — rules out command parsing (slice 5).
- Session-scoped divider offset lives in monitor session state; `[`/`]` call layout nudge on the pure function — rules out persisting divider position.
- Existing keybindings (`j`/`k`/arrows, `e`, `k`, `q`) keep working; `[`/`]` are added — rules out rebinding or dropping current monitor controls.
- Out of scope: pipeline rows, `pipeline_list` polling, elapsed values, command grammar, steering actions, unattributed segment.

## Acceptance criteria

- [ ] `jarvis tui` renders existing run rows in the left pane, the selected run's detail in the right pane, and a 4-line dock whose first line shows active-run count and refresh interval.
- [ ] No rendered tree row exceeds the left pane width; overflow uses `…` per the pure cell formatter.
- [ ] `j`/`k`/arrows, `e`, `k`, and `q` behave as before, proved through the injected input hook.
- [ ] `[`/`]` nudge the divider through session state and respect the pure-function clamps.
- [ ] `v2/spec/seeds/tui-tests-bypass-the-render-path.md` and `v2/spec/seeds/queue-widget-refactor.md` are deleted.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — gate-trust TUI bullet covers green-while-broken and green-locally/red-on-CI, no longer points at an unresolved seed; `jarvis tui` observation row reflects the new shell.

## Prerequisites

- Pure layout maps `(columns, rows)` and divider offset to left/right/dock regions including `245×72` reference sizes.
- Stacked layout fallback below `120` columns with a `4`-line dock.
- Divider nudge clamps at `72` cols left floor and `40%` width left ceiling.
- Column visibility follows the degradation table with `state` and `elapsed` always present and empty slots reserved.
- Tree cells truncate to column width with `…` via the pure formatter.
- TUI test strategy is recorded in `v2/docs/test-writing.md` with named substitutes for rendered-output assertions.
