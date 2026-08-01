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

- **Left pane:** selectable workflow-table run rows via the subspec-00 grid builder; when queued runs
  exist, a plain `Queue` heading row then queue rows in today's `queueRow` segment layout (status toned,
  admission descriptor uncolored—not grid columns) — rules out folding queue into run rows or dropping
  the section.
- **Right pane:** selected-run workflow steps, `Outcome` block, and steering feedback only—the tail of
  today's `monitorSegmentRows` after the run/queue block — rules out run rows, queue block, or dock
  content in the detail pane.
- **Dropped from flat scroll:** legacy header row (`runId project branch status liveness`) and the
  help/keybinding line (`Press up/down or j to select…`) — rules out relocating keybinding hints to the
  dock (slice 5).
- Grid run rows preserve today's `MonitorSegmentTone` coloring on `state` and `live` cells in ink —
  rules out untoned grid rows without a `v1-behaviors.md` behavior change.
- Pane overflow **clips** at region bounds; tree scroll and scroll-into-view are out of scope — rules
  out selection-follow scrolling in slice 1.
- `computeShellLayout(columns, rows, dividerOffset)` drives region sizes; ink branches on
  `layoutMode` before reading `leftWidth`/`rightWidth` — rules out applying split widths in stacked
  mode (stacked may use full width and can yield negative pane heights when `rows` is small).
- Session `dividerOffset` lives in monitor session state (not persisted); `[`/`]` call
  `nudgeDividerOffset` — rules out persisting divider position.
- Dock is exactly four lines: line 1 `{activeCount} active · refresh {interval}`; line 2 inert `>`
  prompt; lines 3–4 blank — rules out command parsing (slice 5) and hint/keybinding rows in the dock
  for now.
- Active count = non-queued runs with `isLive: true`; dock line 1 refresh label is derived from the
  same exported default interval as `createRefreshScheduler` in `tui-entry.tsx` (e.g.
  `TUI_REFRESH_INTERVAL_MS` → `1s`), threaded into monitor display via deps or session snapshot —
  rules out a dock-local literal or a value unrelated to the scheduler default.
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
  `columns`/`rows` into `createMonitorDisplay` (production from stdout; tests via explicit deps or
  state fields—divider-nudge pins use `245×72` reference geometry).
- Export or reuse the refresh-interval default from `tui-entry.tsx` and pass its display label into
  the dock renderer.
- Restructure `createMonitorDisplay` / `openInkMonitor` into identifiable left, right, and dock
  region subtrees per `computeShellLayout`; wire subspec-00 grid lines and queue section on the left
  and workflow/outcome/steering detail segments on the right.
- Handle `[`/`]` in the input hook via `nudgeDividerOffset` and session state update.
- Add `tui-ink-monitor.test.tsx` coverage for region-local split-shell separation (detail absent from
  left subtree, dock line 1 absent from left/right subtrees, run rows absent from right subtree),
  divider nudge clamps at `245×72`, and guard-inversion checkpoints on the `layoutMode` branch and
  on the session `dividerOffset` update path for `[`/`]`.
- Retire `concatenated rendered row cells match monitorTextLines entries`—replace with the
  region-local split-shell assertions above (flat concatenation is not the shell contract).
- Delete the two resolved seed files.
- Update `v2/docs/operator-runbook.md` § Gate trust (both TUI failure modes, no seed pointer) and
  the `jarvis tui` observation row; update `v2/docs/v1-behaviors.md` `jarvis tui` entry; trim the
  ink-shell deferral note in `v2/docs/test-writing.md` § TUI test strategy now that runbook wording
  lands here.
- Run `bun run typecheck` and `bun run test:v2`.

## Acceptance criteria

- [x] `tui-ink-monitor.test.tsx` — split shell renders run rows in the left subtree, selected-run workflow/outcome/steering detail in the right subtree, and a 4-line dock whose line 1 shows active-run count and refresh interval; region-local assertions prove detail text is absent from the left subtree, dock line 1 is absent from left/right subtrees, and run-row text is absent from the right subtree; fails against the pre-fix flat scroll.
- [x] `tui-ink-monitor.test.tsx` — `drives row navigation through the injected input hook`, `drives quit and kill through the injected input hook`, and `drives workflow expansion through the injected input hook` stay green.
- [x] `tui-ink-monitor.test.tsx` — `colors status and liveness cells on run-table rows` and `colors queue status and leaves admission descriptor uncolored` stay green (grid `state`/`live` tones preserved).
- [x] `tui-ink-monitor.test.tsx` — `concatenated rendered row cells match monitorTextLines entries` is removed or replaced by the region-local split-shell pin above.
- [x] `tui-ink-monitor.test.tsx` — `[`/`]` nudge divider offset through session state respecting pure-function clamps at `245×72` terminal geometry supplied via the test deps/state seam; fails against the pre-fix code.
- [x] `tui-ink-monitor.test.tsx` — the `[`/`]` nudge pin test includes a comment checkpoint naming the required guard-inversion mutation (skip updating session `dividerOffset` on `[`/`]`).
- [ ] Source-mutating the checkpointed divider-session guard turns the `[`/`]` nudge pin RED. Do **not** add a production test flag. (Manual)
- [x] `tui-ink-monitor.test.tsx` — the split-shell pin test includes a comment checkpoint naming the required guard-inversion mutation (skip the `layoutMode` branch and always apply split widths).
- [ ] Source-mutating the checkpointed `layoutMode` guard turns the split-shell pin RED. Do **not** add a production test flag. (Manual)
- [x] `v2/spec/seeds/tui-tests-bypass-the-render-path.md` and `v2/spec/seeds/queue-widget-refactor.md` are deleted.
- [x] `v2/docs/operator-runbook.md` § Gate trust documents green-while-broken and green-locally/red-on-CI TUI failure modes without pointing at an unresolved seed; the `jarvis tui` observation row (or adjacent prose) names split-pane layout, 4-line dock, `[`/`]` divider nudge, and stacked fallback below `120` columns.
- [x] `v2/docs/v1-behaviors.md` — `jarvis tui` entry records split-pane shell, 4-line dock, and `[`/`]` divider nudge.
- [x] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — § Gate trust TUI bullet; `jarvis tui` observation table row.
- `v2/docs/v1-behaviors.md` — `jarvis tui` entry.
- `v2/docs/test-writing.md` — § TUI test strategy ink-shell deferral note resolved.
