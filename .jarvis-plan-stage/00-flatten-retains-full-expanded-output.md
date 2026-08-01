# Flatten retains full expanded output

`flattenMonitorPipelineTree` iteratively calls `dropOldestTerminalPipeline` when expanded rows exceed
`maxVisibleRows`, permanently removing terminal pipelines from flatten output. Descend-persisted
expansion grows the tree during `j` walks, so pipelines evicted mid-navigation never return on `k`.

## Problem

Navigation-time expansion inflates the flattened row list past the pane budget; FIFO trimming drops
terminal pipelines from `displayNodes`. Those ids cannot reappear while their expansions remain in
`expandedPipelineNodeIds`, so walking a long tree destroys the top.

## Decisions

- `flattenMonitorPipelineTree` returns every flattened display node for the current expansion and selection inputs regardless of `maxVisibleRows` overflow — rules out iterative `dropOldestTerminalPipeline` trimming on navigation-inflated trees.
- `maxVisibleRows` stays on `flattenMonitorPipelineTree` / `buildMonitorPipelineTree` signatures but does not trim flatten output in this slice — rules out removing the parameter before slice 01 defines paint-only use.
- FIFO eviction of unselected, uninvolved terminal pipelines when the operator is not navigating — deferred to slice 01 (`tui-monitor-scroll-viewport-selectables`).
- Interim full-flatten without paint-only viewport trimming until slice 01 lands — rules out viewport paint slicing in this slice.
- Deferred to slice 01: idle-FIFO trigger and how `maxVisibleRows` participates in paint-only trimming.
- `dropOldestTerminalPipeline` may remain unused until slice 01 idle-FIFO wiring or be removed if lint requires — rules out re-homing idle FIFO into flatten in this slice.
- No production `setInvert*ForTest` / `invert*ForTest` hooks — rules out test-only bypasses in flatten retention.

## Prerequisites

- `flattenMonitorPipelineTree` iteratively calls `dropOldestTerminalPipeline` when expanded rows exceed `maxVisibleRows`.
- `flattenMonitorPipelineTree` joins pipeline snapshots to run rows with `expandedNodeIds`, `selectedNodeId`, and `maxVisibleRows`.
- Reveal-on-select expands ancestors only; `expandedNodeIds` membership changes flatten output bidirectionally for a selected pipeline or stage.
- Terminal pipelines order oldest-first; active pipelines are never dropped during FIFO trimming.
- Must land before `tui-monitor-scroll-viewport-selectables` and `tui-entry-reversible-descend-navigation`; do not merge slice 02 before slice 01 lands.

## Tasks

- Remove the `flattenMonitorPipelineTree` overflow loop that iteratively calls `dropOldestTerminalPipeline`; return the full flattened list for effective expansion and selection inputs.
- Replace `flattenMonitorPipelineTree viewport FIFO` pin `iteratively drops oldest terminal pipelines until within maxVisibleRows while retaining actives` with overflow retention regression `expanded tree exceeding maxVisibleRows retains every pipeline id` (expanded multi-terminal fixture, `maxVisibleRows` below flatten row count; every pipeline id present).
- Add `Mutation checkpoint:` on the overflow retention pin naming re-enabling navigation-time `dropOldestTerminalPipeline` trimming in `flattenMonitorPipelineTree`.
- Reconcile `excludes collapsed pipeline subtrees from maxVisibleRows counting under terminal pressure`: update or remove stale `maxVisibleRows`-counting checkpoint; collapse describe pins stay green.
- Reconcile `tui-entry.test.tsx` `aligns selectable node ids with left-pane tree rows for the measured terminal size`: interim full-flatten may paint more rows than pane height; relax `initialTreeRows.length` and trimmed-pipeline-count pins until slice 01 viewport paint; `assertSelectionPainted` and navigation pins stay green.
- Run `bun run typecheck` and `bun run test:v2`.

## Acceptance criteria

- [ ] `tui-monitor-pipeline-tree.test.ts` — `expanded tree exceeding maxVisibleRows retains every pipeline id` fails pre-fix when FIFO drops terminals during overflow and passes after; expanded multi-terminal fixture returns every pipeline id in flatten output.
- [ ] `tui-monitor-pipeline-tree.test.ts` — mutating `flattenMonitorPipelineTree` to re-enable navigation-time `dropOldestTerminalPipeline` trimming turns the overflow retention pin RED; `Mutation checkpoint:` names that inversion.
- [ ] `tui-monitor-pipeline-tree.test.ts` — `flattenMonitorPipelineTree collapse`, `flattenMonitorPipelineTree reveal-on-select`, and `flattenMonitorPipelineTree ordering` pins stay green.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

None — operator-facing scroll contract ships with monitor-lines and entry integration.
