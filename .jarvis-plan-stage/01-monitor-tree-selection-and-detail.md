# Monitor tree selection and detail

Three-deep selection over visible tree nodes plus unattributed flat rows drives the right pane with
each node's existing fields only. Depends on [00](./00-monitor-tree-left-pane.md).

## Problem

Selection and the right pane are run-id-only. Operators cannot select a pipeline or stage row or see
its fields without cross-reading `jarvis pipeline list`.

## Prerequisites

- [00 - Monitor tree left pane](./00-monitor-tree-left-pane.md) merged — tree rows render in the ink left pane.

## Decisions

- Replace `selectedRunId` with `selectedNodeId: string | null` on `TuiMonitorState` — rules out parallel run-id and node-id selection state.
- Selectable row order = visible flattened tree `displayNodes` in pane order, then unattributed `WorkflowTableRow` entries in builder order — rules out depth-first traversal that skips collapsed nodes or re-sorts unattributed by finish time.
- `selectNextRun` / `selectPreviousRun` / `j` / `k` / up / down walk that flat selectable list — rules out run-only `monitorSelectableRuns` navigation.
- Initial selection after refresh: first selectable row's `id` (tree node `id` or unattributed run id) — rules out always preferring a live run outside the visible tree.
- When the selected id disappears from the selectable list, clear selection and wait-state — rules out retaining a stale pipeline/stage selection silently.
- Right pane content by selected node kind uses fields already on the tree model / list row, not slice-4 detail — rules out sticky pipeline headers, elapsed columns, artifact JSON, or `workflowInvocationId` blocks.
  - **Pipeline:** `pipelineId`, `name`, derived `project`, snapshot `state`.
  - **Stage:** `stageId`, `branchKey` (empty label when `default`), snapshot stage `status`.
  - **Run leaf:** existing workflow / outcome / steering block from today's run detail path unchanged.
  - **Unattributed row:** same run-only detail as a standalone run selection today.
- Run steering (`k`, pause/resume) applies only when the selected node is a run leaf (tree or unattributed) — rules out kill on pipeline/stage rows.
- `wait` / outcome panel still tracks the selected run leaf's `runId`; pipeline/stage selection clears or hides run wait outcome — rules out showing a prior run's wait state under a pipeline row.
- Tests use injected input hook and monitor-state assertions — rules out painted ink assertions.

## Tasks

- Migrate `TuiMonitorState`, `tui-entry.tsx` controls, and ink monitor props from `selectedRunId` to
  `selectedNodeId`.
- Implement `monitorSelectableNodeIds(state)` (or equivalent) mirroring the left-pane flat row order.
- Wire `selectNextRun` / `selectPreviousRun` and ink `j`/`k`/arrow handlers through the selectable-node
  list.
- Add `monitorRightPaneSegmentRows` branches for `pipeline` and `stage` selections using the field sets
  above; preserve existing run detail for run leaves.
- Update `tui-entry.test.tsx` and `tui-ink-monitor.test.tsx` navigation pins for tree + unattributed
  selectable order.
- Add guard-inversion comment checkpoints on selection-list and right-pane kind guards.

## Acceptance criteria

- [ ] `tui-entry.test.tsx` — `drives row navigation through the injected input hook` (updated or sibling test) steps `j`/`k` across pipeline, stage, and run tree rows plus an unattributed row in pane order; fails pre-fix when navigation is run-only.
- [ ] `tui-monitor-lines.test.ts` — selecting a pipeline node yields right-pane lines for `pipelineId`, `name`, `project`, and `state` only; selecting a stage node yields `stageId`, branch (empty for `default`), and `status` only; fails pre-fix when the right pane always shows run workflow/outcome.
- [ ] `tui-monitor-lines.test.ts` — selecting a run leaf under a stage preserves the existing workflow and outcome sections; fails pre-fix when tree run selection drops workflow detail.
- [ ] `tui-monitor-lines.test.ts` — pinning tests include `Mutation checkpoint:` comments naming guard-inversion mutations for selectable-list composition and right-pane kind dispatch; inverting each named guard turns the corresponding pin RED.
- [ ] `tui-ink-monitor.test.tsx` — `drives quit and kill through the injected input hook` stays green.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

None — operator-facing nesting docs ship in [02](./02-monitor-tree-expansion-and-docs.md).
