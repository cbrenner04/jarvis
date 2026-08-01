# Monitor scroll viewport selectables

`monitorSelectableNodeIds` and painted left-pane tree rows both derive from the same
FIFO-trimmed `buildMonitorPipelineTree` output, so evicted pipelines leave walk order and rows
beyond the pane budget are unreachable.

## Problem

When flatten or paint fitting drops pipelines to satisfy `maxVisibleRows`, `monitorSelectableNodeIds`
omits those ids. Operators cannot `j`/`k` to off-screen rows, and selection can fall through when
the selected pipeline is trimmed from the list.

## Decisions

- `monitorSelectableNodeIds` walks the full flattened tree plus unattributed rows — rules out reusing a FIFO-trimmed or viewport-sliced `displayNodes` list for navigation order.
- Painted left-pane tree rows are a viewport window over the full flattened list bounded by pane height — rules out fitting the tree by dropping nodes from flatten or from the selectable walk.
- Paint viewport without scroll offset shows the top `maxVisibleRows` rows of the full flatten — rules out selection-anchored or scroll-offset viewport in this slice.
- `monitorSelectableNodeIds` and painted rows share measured `terminalColumns`/`terminalRows` on the same state object — rules out selectable order at fallback 245×72 while ink paints measured size.
- Full flatten and viewport slice use the same `expandedNodeIds` and `selectedNodeId` inputs — rules out navigation walking a different expansion state than paint.
- Deferred to first consumer: scroll-offset field on `TuiMonitorState` and who mutates it — pin when entry navigation wires scroll-into-view.
- No production `setInvert*ForTest` / `invert*ForTest` hooks — rules out test-only bypasses in monitor-lines viewport wiring.

## Prerequisites

- `tui-pipeline-tree-retain-full-flatten` merged: `flattenMonitorPipelineTree` returns every flattened display node regardless of `maxVisibleRows` overflow.
- Reveal-on-select expands ancestors only; `expandedNodeIds` membership changes flatten output bidirectionally for a selected pipeline or stage.
- `currentState` carries measured `terminalColumns` and `terminalRows` for `monitorSelectableNodeIds`.

## Tasks

- Derive full flattened tree rows once per snapshot; build `monitorSelectableNodeIds` from that list
  plus unattributed run ids in pane order.
- Slice painted left-pane tree rows to `maxVisibleRows` from the full flatten (top window until slice
  02 adds scroll offset).
- Add `tui-monitor-lines.test.ts` overflow fixture: more terminal pipelines than fit the pane;
  `monitorSelectableNodeIds` includes every pipeline id from the full flatten while painted `treeRows`
  length stays within the pane budget.
- Add `tui-monitor-lines.test.ts` pin: ids beyond the pane budget appear in `monitorSelectableNodeIds`
  and are absent from painted `treeRows` only.
- Add `Mutation checkpoint:` on the overflow pin naming reuse of FIFO-trimmed or viewport-sliced
  `displayNodes` for `monitorSelectableNodeIds`.
- Preserve existing `Mutation checkpoint:` on `lists visible tree rows then unattributed runs in pane
  order`; omitting unattributed rows from `monitorSelectableNodeIds` must still turn that pin RED.
- Update `tui-entry.test.tsx` `aligns selectable node ids with left-pane tree rows for the measured
  terminal size`: require every selectable id in painted rows only while selected; off-pane
  selectables may be absent from the painted slice; add `Mutation checkpoint:` naming reversion to
  requiring every selectable id in painted rows.
- Run `bun run typecheck` and `bun run test:v2`.

## Acceptance criteria

- [ ] `tui-monitor-lines.test.ts` — with more terminal pipelines than fit the pane,
      `monitorSelectableNodeIds` includes every pipeline id from the full flatten while painted tree
      rows stay within the pane budget; fails pre-fix.
- [ ] `tui-monitor-lines.test.ts` — rows beyond the pane budget remain in `monitorSelectableNodeIds`
      and are absent from the painted slice only; fails pre-fix.
- [ ] `tui-monitor-lines.test.ts` — deriving `monitorSelectableNodeIds` from FIFO-trimmed or
      viewport-sliced `displayNodes` turns the overflow retention pin RED; `Mutation checkpoint:` on
      that pin names that derivation.
- [ ] `tui-monitor-lines.test.ts` — omitting unattributed rows from `monitorSelectableNodeIds`
      turns `lists visible tree rows then unattributed runs in pane order` RED; existing
      `Mutation checkpoint:` preserved.
- [ ] `tui-entry.test.tsx` — `aligns selectable node ids with left-pane tree rows for the measured
      terminal size` fails pre-fix (every selectable id required in painted rows) and passes after
      the pin update; selected id remains in the painted slice during forward/back walks.
- [ ] `tui-entry.test.tsx` — requiring every `monitorSelectableNodeIds` entry in painted rows turns
      `aligns selectable node ids with left-pane tree rows for the measured terminal size` RED;
      `Mutation checkpoint:` on that pin names that requirement.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

None — operator-facing pane semantics ship with entry navigation.
