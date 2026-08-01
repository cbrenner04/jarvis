---
name: tui-monitor-scroll-viewport-selectables
---

# Monitor separates full selectables from scroll viewport paint

**Serial order:** runs after `tui-pipeline-tree-retain-full-flatten` (00), before `tui-entry-reversible-descend-navigation` (02).

`monitorSelectableNodeIds` and painted left-pane tree rows both derive from the same FIFO-trimmed
`buildMonitorPipelineTree` output, so evicted pipelines leave walk order and rows beyond the pane
budget are unreachable.

## Problem

When flatten drops pipelines to fit `maxVisibleRows`, `monitorSelectableNodeIds` omits those ids.
Operators cannot `j`/`k` to off-screen rows, and selection can fall through when the selected
pipeline is trimmed from the list.

## Decisions

- `monitorSelectableNodeIds` walks the full flattened tree plus unattributed rows — rules out reusing a FIFO-trimmed `displayNodes` list for navigation order.
- Painted left-pane tree rows are a viewport window over the full flattened list bounded by pane height — rules out fitting the tree by dropping nodes from flatten.
- Deferred to first consumer: scroll-offset field on `TuiMonitorState` and who mutates it — pin when entry navigation wires scroll-into-view.

## Acceptance criteria

- [ ] `tui-monitor-lines.test.ts` — with more terminal pipelines than fit the pane, `monitorSelectableNodeIds` includes every pipeline id from the full flatten while painted tree rows stay within the pane budget; fails pre-fix.
- [ ] `tui-monitor-lines.test.ts` — rows beyond the pane budget remain in `monitorSelectableNodeIds` and are absent from the painted slice only; fails pre-fix.
- [ ] `tui-monitor-lines.test.ts` — omitting unattributed rows from `monitorSelectableNodeIds` turns the tree+unattributed navigation pin RED; existing `Mutation checkpoint:` preserved.
- [ ] `tui-entry.test.tsx` — inverting `aligns selectable node ids with left-pane tree rows for the measured terminal size` (requiring every selectable id in painted rows) turns RED once off-pane selectables are retained; update that pin in this slice.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

None — operator-facing pane semantics ship with entry navigation.

## Prerequisites

- Today: `flattenMonitorPipelineTree` FIFO-drops terminal pipelines when expanded rows exceed `maxVisibleRows`.
- Today: `monitorSelectableNodeIds` and painted left-pane tree rows both derive from the same FIFO-trimmed `buildMonitorPipelineTree` output.
- Reveal-on-select expands ancestors only; `expandedNodeIds` membership changes flatten output bidirectionally for a selected pipeline or stage.
- `currentState` carries measured `terminalColumns` and `terminalRows` for `monitorSelectableNodeIds`.
