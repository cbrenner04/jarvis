# Entry reversible descend navigation

After slice 01, `monitorSelectableNodeIds` walks the full flatten while painted tree rows are a
top-window viewport slice. `selectNextRun` still falls through to `ids[0]` when `indexOf` is `-1`,
and `j`/`k` do not scroll the viewport — selection can leave the painted slice and forward walks
are not reversible with `k`.

## Problem

On a short terminal with many pipelines, `j` from the first selectable node visits only a subset of
the tree; `k` cannot recover nodes skipped when descend expansion or stale fallthrough reshapes walk
order. Pressing `j` on a visible pipeline expands it but selection can jump to `ids[0]` instead of
the first child when the parent id is missing from `monitorSelectableNodeIds`. Off-pane selections
from slice 01 stay valid but invisible until scroll-into-view lands here.

## Decisions

- `leftPaneTreeScrollOffset` on `TuiMonitorState`; entry `selectNextRun`/`selectPreviousRun`/`selectNode` update it — rules out ink-only scroll with no persisted offset.
- Painted left-pane tree rows slice the full flatten at `leftPaneTreeScrollOffset` bounded by pane height — rules out permanent top-`maxVisibleRows` window after slice 02.
- `j`/`k` advance within full `monitorSelectableNodeIds` and adjust `leftPaneTreeScrollOffset` so the selected row is in the painted slice — rules out valid-but-off-screen selection with no scroll follow.
- Descend-expand adds the selected pipeline or stage to `expandedPipelineNodeIds` without removing that id from `monitorSelectableNodeIds`; selection moves to its first child — rules out `ids[0]` fallthrough when `indexOf` is `-1`.
- `indexOf === -1` on `selectNextRun`/`selectPreviousRun` does not reset selection to `ids[0]` — rules out silent first-row fallthrough.
- After every navigation step the selected id remains in `monitorSelectableNodeIds` — rules out nav paths that drop the cursor target from walk order.
- Scroll offset resets or reclamps when terminal size, expansion, or selectable order changes such that the offset is out of range — rules out stale offsets pointing past the flatten end.
- No production `setInvert*ForTest` / `invert*ForTest` hooks — rules out test-only bypasses in entry navigation or scroll wiring.

## Prerequisites

- `tui-monitor-scroll-viewport-selectables` merged: full flatten drives `monitorSelectableNodeIds`; painted tree rows are viewport-sliced; right-pane detail resolves from full flatten.
- `selectNextRun` persists descend expansion into `expandedPipelineNodeIds`; `selectPreviousRun` walks the same selectable order in reverse.
- Selection falls through to `ids[0]` when the selected id is absent from `monitorSelectableNodeIds` (pre-fix entry behavior this slice removes).
- `currentState` carries measured `terminalColumns` and `terminalRows` for `monitorSelectableNodeIds`.

## Tasks

### Scroll viewport

- Add `leftPaneTreeScrollOffset` to `TuiMonitorState` (default `0`).
- Slice painted tree rows in `monitorLeftPaneTreeRows` (or shared helper) at `leftPaneTreeScrollOffset` with length `maxVisibleRows`.
- Add monitor-lines unit coverage that scroll offset shifts the painted window without trimming `monitorSelectableNodeIds`.

### Entry navigation

- After `selectNextRun`/`selectPreviousRun`/`selectNode`, recompute `leftPaneTreeScrollOffset` so the selected tree row index lies within the painted viewport window.
- On descend-expand, keep the expanded pipeline or stage id in `monitorSelectableNodeIds` and select its first child — do not use `ids[0]` when `indexOf` is `-1`.
- Remove `ids[selectedIndex < 0 ? 0 : …]` fallthrough from `selectNextRun` and `selectPreviousRun`; clamp or no-op within the list when the selected id is absent.
- Reclamp scroll offset when measured terminal size or expansion changes shrink the flatten or selectable list.

### Tests (`tui-entry.test.tsx`)

- Add overflow fixture (more terminal pipelines than fit the pane): walk `j` from first selectable through last, then `k` back — forward and backward visits are the same node set in reverse; every pipeline id present at start remains in `monitorSelectableNodeIds` at end.
- Add pin: oldest visible pipeline selected, `j` — parent id stays in `monitorSelectableNodeIds`; selection is its first child.
- Add pin: after each `selectNextRun`/`selectPreviousRun`, `selectedNodeId` is in `monitorSelectableNodeIds`.
- Add pin: after `j`/`k` moves selection beyond the initial painted viewport, `leftPaneTreeRowIds` for `currentState` contains the selected id.
- Add `Mutation checkpoint:` on the reversible-walk pin naming reintroduction of `ids[0]` fallthrough when `indexOf` is `-1` in `selectNextRun`/`selectPreviousRun`.

### Docs

- `v2/docs/v1-behaviors.md` — replace interim full-flatten / descend-eviction deferral with the scroll-follow contract (`j`/`k` walk full selectables; viewport scrolls to keep selection visible).
- `v2/docs/operator-runbook.md` — `jarvis tui` row: when the tree exceeds the pane, walk order spans all selectables and the viewport scrolls to the selected row; remove FIFO-trimming wording.

### Verification

- Run `bun run typecheck` and `bun run test:v2`.

## Acceptance criteria

- [ ] `tui-entry.test.tsx` — with more pipelines than fit the pane, walking `j` from the first selectable node to the last and `k` back visits the same node set in reverse; no pipeline present at the start is absent from `monitorSelectableNodeIds` at the end; fails pre-fix.
- [ ] `tui-entry.test.tsx` — selecting the oldest visible pipeline and pressing `j` keeps that pipeline in `monitorSelectableNodeIds` and moves selection to its first child; fails pre-fix.
- [ ] `tui-entry.test.tsx` — a selected node id is never absent from `monitorSelectableNodeIds` after `selectNextRun` or `selectPreviousRun`; fails pre-fix.
- [ ] `tui-entry.test.tsx` — after `j`/`k` moves selection beyond the painted viewport, the selected row appears in the painted left-pane tree slice; fails pre-fix.
- [ ] `tui-entry.test.tsx` — reintroducing selection fallthrough to `ids[0]` when the selected id leaves the list turns the reversible-walk / descend-navigation pins RED; `Mutation checkpoint:` names that fallthrough.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/v1-behaviors.md` — replace the descend-eviction / viewport deferral caveat with the scrolling contract.
- `v2/docs/operator-runbook.md` — `jarvis tui` row: pane behavior when the tree exceeds terminal height (full walk order, viewport scroll follow).
