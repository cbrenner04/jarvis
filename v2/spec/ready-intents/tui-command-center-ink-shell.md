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

- Slice 1 uses existing run rows as the left pane and the selected run's existing detail as the right pane unchanged — rules out a flag-gated empty shell; brief detail-pane truncation contract (no id/path/error truncation) is slice 4, not re-mounted here.
- Tree rows use the fixed-width column grid from pure layout helpers; values truncate, never wrap.
- The shell branches on `layoutMode` before reading `leftWidth`/`rightWidth`: `computeShellLayout` applies the `72`-col left floor unconditionally, so stacked-mode widths and small-`rows` pane heights can be negative — rules out feeding split-mode geometry into the stacked render path.
- Dock line 1 shows active-run count and refresh interval; line 2 is an inert `>` prompt — rules out command parsing (slice 5).
- Session-scoped divider offset lives in monitor session state; `[`/`]` call layout nudge on the pure function — rules out persisting divider position.
- Existing keybindings preserved: `j`/down → next, up → previous, `e` expand, `k` kill, `q`/Ctrl-C quit; `[`/`]` added — rules out rebinding or dropping current monitor controls.
- Out of scope: pipeline rows, `pipeline_list` polling, elapsed values, command grammar, steering actions, unattributed segment.

## Acceptance criteria

- [ ] `tui-ink-monitor.test.tsx` — split shell renders run rows left, selected-run detail right, and a 4-line dock whose line 1 shows active-run count and refresh interval; fails against the pre-fix flat scroll.
- [ ] `tui-shell-layout.test.ts` — tree row builder applies the pure cell formatter so overflow truncates with `…` at column width; fails against the pre-fix path (not painted ink output).
- [ ] `tui-ink-monitor.test.tsx` — `drives row navigation through the injected input hook`, `drives quit and kill through the injected input hook`, and `drives workflow expansion through the injected input hook` stay green.
- [ ] `tui-ink-monitor.test.tsx` — `[`/`]` nudge divider offset through session state respecting pure-function clamps; fails against the pre-fix code.
- [ ] `v2/spec/seeds/tui-tests-bypass-the-render-path.md` and `v2/spec/seeds/queue-widget-refactor.md` are deleted.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — gate-trust TUI bullet covers green-while-broken and green-locally/red-on-CI, no longer points at an unresolved seed; `jarvis tui` observation row reflects the new shell.
- `v2/docs/v1-behaviors.md` — `jarvis tui` entry records split-pane shell, dock, and `[`/`]` divider nudge.

## Prerequisites

- Pure layout maps `(columns, rows)` and divider offset to left/right/dock regions including `245×72` reference sizes.
- Stacked layout fallback below `120` columns with a `4`-line dock.
- Divider nudge clamps at `72` cols left floor and `40%` width left ceiling.
- Column visibility follows the degradation table with `state` and `elapsed` always present and empty slots reserved.
- Tree cells truncate to column width with `…` via the pure formatter.
- TUI test strategy is recorded in `v2/docs/test-writing.md` with named substitutes for rendered-output assertions.
