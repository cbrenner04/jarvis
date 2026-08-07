---
name: tui-unified-work-tree
---

# TUI unified work tree — one surface for pipelines and ad-hoc runs

TUI command-center phase ([tui-command-center-brief.md](../tui-command-center-brief.md)). Row appearance is out of scope (`tui-work-row-anatomy`); this seed changes tree structure, selection, and retention.

## Problem

Ad-hoc `run workflow …` launches are a permanent, roughly half-the-volume flow, but they render in a second-class "Unattributed" segment below the pipeline tree. The segment has two structural bugs: selection is windowed to painted rows (`monitorSelectableNodeIds` consumes post-eviction `unattributedRows`, so expanding a pipeline shrinks the segment budget and silently deletes runs from navigation), and the FIFO (`retainUnattributedSegmentFifo`) treats finishless terminals as unevictable must-keeps that crowd out everything else at small budgets. The tree solved this exact class of bug with full-flatten + scroll viewport (#2485); the segment reintroduced it (#2693).

## Decisions

- The left pane is one work tree. A top-level node is a pipeline or an ad-hoc work item (a workflow invocation group with its constituent runs; a bare run degenerates to a single row). Rules out the segment, its heading, and its count.
- All rows are selectable via the same full-flatten + viewport the pipeline tree uses; `retainUnattributedSegmentFifo` and the segment body-budget functions are deleted. Rules out painted-row-windowed selection anywhere.
- Top-level ordering: running items (any live/active member, `createdAt` ascending) → pipelines awaiting a gate (`awaiting-approval` derived state) → terminal items (finish timestamp descending, newest nearest the fold). Rules out the current two-bucket active/terminal sort and oldest-first terminals.
- A terminal item with no finish timestamp sorts by `createdAt` within terminals; no display-side invention of finish times (data fix is `pipeline-terminal-timestamps`).
- Ad-hoc item label/identity: the entry run's existing row model (workflow-collapse grouping unchanged); no wire changes.
- The queue segment is unchanged.

## Acceptance criteria

- [ ] A pure builder maps `(pipeline snapshots, run rows, expansion set, selection)` to one ordered top-level node list containing both pipelines and ad-hoc work items; a run matching a pipeline stage's `workflowInvocationId` appears only under that stage.
- [ ] Selectable node ids equal the full flattened row list — a run visible in no painted viewport is still reachable by navigation, pinned with more rows than the pane height.
- [ ] Ordering pins: running before gated before terminal; terminals newest-finish-first; finishless terminals slot by `createdAt`.
- [ ] `retainUnattributedSegmentFifo`, `leftPaneUnattributedBodyRowBudget`, and `unattributedLeftPaneHeading` are removed along with their tests.
- [ ] Right-pane detail for a selected ad-hoc run renders identically to today (run detail without pipeline context).
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Observe — one work tree; ad-hoc runs are first-class rows, "Unattributed" is gone.

## Prerequisites

- `v2/src/tui/tui-monitor-pipeline-tree.ts` — `buildMonitorPipelineTree`, `buildMonitorPipelineTreeJoin`, `isUnattributedCandidate`
- `v2/src/tui/tui-monitor-lines.ts` — `monitorSelectableNodeIds`, `monitorLeftPaneTreeRows`, `retainUnattributedSegmentFifo`
- `v2/src/tui/tui-monitor-workflow-collapse.ts` — invocation grouping, `isActiveRunStatus`
- `v2/docs/test-writing.md` § TUI test strategy
