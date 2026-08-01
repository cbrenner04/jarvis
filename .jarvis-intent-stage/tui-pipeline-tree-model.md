---
name: tui-pipeline-tree-model
---

# TUI pipeline tree model

Pure pipeline→stage[branch]→run tree builder and row-cell projection for the left pane. No RPC, no ink,
no session keybindings.

## Problem

The left pane has run rows only. Slice 2 needs a pure model that joins daemon pipeline snapshots to
`list` runs and yields ordered, depth-tagged display nodes before polling or ink wiring land.

## Decisions

- Runs join stages by `workflowInvocationId`; unmatched runs stay in an unattributed segment — rules out inventing parentage.
- Tree node ids are `pipelineId`, `pipelineId + stageId + branchKey`, and `runId` — rules out stage identity that collides across fan-out branches.
- Stage rows show `branchKey` in the `branch` column, omitted when `default` — rules out a column of repeated `default`.
- Pipeline `project` derives from the first joined run's project, empty when none joined — rules out a `pipeline_list` wire change.
- Collapsing a pipeline hides stage and run descendants; collapsing a stage hides only its runs.
- Reveal-on-select expands ancestors of the selected node; siblings stay collapsed.
- Terminal pipelines fall off oldest-first only when the expanded tree exceeds pane height; actives never fall off; display-only — rules out store mutation or the run monitor's 1h / 20-row window.
- Ordering: active pipelines first by `createdAt` ascending, then terminals by finish time ascending.
- Tests assert tree-model and row-string functions only; no painted ink assertions (`v2/docs/test-writing.md` § TUI test strategy).

## Acceptance criteria

- [ ] A pure tree builder maps `(pipeline snapshots, run rows, expansion set, selection)` to ordered display nodes with depth, node id, and kind; a run whose `workflowInvocationId` matches a stage nests under it.
- [ ] A run with no matching stage lands in the unattributed segment, not under a pipeline.
- [ ] Two fan-out stage records sharing a `stageId` but differing in `branchKey` produce two distinct nodes with distinct ids; a `default` branch renders an empty `branch` cell.
- [ ] Collapsing a pipeline hides its stage and run descendants; collapsing a stage hides only its runs.
- [ ] Selecting a descendant expands its ancestors and leaves siblings collapsed.
- [ ] With more terminal pipelines than the pane can show, the oldest-finished terminal pipeline is dropped from the display and every active pipeline is retained; the input snapshot is unmutated.
- [ ] Ordering pins: actives by `createdAt` ascending above terminals by finish time ascending.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

None — operator-facing nesting docs ship with monitor integration.

## Prerequisites

- `computeShellLayout`, `visibleColumns`, `buildMonitorTreeRow`, and `TREE_COLUMN_WIDTHS` exist in `v2/src/tui/tui-shell-layout.ts`.
- `projectPipelineSnapshot` exposes `pipelineId`, `name`, `state`, and stages with `stageId`, `branchKey`, `status`, and `workflowInvocationId`.
- The run/workflow row model in `v2/src/tui/tui-monitor-workflow-collapse.ts` exists.
- `v2/spec/tui-overhaul-brief.md` § Left pane documents retention, auto-expand, and tree columns.
