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
- Initial selection after refresh: first selectable row's `id` (tree node `id` or unattributed run id) in pane order — rules out always preferring a live run outside the visible tree.
- When the selected id disappears from the selectable list, clear `selectedNodeId` and wait-state — rules out retaining a stale pipeline/stage selection silently.
- Pipeline/stage/run lookup for the right pane and selectable list both use the same `monitorLeftPaneTreeRows` derivation as the left pane — rules out a parallel snapshot walk or duplicate tree build.
- Rename `selectRun` to node selection (e.g. `selectNode`) accepting any selectable tree or unattributed id; restrict run-only steering helpers to run leaves — rules out programmatic pipeline/stage selection silently no-oping.
- Right pane content by selected node kind uses fields already on the tree model / list row, not slice-4 detail — rules out sticky pipeline headers, elapsed columns, artifact JSON, or `workflowInvocationId` blocks.
  - **Pipeline:** `pipelineId`, `name`, derived `project`, snapshot `state`.
  - **Stage:** `stageId`, `branchKey` (empty label when `default`), snapshot stage `status`.
  - **Run leaf:** existing workflow / outcome / steering block from today's run detail path unchanged.
  - **Unattributed row:** same run-only detail as a standalone run selection today.
- Run steering (kill, pause/resume) applies only when the selected node is a run leaf (tree or unattributed) — rules out kill on pipeline/stage rows.
- `wait` / outcome panel still tracks the selected run leaf's `runId`; pipeline/stage selection clears or hides run wait outcome — rules out showing a prior run's wait state under a pipeline row.
- `e` on unattributed rows still mutates `expandedWorkflowInvocationIds` until [02](./02-monitor-tree-expansion-and-docs.md) removes it — rules out dropping invocation state early without subspec 02.
- Tests use injected input hook and monitor-state assertions — rules out painted ink assertions.

## Tasks

- Migrate `TuiMonitorState`, `tui-entry.tsx` controls, and ink monitor props from `selectedRunId` to
  `selectedNodeId`.
- Implement `monitorSelectableNodeIds(state)` (or equivalent) mirroring the left-pane flat row order from
  `monitorLeftPaneTreeRows`.
- Wire `selectNextRun` / `selectPreviousRun` and ink `j`/`k`/arrow handlers through the selectable-node
  list.
- Migrate `selectRun` to `selectNode` (name may differ) for programmatic selection of pipeline, stage,
  or run ids.
- Add `monitorRightPaneSegmentRows` branches for `pipeline` and `stage` selections using the field sets
  above; resolve selected node metadata from the shared left-pane derivation; preserve existing run detail
  for run leaves.
- Update `tui-entry.test.tsx` navigation pins for tree + unattributed selectable order; keep
  `tui-ink-monitor.test.tsx` `drives row navigation through the injected input hook` as a stub-preservation
  test only.
- Add guard-inversion comment checkpoints on selection-list and right-pane kind guards.

## Acceptance criteria

- [x] `tui-entry.test.tsx` — `drives row navigation through the injected input hook` (updated) steps `j`/`k` across pipeline, stage, and run tree rows plus an unattributed row in pane order; fails pre-fix when navigation is run-only.
- [x] `tui-entry.test.tsx` — after refresh, `selectedNodeId` is the first selectable tree or unattributed row in pane order; fails pre-fix when selection still prefers a run outside the visible tree.
- [x] `tui-entry.test.tsx` — when a refresh drops the selected id from the selectable list, `selectedNodeId` clears and wait-state resets; fails pre-fix when stale pipeline/stage selection persists.
- [x] `tui-entry.test.tsx` — kill/pause controls no-op when a pipeline or stage row is selected; fails pre-fix when run steering ignores node kind.
- [x] `tui-entry.test.tsx` — programmatic `selectNode` (or renamed equivalent) with a pipeline or stage id updates `selectedNodeId`; fails pre-fix when only run ids are accepted.
- [x] `tui-monitor-lines.test.ts` — selecting a pipeline node yields right-pane lines for `pipelineId`, `name`, `project`, and `state` only; selecting a stage node yields `stageId`, branch (empty for `default`), and `status` only; fails pre-fix when the right pane always shows run workflow/outcome.
- [x] `tui-monitor-lines.test.ts` — selecting a run leaf under a stage preserves the existing workflow and outcome sections; fails pre-fix when tree run selection drops workflow detail.
- [x] `tui-monitor-lines.test.ts` — pipeline/stage selection clears or hides the wait/outcome panel; fails pre-fix when a prior run's wait state remains visible under a pipeline row.
- [x] `tui-monitor-lines.test.ts` — pinning tests include `Mutation checkpoint:` comments naming guard-inversion mutations for selectable-list composition and right-pane kind dispatch; inverting each named guard turns the corresponding pin RED.
- [x] `tui-ink-monitor.test.tsx` — `drives quit and kill through the injected input hook` stays green.
- [x] `tui-ink-monitor.test.tsx` — `drives row navigation through the injected input hook` stays green.
- [x] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

None — operator-facing nesting docs ship in [02](./02-monitor-tree-expansion-and-docs.md).
