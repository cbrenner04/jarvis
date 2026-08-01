# Ink monitor split shell

Replace the flat vertical scroll in `tui-ink-monitor.tsx` with split/stacked regions, a 4-line dock,
session divider nudge, and existing run/detail content as first consumers.

## Problem

`jarvis tui` paints every monitor segment in one column (`createMonitorDisplay` →
`monitorSegmentRows`). The command-center layout needs a scrollable tree left, structured detail
right, and a fixed bottom dock — with real run rows and selected-run detail on day one.

## Prerequisites

- Subspec [00 - Tree row grid formatter](./00-tree-row-grid-formatter.md) merged or complete in the
  same branch before wiring left-pane rows.

## Decisions

- Left pane lists existing run/queue rows via the subspec-00 grid builder; right pane carries the
  selected-run workflow, outcome, and steering feedback lines unchanged from today's detail segments —
  rules out a flag-gated empty shell or re-truncating ids/paths/errors (slice 4).
- `computeShellLayout(columns, rows, dividerOffset)` drives region sizes; ink branches on
  `layoutMode` before reading `leftWidth`/`rightWidth` — rules out applying split widths in stacked
  mode (stacked may use full width and can yield negative pane heights when `rows` is small).
- Session `dividerOffset` lives in monitor session state (not persisted); `[`/`]` call
  `nudgeDividerOffset` — rules out persisting divider position.
- Dock is exactly four lines: line 1 `{activeCount} active · refresh {interval}`; line 2 inert `>`
  prompt; lines 3–4 blank — rules out command parsing (slice 5) and hint/keybinding rows in the dock
  for now.
- Active count = non-queued runs with `isLive: true`; refresh interval reads the production default
  (`1s` from `createRefreshScheduler`) — rules out hard-coding a different cadence in the dock.
- Existing keybindings preserved: `j`/down → next, up → previous, `e` expand, `k` kill, `q`/Ctrl-C
  quit; `[`/`]` added — rules out rebinding or dropping current monitor controls.
- Shell structure tests walk the ink element tree via the existing injected render seam (same class
  as `tui-ink-monitor.test.tsx` color tests), not stdout painted frames — rules out CI-only ink
  painting assertions.
- Delete resolved seeds `v2/spec/seeds/tui-tests-bypass-the-render-path.md` and
  `v2/spec/seeds/queue-widget-refactor.md` — rules out leaving dangling runbook seed references.
- Out of scope: pipeline rows, `pipeline_list` polling, elapsed values, command grammar, steering
  actions, unattributed segment.

## Tasks

- Extend monitor session state with `dividerOffset` (default `0`) and thread terminal
  `columns`/`rows` into `createMonitorDisplay`.
- Restructure `createMonitorDisplay` / `openInkMonitor` into left tree, right detail, and dock
  regions per `computeShellLayout`; wire subspec-00 tree lines on the left and existing detail
  segments on the right.
- Handle `[`/`]` in the input hook via `nudgeDividerOffset` and session state update.
- Add `tui-ink-monitor.test.tsx` coverage for split shell region content, divider nudge clamps, and
  guard-inversion checkpoints on the `layoutMode` branch and on the session `dividerOffset` update
  path for `[`/`]`.
- Delete the two resolved seed files.
- Update `v2/docs/operator-runbook.md` § Gate trust (both TUI failure modes, no seed pointer) and
  the `jarvis tui` observation row; update `v2/docs/v1-behaviors.md` `jarvis tui` entry; trim the
  ink-shell deferral note in `v2/docs/test-writing.md` § TUI test strategy now that runbook wording
  lands here.
- Run `bun run typecheck` and `bun run test:v2`.

## Acceptance criteria

- [ ] `tui-ink-monitor.test.tsx` — split shell renders run rows left, selected-run detail right, and a 4-line dock whose line 1 shows active-run count and refresh interval; fails against the pre-fix flat scroll.
- [ ] `tui-ink-monitor.test.tsx` — `drives row navigation through the injected input hook`, `drives quit and kill through the injected input hook`, and `drives workflow expansion through the injected input hook` stay green.
- [ ] `tui-ink-monitor.test.tsx` — `[`/`]` nudge divider offset through session state respecting pure-function clamps; fails against the pre-fix code.
- [ ] `tui-ink-monitor.test.tsx` — the `[`/`]` nudge pin test includes a comment checkpoint naming the required guard-inversion mutation (skip updating session `dividerOffset` on `[`/`]`).
- [ ] Source-mutating the checkpointed divider-session guard turns the `[`/`]` nudge pin RED. Do **not** add a production test flag. (Manual)
- [ ] `tui-ink-monitor.test.tsx` — the split-shell pin test includes a comment checkpoint naming the required guard-inversion mutation (skip the `layoutMode` branch and always apply split widths).
- [ ] Source-mutating the checkpointed `layoutMode` guard turns the split-shell pin RED. Do **not** add a production test flag. (Manual)
- [ ] `v2/spec/seeds/tui-tests-bypass-the-render-path.md` and `v2/spec/seeds/queue-widget-refactor.md` are deleted.
- [ ] `v2/docs/operator-runbook.md` § Gate trust documents green-while-broken and green-locally/red-on-CI TUI failure modes without pointing at an unresolved seed; the `jarvis tui` observation row describes the split-pane shell and dock.
- [ ] `v2/docs/v1-behaviors.md` — `jarvis tui` entry records split-pane shell, 4-line dock, and `[`/`]` divider nudge.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — § Gate trust TUI bullet; `jarvis tui` observation table row.
- `v2/docs/v1-behaviors.md` — `jarvis tui` entry.
- `v2/docs/test-writing.md` — § TUI test strategy ink-shell deferral note resolved.
