---
name: tui-pipeline-tree-retain-full-flatten
---

# Pipeline tree retains full flattened output

**Serial order:** 00 (this) → `tui-monitor-scroll-viewport-selectables` → `tui-entry-reversible-descend-navigation`. Plan and run in that order; do not merge slice 02 before slice 01 lands.

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
- Interim full-flatten without paint-only viewport trimming is acceptable only until slice 01 lands; operator-facing docs ship in slice 02.
- Deferred to slice 01: idle-FIFO trigger and how `maxVisibleRows` participates in paint-only trimming.

## Acceptance criteria

- [ ] `tui-monitor-pipeline-tree.test.ts` — an expanded tree exceeding `maxVisibleRows` still returns every pipeline id in flatten output; fails pre-fix when FIFO drops terminals during overflow.
- [ ] `tui-monitor-pipeline-tree.test.ts` — inverting full-flatten retention (re-enabling navigation-time `dropOldestTerminalPipeline`) turns the overflow retention pin RED; `Mutation checkpoint:` names that inversion.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

None — operator-facing scroll contract ships with monitor-lines and entry integration.

## Prerequisites

- Today: `flattenMonitorPipelineTree` iteratively calls `dropOldestTerminalPipeline` when expanded rows exceed `maxVisibleRows`.
- `flattenMonitorPipelineTree` joins pipeline snapshots to run rows with `expandedNodeIds`, `selectedNodeId`, and `maxVisibleRows`.
- Reveal-on-select expands ancestors only; `expandedNodeIds` membership changes flatten output bidirectionally for a selected pipeline or stage.
- Terminal pipelines order oldest-first; active pipelines are never dropped during FIFO trimming.
