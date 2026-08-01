---
name: tui-pipeline-tree-monitor
---

# TUI pipeline tree monitor

Wire the pipeline tree into the ink monitor: left-pane nesting, three-deep selection driving the
right pane, and `e` expansion on pipeline and stage rows.

## Problem

The shell renders flat run rows. Operators cannot see which pipeline stage a run belongs to without
cross-reading `jarvis pipeline list` and `jarvis run list`.

## Decisions

- Selection is three deep and drives the right pane; the pane shows the selected node's existing fields only — rules out pulling slice 4's detail contract forward.
- `e` toggles expansion on the selected pipeline or stage row; run rows are leaves — rules out a second expansion keybinding.
- `e` replaces `expandedWorkflowInvocationIds` for nested runs — stage expansion shows workflow constituent runs; no dual collapse state on the same key.
- Tree build uses full merged `list` runs for pipeline matching; `filterMonitorRunsForLiveWindow` applies only to unattributed runs — rules out the 1h/20-row window on pipeline-attributed runs.
- The unattributed segment renders with existing flat rows; FIFO/label polish is slice 6 — rules out dropping ad-hoc runs while pipelines exist.
- Tests assert keybindings through the injected input hook; no painted ink assertions (`v2/docs/test-writing.md` § TUI test strategy).

## Acceptance criteria

- [ ] The left pane renders nested pipeline, stage, and run rows with depth indentation from the tree model; unmatched runs render in the flat unattributed segment.
- [ ] Selecting a pipeline, stage, or run row drives the right pane with that node's existing fields only.
- [ ] `e` through the injected input hook toggles the selected pipeline or stage node, is a no-op on a run leaf, and does not toggle `expandedWorkflowInvocationIds`.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — `jarvis tui` observation row: pipeline nesting, expansion, and what the pane retains.
- `v2/docs/v1-behaviors.md` — `jarvis tui` entry records the pipeline tree.

## Prerequisites

- A pure tree builder maps pipeline snapshots and run rows to ordered display nodes with depth, node id, and kind.
- Runs join stages by `workflowInvocationId`; unmatched runs land in the unattributed segment.
- Fan-out stages produce distinct branch-scoped node ids; a `default` branch renders an empty `branch` cell.
- Collapsing a pipeline hides stage and run descendants; collapsing a stage hides only its runs.
- Selecting a descendant expands ancestors and leaves siblings collapsed.
- Terminal pipelines fall off oldest-first when the expanded tree exceeds pane height; every active pipeline is retained; the input snapshot is unmutated.
- Active pipelines order above terminals by `createdAt` then finish time respectively.
- The TUI issues `pipeline_list` once per refresh tick per connected daemon; on RPC failure run rows stay rendered and each daemon retains its last-good pipeline snapshot.
- The ink command-center shell renders run rows left, detail right, and a 4-line dock.
