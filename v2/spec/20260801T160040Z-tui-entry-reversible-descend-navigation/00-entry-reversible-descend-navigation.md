# Entry reversible descend navigation

After slice 01, `monitorSelectableNodeIds` walks the full flatten while painted tree rows are a
fixed top viewport slice. `selectNextRun` still falls through to `ids[0]` when `indexOf` is `-1`,
and `j`/`k` do not scroll the viewport — selection can leave the painted slice and forward walks
are not reversible with `k`.

## Problem

On a short terminal with many pipelines, `j` from the first selectable through list boundaries
visits nodes in order but `k` cannot reverse that visit order when fallthrough or missing scroll
reshapes effective walk behavior. Pressing `j` on the first pipeline row in the painted slice
expands it but selection can jump to `ids[0]` instead of the first child. Off-pane selections from
slice 01 stay valid but invisible until scroll-into-view lands here. (Earlier FIFO eviction of
terminal pipelines from selectables is removed by slice 00/01; this slice fixes fallthrough and
scroll-follow on the full-flatten baseline.)

## Decisions

- `leftPaneTreeScrollOffset` on `TuiMonitorState`; entry `selectNextRun`/`selectPreviousRun`/`selectNode` update it — rules out ink-only scroll with no persisted offset.
- Painted left-pane tree rows slice the full flatten at `leftPaneTreeScrollOffset` bounded by pane height — rules out permanent top-`maxVisibleRows` window after slice 02.
- Scroll-follow applies to tree rows in full-flatten index space (`leftPaneTreeRowIds`); unattributed/queue rows below the tree are out of scope.
- Scroll-into-view: adjust offset so the selected row's full-flatten index lies in `[offset, offset + maxVisibleRows)` with minimal offset change (fully visible, not partial clip).
- `j`/`k` advance within full `monitorSelectableNodeIds` and adjust `leftPaneTreeScrollOffset` so the selected tree row is in the painted slice — rules out valid-but-off-screen selection with no scroll follow.
- Descend-expand adds the selected pipeline or stage to `expandedPipelineNodeIds` without removing that id from `monitorSelectableNodeIds`; selection moves to its first child — rules out `ids[0]` fallthrough when `indexOf` is `-1`.
- `indexOf === -1` on `selectNextRun`/`selectPreviousRun` is a no-op: keep `selectedNodeId`, reclamp scroll if applicable; no wrap to first or last list member. List-boundary clamping at ends stays unchanged.
- After every navigation step the selected id remains in `monitorSelectableNodeIds` — rules out nav paths that drop the cursor target from walk order.
- Scroll offset resets or reclamps when terminal size, expansion, or selectable order changes such that the offset is out of range — rules out stale offsets pointing past the flatten end.
- No production `setInvert*ForTest` / `invert*ForTest` hooks — rules out test-only bypasses in entry navigation or scroll wiring.

## Prerequisites

- `tui-pipeline-tree-retain-full-flatten` and `tui-monitor-scroll-viewport-selectables` merged: full flatten drives `monitorSelectableNodeIds`; painted tree rows are a fixed top viewport slice at offset `0`; right-pane detail resolves from full flatten.
- `selectNextRun` persists descend expansion into `expandedPipelineNodeIds`; `selectPreviousRun` walks the same selectable order in reverse.
- Selection falls through to `ids[0]` (and backward equivalent) when the selected id is absent from `monitorSelectableNodeIds` — pre-fix entry behavior this slice removes.
- `currentState` carries measured `terminalColumns` and `terminalRows` for `monitorSelectableNodeIds`.

## Tasks

### Scroll viewport

- Add `leftPaneTreeScrollOffset` to `TuiMonitorState` (default `0`).
- Slice painted tree rows in `monitorLeftPaneTreeRows` (or shared helper) at `leftPaneTreeScrollOffset` with length `maxVisibleRows`.
- Add monitor-lines unit coverage that scroll offset shifts the painted window without trimming `monitorSelectableNodeIds`.

### Entry navigation

- After `selectNextRun`/`selectPreviousRun`/`selectNode`, recompute `leftPaneTreeScrollOffset` so the selected tree row's full-flatten index lies in the painted viewport window (minimal offset, fully in view).
- On descend-expand, keep the expanded pipeline or stage id in `monitorSelectableNodeIds` and select its first child — do not use `ids[0]` when `indexOf` is `-1`.
- Remove `ids[selectedIndex < 0 ? 0 : …]` fallthrough from `selectNextRun` and `selectPreviousRun`; on `indexOf === -1`, no-op (keep selection, reclamp scroll).
- Reclamp scroll offset when measured terminal size or expansion changes shrink the flatten or selectable list.

