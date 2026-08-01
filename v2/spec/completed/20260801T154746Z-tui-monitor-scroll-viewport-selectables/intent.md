---
name: tui-monitor-scroll-viewport-selectables
---

# Monitor separates full selectables from scroll viewport paint

**Serial order:** runs after `tui-pipeline-tree-retain-full-flatten` (00), before `tui-entry-reversible-descend-navigation` (02).

`monitorSelectableNodeIds` and painted left-pane tree rows both derive from the same
trimmed or viewport-sliced source despite `flattenMonitorPipelineTree` returning the full
flatten (slice 00), so rows beyond the pane budget are unreachable and off-pane selection
breaks detail lookup.

## Problem

After slice 00, full flatten exists but `monitorSelectableNodeIds` and painted left-pane tree
rows still share one FIFO-trimmed or viewport-sliced list. `monitorSelectableNodeIds` omits
off-pane tree row ids; operators cannot `j`/`k` to them, selection can fall through when the
selected node is trimmed, and right-pane detail keyed to painted rows alone shows "No run
selected" for valid off-pane tree selections.

## Decisions

- Slice 01 does **not** reintroduce idle-FIFO eviction — full flatten is authoritative for
  navigation and detail lookup; `maxVisibleRows` caps **painted** tree rows only.
- `monitorSelectableNodeIds` walks the full flattened tree plus unattributed rows — rules out
  reusing a FIFO-trimmed or viewport-sliced `displayNodes` list for navigation order.
- Painted left-pane tree rows are a viewport window over the full flattened list bounded by pane
  height — rules out fitting the tree by dropping nodes from flatten or from the selectable walk.
- Paint viewport without scroll offset shows the top `maxVisibleRows` rows of the full flatten —
  rules out selection-anchored or scroll-offset viewport in this slice.
- Off-window nodes are selectable but not painted until slice 02 wires scroll offset — intentional
  interim UX, not a spec defect.
- Right-pane detail lookup uses the full flattened tree (same source as selectables); paint stays
  viewport-sliced — rules out resolving selection from painted `treeRows` only.
- `monitorSelectableNodeIds` and painted rows share measured `terminalColumns`/`terminalRows` on
  the same state object — rules out selectable order at fallback 245×72 while ink paints measured
  size.
- Full flatten and viewport slice use the same `expandedNodeIds` and `selectedNodeId` inputs —
  rules out navigation walking a different expansion state than paint.
- Deferred to slice 02: scroll-offset field on `TuiMonitorState`, who mutates it, and scroll-into-view
  on selection — pin when entry navigation wires scroll offset.
- No production `setInvert*ForTest` / `invert*ForTest` hooks — rules out test-only bypasses in
  monitor-lines viewport wiring.

## Acceptance criteria

- [x] `tui-monitor-lines.test.ts` — with more terminal pipelines than fit the pane,
      `monitorSelectableNodeIds` includes every tree row id from the full flatten while painted tree
      rows stay within the pane budget; fails pre-fix.
- [x] `tui-monitor-lines.test.ts` — tree row ids beyond the pane budget remain in
      `monitorSelectableNodeIds` and are absent from the painted slice only; fails pre-fix.
- [x] `tui-monitor-lines.test.ts` — deriving `monitorSelectableNodeIds` from FIFO-trimmed or
      viewport-sliced `displayNodes` turns the overflow retention pin RED; `Mutation checkpoint:` on
      that pin names that derivation.
- [x] `tui-monitor-lines.test.ts` — omitting unattributed rows from `monitorSelectableNodeIds`
      turns `lists visible tree rows then unattributed runs in pane order` RED; existing
      `Mutation checkpoint:` preserved.
- [x] `tui-monitor-lines.test.ts` — off-pane tree row selection resolves right-pane pipeline or
      stage detail from the full flatten; resolving from painted `treeRows` only turns the
      off-pane right-pane detail pin RED; `Mutation checkpoint:` on that pin names painted-only
      lookup.
- [x] `tui-entry.test.tsx` — `aligns selectable node ids with left-pane tree rows for the measured
      terminal size` fails pre-fix (every selectable id required in painted rows) and passes after
      the pin update (selected id in painted rows; off-pane selectables may be absent from paint);
      no scroll-follow during navigation walks.
- [x] `tui-entry.test.tsx` — requiring every `monitorSelectableNodeIds` entry in painted rows turns
      `aligns selectable node ids with left-pane tree rows for the measured terminal size` RED;
      `Mutation checkpoint:` on that pin names that requirement.
- [x] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

None — operator-facing pane semantics ship with entry navigation.

## Prerequisites

- `tui-pipeline-tree-retain-full-flatten` merged: `flattenMonitorPipelineTree` returns every
  flattened display node regardless of `maxVisibleRows` overflow; idle-FIFO and paint-only trimming
  deferred to this slice.
- Reveal-on-select expands ancestors only; `expandedNodeIds` membership changes flatten output
  bidirectionally for a selected pipeline or stage.
- `currentState` carries measured `terminalColumns` and `terminalRows` for `monitorSelectableNodeIds`.
