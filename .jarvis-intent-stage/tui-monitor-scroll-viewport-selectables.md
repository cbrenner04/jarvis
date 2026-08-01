---
name: tui-monitor-scroll-viewport-selectables
---

# Monitor separates full selectables from scroll viewport paint

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
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

None — operator-facing pane semantics ship with entry navigation.

## Prerequisites

- `flattenMonitorPipelineTree` returns every flattened display node for the current expansion and selection inputs regardless of `maxVisibleRows` overflow.
- Reveal-on-select expands ancestors only; `expandedNodeIds` membership changes flatten output bidirectionally for a selected pipeline or stage.
- `currentState` carries measured `terminalColumns` and `terminalRows` for `monitorSelectableNodeIds`.
