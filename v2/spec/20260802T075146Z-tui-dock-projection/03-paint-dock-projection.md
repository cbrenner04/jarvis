# 03 - Paint the dock projection

## Problem

Ink still owns hardcoded dock text and does not prove the projected rows occupy a fixed physical dock.

## Decisions

- `createMonitorDisplay` paints only the four pure projection rows through the existing segmented-row renderer; it assembles no dock copy.
- Both shells reserve `dockHeight: 4`; each child is one sanitized, display-width-bounded projected row, preventing wrapping in empty and long-input states.
- Existing navigation, expansion, divider, kill, and quit controls remain unchanged. Editing and command submission remain deferred.

## Work

- Replace `renderDockContent` assembly in `v2/src/tui/tui-ink-monitor.tsx` with the pure projection.
- Add split/stacked Ink-tree and rendered-output regressions in `v2/src/tui/tui-ink-monitor.test.tsx`.
- Align durable operator behavior and the current TUI brief.

## Acceptance criteria

- [x] `v2/src/tui/tui-ink-monitor.test.tsx` adds a regression that fails against the hardcoded baseline and proves `createMonitorDisplay` paints only the pure projection's status, cursor-bearing prompt, continuation, and contextual-hints rows in split and stacked shells.
- [x] Captured split and stacked rendered output proves empty and long input paint exactly four non-wrapping physical dock rows, preserve pane height, and contain no controls or line breaks that create extra rows.
- [x] No dock text is assembled in `v2/src/tui/tui-ink-monitor.tsx` outside the pure projection, and `v2/src/tui/tui-ink-monitor.test.tsx` unfocused navigation, expansion, divider, kill, and quit tests stay green.
- [x] `v2/src/tui/tui-ink-monitor.test.tsx` carries a valid `// @mutate` directive for every added or modified executable wiring/layout guard, including guards suppressing dock content or wrapping; inverting each real source condition turns its pin red, with no production inversion hook.
- [x] `v2/docs/operator-runbook.md` § Observe documents the fixed status/input/continuation/hints rows, active-pipeline count (including retained contradictory observations), invocation profile/key, refresh label, RPC-error/result precedence, cursor windowing, and contextual hints.
- [x] `v2/docs/v1-behaviors.md` records the state-driven four-line dock and its v2-only status/input behavior.
- [x] `v2/spec/tui-overhaul-brief.md` no longer claims the continuation row collapses when empty and records the pure dock projection as shipped while editing and dispatch remain open.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Observe — fixed rows, status fields, error lifecycle, cursor windowing, and contextual hints.
- `v2/docs/v1-behaviors.md` — state-driven four-line dock.
- `v2/spec/tui-overhaul-brief.md` — fixed continuation row and slice status.
