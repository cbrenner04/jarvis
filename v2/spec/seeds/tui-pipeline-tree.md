---
name: tui-pipeline-tree
---

# TUI slice 2 — pipeline tree in the left pane

Second slice of [tui-overhaul-brief.md](../tui-overhaul-brief.md), on top of the shell layout
(#2453, #2456). Elapsed columns (slice 3), detail-pane depth (slice 4), command parsing (slice 5),
and steering (slice 6) stay out of scope.

## Problem

The left pane renders a flat list of runs. The brief's command center nests
`pipeline → stage[branchKey] → run`, so an operator can see which stage a run belongs to without
cross-reading `jarvis pipeline list` and `jarvis run list` in two terminals. Nothing in the TUI
polls `pipeline_list` today.

## Decisions

- The TUI polls `pipeline_list` on the same refresh tick as `list`, against the same discovered daemons — rules out a second timer or a separate refresh cadence.
- Runs join stages by `workflowInvocationId` (the CLI mental model); a run with no matching stage stays in a separate segment — rules out inventing parentage.
- The unattributed segment renders in slice 2 with the existing flat rows; its FIFO/label polish is slice 6 — rules out dropping ad-hoc runs from view while pipelines exist.
- Tree node ids are `pipelineId`, `pipelineId + stageId + branchKey`, and `runId` — rules out stage identity that collides across fan-out branches.
- The `branch` column on a stage row shows `branchKey`, omitted when it is `default` — rules out a column of repeated `default`.
- The pipeline row's `project` is derived from its joined runs (first joined run's project), empty when none has joined — rules out a `pipeline_list` wire change in this slice.
- Selection is three deep and drives the right pane; the pane shows the selected node's existing fields only — rules out pulling slice 4's detail contract forward.
- `e` toggles expansion on the selected pipeline or stage row; run rows are leaves — rules out a second expansion keybinding.
- Reveal-on-select: ancestors of the selected node expand so it is visible; siblings stay collapsed. Active-path expand is optional if cheap — rules out a fully expanded default tree.
- Terminal pipelines fall off the pane oldest-first only when the expanded tree exceeds the pane height; active pipelines never fall off. Falling off is display-only — rules out the run monitor's 1h / 20-row window and any store mutation.
- Ordering: active pipelines first by `createdAt`, then terminal ones by finish time oldest-first.
- Tests assert tree-model and row-string functions plus injected-input keybindings; no painted ink assertions (`v2/docs/test-writing.md` § TUI test strategy).

## Acceptance criteria

- [ ] A pure tree builder maps `(pipeline snapshots, run rows, expansion set, selection)` to ordered display nodes with depth, node id, and kind; a run whose `workflowInvocationId` matches a stage nests under it.
- [ ] A run with no matching stage lands in the unattributed segment, not under a pipeline.
- [ ] Two fan-out stage records sharing a `stageId` but differing in `branchKey` produce two distinct nodes with distinct ids; a `default` branch renders an empty `branch` cell.
- [ ] Collapsing a pipeline hides its stage and run descendants; collapsing a stage hides only its runs.
- [ ] Selecting a descendant expands its ancestors and leaves siblings collapsed.
- [ ] With more terminal pipelines than the pane can show, the oldest-finished terminal pipeline is dropped from the display and every active pipeline is retained; the input snapshot is unmutated.
- [ ] Ordering pins: actives by `createdAt` ascending above terminals by finish time ascending.
- [ ] `e` through the injected input hook toggles the selected pipeline or stage node and is a no-op on a run leaf.
- [ ] The TUI issues `pipeline_list` once per refresh tick per connected daemon, and a `pipeline_list` RPC failure leaves the run rows rendered (degraded, not crashed).
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — `jarvis tui` observation row: pipeline nesting, expansion, and what the pane retains.
- `v2/docs/v1-behaviors.md` — `jarvis tui` entry records the pipeline tree.

## Prerequisites

- `v2/src/tui/tui-shell-layout.ts` — `computeShellLayout`, `visibleColumns`, `buildMonitorTreeRow`, `TREE_COLUMN_WIDTHS`
- `v2/src/daemon/pipeline-observation.ts` — `projectPipelineSnapshot` shape (`pipelineId`, `name`, `state`, stages with `stageId`/`branchKey`/`status`/`workflowInvocationId`)
- `v2/src/tui/tui-monitor-workflow-collapse.ts` — existing run/workflow row model
- `v2/spec/tui-overhaul-brief.md` § Left pane — retention, auto-expand, tree columns