### Tests (`tui-entry.test.tsx`)

- Extend slice 01 overflow fixture: walk `j` from first selectable through list boundary until `selectedNodeId` is unchanged (safety step cap), record forward visit order, then `k` back to start — backward visit order is the exact reverse of forward; slice 02 owns scroll-follow, not slice 01's selected-in-paint contract for every selectable.
- Add pin: first pipeline row in the initial painted tree slice selected, `j` — selection is its first child, not `ids[0]` via fallthrough.
- Add pin: after each `selectNextRun`/`selectPreviousRun`, `selectedNodeId` is in `monitorSelectableNodeIds` (membership invariant; invert covered by fallthrough checkpoints).
- Add pin: after `j`/`k` or off-pane `selectNode` moves selection beyond the initial painted viewport, `leftPaneTreeRowIds` for `currentState` contains the selected id (tree rows only).
- Add `Mutation checkpoint:` on the reversible-walk pin naming reintroduction of `ids[0]` fallthrough when `indexOf` is `-1` in `selectNextRun`/`selectPreviousRun`.
- Add `Mutation checkpoint:` on the first-painted-pipeline descend pin naming `ids[0]` (and backward fallthrough) reinstatement in `selectNextRun`/`selectPreviousRun`.

### Docs

- `v2/docs/v1-behaviors.md` — replace interim full-flatten / descend-eviction deferral with the scroll-follow contract (`j`/`k` walk full selectables; viewport scrolls to keep selection visible).
- `v2/docs/operator-runbook.md` — `jarvis tui` row: when the tree exceeds the pane, walk order spans all selectables and the viewport scrolls to the selected row; remove FIFO-trimming wording.

### Verification

- Run `bun run typecheck` and `bun run test:v2`.

## Acceptance criteria

- [x] `tui-entry.test.tsx` — overflow fixture: forward `j` walk from first selectable through list boundary until `selectedNodeId` unchanged (step cap), then `k` back — backward visit order is the exact reverse of forward; fails pre-fix against slice 01 merged.
- [x] `tui-entry.test.tsx` — first pipeline row in the initial painted tree slice: `j` selects its first child, not `ids[0]` via fallthrough; fails pre-fix against slice 01 merged.
- [x] `tui-entry.test.tsx` — after each `selectNextRun` or `selectPreviousRun`, `selectedNodeId` is in `monitorSelectableNodeIds`; fails pre-fix against slice 01 merged; membership invert covered by fallthrough mutation checkpoints.
- [x] `tui-entry.test.tsx` — after `j`/`k` or off-pane `selectNode` moves selection beyond the initial painted viewport, `leftPaneTreeRowIds` contains the selected id (tree rows, full-flatten index space); fails pre-fix against slice 01 merged.
- [x] `tui-monitor-lines.test.ts` — `leftPaneTreeScrollOffset` shifts painted tree rows without trimming `monitorSelectableNodeIds`; fails pre-fix against slice 01 merged.
- [x] `tui-entry.test.tsx` — reintroducing `ids[0]` fallthrough when `indexOf` is `-1` in `selectNextRun`/`selectPreviousRun` turns the reversible-walk pin RED; `Mutation checkpoint:` names that fallthrough.
- [x] `tui-entry.test.tsx` — reintroducing `ids[0]` (and backward fallthrough) in `selectNextRun`/`selectPreviousRun` turns the first-painted-pipeline descend pin RED; `Mutation checkpoint:` names that fallthrough.
- [x] `v2/docs/v1-behaviors.md` — descend-eviction / viewport deferral replaced with scroll-follow contract (`j`/`k` walk full selectables; viewport scrolls to selected tree row).
- [x] `v2/docs/operator-runbook.md` — `jarvis tui` row documents full walk order and viewport scroll-follow when the tree exceeds the pane (no FIFO-trimming wording).
- [x] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/v1-behaviors.md` — replace the descend-eviction / viewport deferral caveat with the scrolling contract.
- `v2/docs/operator-runbook.md` — `jarvis tui` row: pane behavior when the tree exceeds terminal height (full walk order, viewport scroll follow).
