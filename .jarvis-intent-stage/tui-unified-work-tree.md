---
name: tui-unified-work-tree
---

# One work tree: ad-hoc runs are top-level nodes

## Problem

Ad-hoc `run workflow …` launches are a permanent, roughly half-the-volume flow, but they render in a second-class `─ Unattributed (N) ─` segment below the pipeline tree. The segment has two structural bugs. Selection is windowed to painted rows: `monitorSelectableNodeIds` consumes the post-eviction `unattributedRows`, so expanding a pipeline shrinks the segment budget and silently deletes runs from navigation. And `retainUnattributedSegmentFifo` treats finishless terminals as unevictable must-keeps, so at small budgets they crowd out everything else. The pipeline tree solved this exact class of bug with full-flatten + scroll viewport (#2485); the segment reintroduced it (#2693).

## Decisions

- The left pane is one work tree. A top-level node is a pipeline or an ad-hoc work item — a workflow invocation group with its constituent runs; a bare run degenerates to a single row. Rules out the segment, its heading, and its count.
- Ad-hoc items sort into the same top-level buckets as pipelines; an item is running when any member is live or active, and gated never applies to an ad-hoc item. Rules out a second ordering rule for ad-hoc work.
- All rows are selectable through the tree's existing full-flatten + viewport; `retainUnattributedSegmentFifo`, `leftPaneUnattributedBodyRowBudget`, and `unattributedLeftPaneHeading` are deleted with their tests. Rules out painted-row-windowed selection anywhere, and rules out porting FIFO retention onto the merged list.
- Ad-hoc item label and identity come from the entry run's existing row model, with workflow-collapse grouping unchanged. Rules out a new wire field or a synthesized item id.
- Right-pane detail for a selected ad-hoc run is run detail with no pipeline context. Rules out the nearest-preceding-pipeline lookup attaching a pipeline's context to an ad-hoc item that sorts below it.
- The `unattributed` dock feedback code disappears and ad-hoc run rows classify as `run_leaf`: `kill` / `pause` / `resume-run` / `log` admit them, `expand` / `approve` / `reject` / `resume` refuse them as run leaves. Rules out a first-class row that run steering still refuses.
- The queue segment is unchanged.

## Acceptance criteria

- [ ] A pure builder maps `(pipeline snapshots, run rows, expansion set, selection)` to one ordered top-level node list holding pipelines and ad-hoc work items, and a run matching a pipeline stage's `workflowInvocationId` appears only under that stage: `tui-monitor-pipeline-tree.test.ts` test `pipelines and ad-hoc work items share one ordered top-level list` fails against the pre-fix code.
- [ ] Selectable node ids equal the full flattened row list — an ad-hoc run painted in no viewport is still reachable by navigation: `tui-monitor-lines.test.ts` test `selectable node ids equal the full flattened row list` pins more rows than the pane height and fails against the pre-fix code.
- [ ] `retainUnattributedSegmentFifo`, `leftPaneUnattributedBodyRowBudget`, `unattributedLeftPaneHeading`, and `monitorLeftPaneUnattributedSegmentRows` are absent from the source, and their tests are deleted rather than retargeted.
- [ ] Right-pane detail for a selected ad-hoc run renders run detail with no pipeline context even when the item sorts below a pipeline: `tui-monitor-lines.test.ts` test `ad-hoc run detail carries no pipeline context` fails against the pre-fix code.
- [ ] `kill` on a selected live ad-hoc run issues the daemon RPC instead of reporting `unattributed`: `tui-entry.test.tsx` test `kill admits a selected live ad-hoc run` fails against the pre-fix code.
- [ ] Mutation checkpoint: in `tui-monitor-lines.test.ts` test `selectable node ids equal the full flattened row list`, a `// @mutate` directive narrowing selectable ids back to the painted viewport turns that regression RED.
- [ ] `bun run typecheck`, `bun run check`, and `bun run test:v2` pass. Tree, selection, and command-admission behavior is proven through pure builders and production monitor state, not rendered-ink assertions (`v2/docs/test-writing.md` § TUI test strategy).

## Documentation updates

- `v2/docs/operator-runbook.md` § Observe — one work tree with ad-hoc runs as first-class top-level rows; drop the `─ Unattributed (N) ─` heading and its FIFO retention paragraph, and drop the `unattributed` rows from the expansion, pipeline-steering, and run-steering feedback-code tables.
- `v2/docs/v1-behaviors.md` § TUI / observability — replace the unattributed-segment retention entry with unified-tree membership, selection, and run-steering admission.

## Prerequisites

- Top-level rows sort running → awaiting gate → terminal, with terminals newest finish first and finishless terminals by `createdAt`.
- The top-level comparator keys off per-item derived fields rather than `PipelineSnapshot` fields, so non-pipeline items can be ordered by the same rule.
- Fan-out order: lands after `tui-work-tree-top-level-ordering`, before `tui-intent-branch-subtree` and `tui-work-row-anatomy`.
- `buildWorkflowTableRows` collapses one workflow invocation into a single row carrying its constituent members.
- `isUnattributedCandidate` identifies non-queued runs whose invocation matches no pipeline stage.
- The left-pane tree flattens fully and scrolls a viewport over it (`withLeftPaneTreeScrollFollow`), independent of pane height.
- `tui-entry.tsx` classifies selections for expansion, pipeline steering, and run steering with the `run_leaf` and `unattributed` feedback codes.
