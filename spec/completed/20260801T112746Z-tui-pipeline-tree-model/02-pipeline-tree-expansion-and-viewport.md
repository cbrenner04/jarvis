# Pipeline tree expansion and viewport

Collapse, reveal-on-select, pipeline ordering, and terminal FIFO viewport trimming on top of the
join model in [01](./01-pipeline-tree-join-and-display-nodes.md). Still pure — no ink or RPC.

## Problem

Joined nodes need expansion-aware flattening, selection-driven ancestor reveal, and display-only
terminal retention when the expanded tree exceeds pane height.

## Prerequisites

- [01 - Pipeline tree join and display nodes](./01-pipeline-tree-join-and-display-nodes.md) merged — join model and row helpers exist.

## Decisions

- Composed entrypoint `(snapshots, runs, expandedNodeIds, selectedNodeId, maxVisibleRows)` wraps join then flatten — rules out callers stitching two modules for the intent contract.
- `expandedNodeIds` is caller-supplied; this module defines no default — rules out implicit expand-all.
- Effective expansion = `expandedNodeIds ∪ ancestors(selectedNodeId)`; selection forces ancestor visibility — rules out selection being ignored when a node is collapsed.
- Collapsed pipeline (`id` absent from effective expansion) hides its stage and run descendants — rules out showing stages while the pipeline marker reads collapsed.
- Collapsed stage hides only its run descendants; the stage row stays visible — rules out hiding the stage row itself.
- Reveal-on-select unions ancestor ids of `selectedNodeId` into the effective expansion set; siblings stay collapsed — rules out expanding peer pipelines or stages.
- Pipeline order: non-terminal snapshots first by `createdAt` ascending, then terminal snapshots by `finishedAtMs` ascending — rules out finish-time sort among actives or `createdAt` sort among terminals.
- `maxVisibleRows` counts visible flattened display nodes after join+flatten; collapsed descendants excluded; unattributed rows outside pipeline FIFO scope — rules out counting hidden subtrees or pre-join snapshot filtering.
- FIFO operates on flatten output only — snapshots are not pre-filtered before join.
- When flattened visible rows exceed `maxVisibleRows`, drop terminal pipelines oldest-by-`finishedAtMs` first until within budget; every non-terminal pipeline is retained — rules out row-level drops, active drops, or input mutation.
- FIFO trimming is display-only — rules out store mutation or the run monitor's 1h / 20-row window on attributed runs.
- Tests stay on tree-model flatten output — rules out painted ink assertions.

## Tasks

- Add `buildMonitorPipelineTree` (or equivalent) composing join output with `flattenMonitorPipelineTree`
  expansion/selection/viewport inputs and returning ordered visible display nodes.
- Implement effective expansion (`expandedNodeIds ∪ ancestors(selectedNodeId)`).
- Implement terminal-pipeline FIFO drop on overflow without mutating inputs.
- Extend `tui-monitor-pipeline-tree.test.ts` for collapse, reveal-on-select, ordering pins, iterative
  FIFO drop, collapse+overflow interaction, composed entrypoint, and immutable input snapshots.
- Add guard-inversion comment checkpoints on pinning tests naming collapse, reveal, ordering, and
  FIFO guards.

## Acceptance criteria

- [x] `tui-monitor-pipeline-tree.test.ts` — `buildMonitorPipelineTree` maps `(snapshots, runs, expandedNodeIds, selectedNodeId, maxVisibleRows)` to ordered display nodes with `kind`, `id`, and `depth`; fails against the pre-fix absent composed entrypoint.
- [x] `tui-monitor-pipeline-tree.test.ts` — a collapsed pipeline omits its stage and run descendants; a collapsed stage omits only its runs; fails against the pre-fix absent flatten path.
- [x] `tui-monitor-pipeline-tree.test.ts` — selecting a descendant expands ancestors only and leaves sibling pipelines/stages collapsed; fails against the pre-fix absent flatten path.
- [x] `tui-monitor-pipeline-tree.test.ts` — actives order above terminals by `createdAt` then `finishedAtMs` respectively; fails against the pre-fix absent flatten path.
- [x] `tui-monitor-pipeline-tree.test.ts` — when overflow exceeds one terminal pipeline's subtree, iterative oldest-terminal removal continues until flattened rows are within `maxVisibleRows` while every active pipeline remains and input snapshots/runs are unchanged; inverting the active-retention guard turns the test RED.
- [x] `tui-monitor-pipeline-tree.test.ts` — a collapsed pipeline subtree is excluded from `maxVisibleRows` counting; under budget pressure with multiple terminals, oldest terminals drop while collapsed subtrees do not inflate the count; fails against the pre-fix absent flatten path.
- [x] `tui-monitor-pipeline-tree.test.ts` — pinning tests include comment checkpoints naming guard-inversion mutations for pipeline collapse, stage collapse, reveal-on-select, ordering, and terminal FIFO drop.
- [x] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

None — operator-facing nesting docs ship with monitor integration.
