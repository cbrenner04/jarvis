# Pipeline tree expansion and viewport

Collapse, reveal-on-select, pipeline ordering, and terminal FIFO viewport trimming on top of the
join model in [01](./01-pipeline-tree-join-and-display-nodes.md). Still pure — no ink or RPC.

## Problem

Joined nodes need expansion-aware flattening, selection-driven ancestor reveal, and display-only
terminal retention when the expanded tree exceeds pane height.

## Prerequisites

- [01 - Pipeline tree join and display nodes](./01-pipeline-tree-join-and-display-nodes.md) merged — join model and row helpers exist.

## Decisions

- Builder input adds `expandedNodeIds`, `selectedNodeId`, and `maxVisibleRows` (pane body row budget) — rules out mutating pipeline snapshots or run inputs.
- Collapsed pipeline (`id` absent from `expandedNodeIds`) hides its stage and run descendants — rules out showing stages while the pipeline marker reads collapsed.
- Collapsed stage hides only its run descendants; the stage row stays visible — rules out hiding the stage row itself.
- Reveal-on-select unions ancestor ids of `selectedNodeId` into the effective expansion set; siblings stay collapsed — rules out expanding peer pipelines or stages.
- Pipeline order: non-terminal snapshots first by `createdAt` ascending, then terminal snapshots by `finishedAtMs` ascending — rules out finish-time sort among actives or `createdAt` sort among terminals.
- When flattened visible rows exceed `maxVisibleRows`, drop terminal pipelines oldest-by-`finishedAtMs` first until within budget; every non-terminal pipeline is retained — rules out row-level drops, active drops, or input mutation.
- FIFO trimming is display-only — rules out store mutation or the run monitor's 1h / 20-row window on attributed runs.
- Tests stay on tree-model flatten output — rules out painted ink assertions.

## Tasks

- Add `flattenMonitorPipelineTree` (or equivalent) taking join output plus expansion/selection/viewport
  inputs and returning ordered visible display nodes.
- Implement effective expansion (manual `expandedNodeIds` ∪ ancestors of selection).
- Implement terminal-pipeline FIFO drop on overflow without mutating inputs.
- Extend `tui-monitor-pipeline-tree.test.ts` for collapse, reveal-on-select, ordering pins, and FIFO
  drop with immutable input snapshots.
- Add guard-inversion comment checkpoints on pinning tests naming collapse, reveal, ordering, and
  FIFO guards.

## Acceptance criteria

- [ ] `tui-monitor-pipeline-tree.test.ts` — a collapsed pipeline omits its stage and run descendants; a collapsed stage omits only its runs; fails against the pre-fix absent flatten path.
- [ ] `tui-monitor-pipeline-tree.test.ts` — selecting a descendant expands ancestors only and leaves sibling pipelines/stages collapsed; fails against the pre-fix absent flatten path.
- [ ] `tui-monitor-pipeline-tree.test.ts` — actives order above terminals by `createdAt` then `finishedAtMs` respectively; fails against the pre-fix absent flatten path.
- [ ] `tui-monitor-pipeline-tree.test.ts` — with more terminal pipelines than `maxVisibleRows` allows, the oldest-finished terminal pipeline is omitted from output while every active pipeline remains and input snapshots/runs are unchanged; inverting the active-retention guard turns the test RED.
- [ ] `tui-monitor-pipeline-tree.test.ts` — pinning tests include comment checkpoints naming guard-inversion mutations for pipeline collapse, stage collapse, reveal-on-select, ordering, and terminal FIFO drop.
- [ ] Source-mutating each guard above (pipeline collapse, stage collapse, reveal-on-select, ordering partition, active retention on FIFO) turns the corresponding pinning test RED. Do **not** add a production test flag. (Manual)
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

None — operator-facing nesting docs ship with monitor integration.
