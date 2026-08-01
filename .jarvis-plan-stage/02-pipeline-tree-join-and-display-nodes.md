# Pipeline tree join and display nodes

Pure pipeline → stage[branch] → run join and flat display-node projection. No ink, no RPC, no
viewport FIFO — sibling [02](./02-pipeline-tree-expansion-and-viewport.md).

## Problem

The left pane has run rows only. Slice 2 needs a pure model that joins daemon pipeline snapshots to
merged `list` runs and yields depth-tagged nodes before polling or ink wiring land.

## Prerequisites

- [00 - Pipeline snapshot ordering timestamps](./00-pipeline-snapshot-ordering-timestamps.md) merged — `PipelineSnapshot` carries `createdAt`, `finishedAtMs`, and branch-keyed stages.

## Decisions

- Module at `v2/src/tui/tui-monitor-pipeline-tree.ts` colocated with `tui-monitor-pipeline-tree.test.ts` — rules out ink-coupled layout code.
- Runs join stages by `workflow.workflowInvocationId` === stage `workflowInvocationId` — rules out inventing parentage from project or name.
- Unmatched runs (no stage on any snapshot) land in an `unattributed` segment after pipeline rows — rules out nesting orphans under a pipeline.
- Matched runs nest under their stage and are excluded from `unattributed` — rules out flat-list retention alongside tree nesting.
- Tree build consumes the full merged `list` run set for matching; `filterMonitorRunsForLiveWindow` applies only to the `unattributed` segment — rules out the 1h/20-row window on pipeline-attributed runs.
- Node ids: `pipelineId`; `${pipelineId}:${stageId}:${branchKey}` for stages; `runId` for run leaves — rules out `stageId`-only ids that collide across fan-out branches.
- Pipeline `project` derives from the first joined run's `project` under that pipeline, empty when none joined — rules out a `project` wire field on `pipeline_list`.
- Stage `branch` cell value is `branchKey` except `default` renders empty — rules out a column of repeated `default`.
- Run leaves under a stage reuse `buildWorkflowTableRows` / `buildMonitorTreeRow` from existing workflow collapse — rules out a second run-row formatter.
- Tests assert tree-model and row-string helpers only — rules out painted ink assertions ([test-writing.md § TUI test strategy](../../docs/test-writing.md#tui-test-strategy)).
- Deferred to first consumer: segment header row strings (`Unattributed`, counts) — pin when monitor integration wires the left pane.

## Tasks

- Add display-node types (`kind`, `id`, `depth`, pipeline/stage/run payloads) and a pure builder
  `(snapshots, runs) → { pipelineNodes, unattributedRows }` without expansion or viewport logic.
- Implement stage fan-out as one node per `(stageId, branchKey)`; nest matching workflow groups under
  each stage via `buildWorkflowTableRows`.
- Add `stageBranchCellValue(branchKey)` (or equivalent) and pipeline/stage row-string helpers that
  reserve column widths via `TREE_COLUMN_WIDTHS` / `buildMonitorTreeRow` patterns.
- Filter `unattributed` candidates through `filterMonitorRunsForLiveWindow` after excluding
  stage-matched runs.
- Add `tui-monitor-pipeline-tree.test.ts` with fixtures for join, fan-out ids, default-branch cell,
  and unattributed window filtering.
- Add guard-inversion comment checkpoints on pinning tests naming join, fan-out id, and unattributed
  exclusion guards.

## Acceptance criteria

- [ ] `tui-monitor-pipeline-tree.test.ts` — a run whose `workflow.workflowInvocationId` matches a stage nests under that stage with depth tags; fails against the pre-fix absent module.
- [ ] `tui-monitor-pipeline-tree.test.ts` — a run with no matching stage appears only in `unattributed`, not under any pipeline; fails against the pre-fix absent module.
- [ ] `tui-monitor-pipeline-tree.test.ts` — two stages sharing `stageId` but differing `branchKey` produce distinct node ids and rows; `default` branch renders an empty `branch` cell; fails against the pre-fix absent module.
- [ ] `tui-monitor-pipeline-tree.test.ts` — a stage-matched run is excluded from `unattributed`; unattributed-only rows still pass through `filterMonitorRunsForLiveWindow`; inverting the exclusion guard turns the test RED.
- [ ] `tui-monitor-pipeline-tree.test.ts` — pinning tests include comment checkpoints naming guard-inversion mutations for stage join, fan-out node id, and unattributed exclusion.
- [ ] Source-mutating each guard above (stage join, fan-out id, unattributed exclusion) turns the corresponding pinning test RED. Do **not** add a production test flag. (Manual)
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

None — operator-facing nesting docs ship with monitor integration.
