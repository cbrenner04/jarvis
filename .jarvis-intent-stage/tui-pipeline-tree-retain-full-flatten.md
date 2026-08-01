---
name: tui-pipeline-tree-retain-full-flatten
---

# Pipeline tree retains full flattened output

`flattenMonitorPipelineTree` iteratively calls `dropOldestTerminalPipeline` when expanded rows exceed
`maxVisibleRows`, permanently removing terminal pipelines from flatten output. Descend-persisted
expansion grows the tree during `j` walks, so pipelines evicted mid-navigation never return on `k`.

## Problem

Navigation-time expansion inflates the flattened row list past the pane budget; FIFO trimming drops
terminal pipelines from `displayNodes`. Those ids cannot reappear while their expansions remain in
`expandedPipelineNodeIds`, so walking a long tree destroys the top.

## Decisions

- `flattenMonitorPipelineTree` returns every flattened display node for the current expansion and selection inputs regardless of `maxVisibleRows` overflow — rules out iterative `dropOldestTerminalPipeline` trimming on navigation-inflated trees.
- FIFO eviction of unselected, uninvolved terminal pipelines remains valid only when the operator is not navigating — rules out removing idle retention entirely.
- Deferred to first consumer: idle-FIFO trigger and how `maxVisibleRows` participates in paint-only trimming — pin when monitor-lines wires the viewport slice.

## Acceptance criteria

- [ ] `tui-monitor-pipeline-tree.test.ts` — an expanded tree exceeding `maxVisibleRows` still returns every pipeline id in flatten output; fails pre-fix when FIFO drops terminals during overflow.
- [ ] `tui-monitor-pipeline-tree.test.ts` — inverting full-flatten retention (re-enabling navigation-time `dropOldestTerminalPipeline`) turns the overflow retention pin RED; `Mutation checkpoint:` names that inversion.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

None — operator-facing scroll contract ships with monitor-lines and entry integration.

## Prerequisites

- `flattenMonitorPipelineTree` joins pipeline snapshots to run rows with `expandedNodeIds`, `selectedNodeId`, and `maxVisibleRows`.
- Reveal-on-select expands ancestors only; `expandedNodeIds` membership changes flatten output bidirectionally for a selected pipeline or stage.
- Terminal pipelines order oldest-first; active pipelines are never dropped during FIFO trimming.
