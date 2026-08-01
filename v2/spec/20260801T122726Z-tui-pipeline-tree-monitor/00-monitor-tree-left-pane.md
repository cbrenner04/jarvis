# Monitor tree left pane

Wire `buildMonitorPipelineTree` into the ink monitor left pane: merged pipeline snapshots,
depth-indented pipeline/stage/run rows, and a flat unattributed segment. No selection or `e` changes
yet — sibling [01](./01-monitor-tree-selection-and-detail.md).

**Not operator-complete alone:** after subspec 00, the left pane shows a tree but `j`/`k`/arrows still
walk flat run order until [01](./01-monitor-tree-selection-and-detail.md). Do not merge 00 to `main`
without 01 in the same spec PR or an immediately following merge.

## Problem

`pipelineSnapshotsBySocketPath` and the pure tree model exist, but the ink shell still renders a
flat workflow table from globally window-filtered runs.

## Prerequisites

- [TUI pipeline tree model](../20260801T112746Z-tui-pipeline-tree-model/index.md) merged — `buildMonitorPipelineTree`, join, flatten, and row helpers in `tui-monitor-pipeline-tree.ts`.
- [TUI pipeline list poll](../20260801T112737Z-tui-pipeline-list-poll/index.md) merged — `pipelineSnapshotsBySocketPath` on `TuiMonitorState`.
- [TUI command-center ink shell](../20260801T102722Z-tui-command-center-ink-shell/index.md) merged — split left/right + 4-line dock.

## Decisions

- Add `expandedPipelineNodeIds: readonly string[]` to `TuiMonitorState` (empty default) — rules out reusing `expandedWorkflowInvocationIds` for tree expansion.
- Merge pipeline snapshots by concatenating each `pipelineSnapshotsBySocketPath[socketPath].pipelines` in ascending socket-path key order — rules out cross-daemon dedup or owner inference in subspec 00.
- `refreshRuns` passes the full merged `list` run set into the tree builder; remove the global `filterMonitorRunsForLiveWindow` pre-filter in `tui-entry.tsx` — rules out applying the 1h/20-row window before pipeline matching (`tui-monitor-pipeline-tree.ts` already window-filters unattributed only).
- Left-pane body order: flattened pipeline tree rows, then unattributed flat workflow rows, then the existing queue block — rules out interleaving queue into the tree or dropping unattributed runs while pipelines exist.
- `maxVisibleRows` for tree flatten = `computeShellLayout(...).paneHeight` minus queue **heading** rows only (not queue row count) — rules out counting queue body rows against pipeline FIFO.
- Unattributed flat rows render after the tree segment and do **not** count against the pipeline FIFO `maxVisibleRows` budget — rules out trimming active pipelines to make room for orphans.
- `monitorLeftPaneTreeRows` (or equivalent) accepts `nowMs` from entry refresh deps; tests use a fixed clock — rules out implicit `Date.now()` in derivation.
- Pipeline and stage ink cells use `buildPipelineMonitorTreeRow` / `buildStageMonitorTreeRow`; run leaves use `listMonitorTreeCells` on the node's `tableRow` with depth from `node.depth` — rules out a third run-row formatter.
- Depth indentation maps `node.depth` to repeated two-space `indent` column slots before label — rules out a single flat indent regardless of depth.
- Subspec 00 does not change selection wiring; tree row markers follow existing `selectedRunId` matching on run leaves only until [01](./01-monitor-tree-selection-and-detail.md) — rules out ▼/▶ expand glyphs in subspec 02 (`Deferred to first consumer: expand/collapse glyphs in marker column — pin when dogfooding asks`).
- Segment header strings (`Unattributed`, counts) deferred — rules out inventing labels before slice 6 (`Deferred to first consumer: unattributed segment header row — pin when slice 6 polishes FIFO/labels`).
- `e` on unattributed rows still mutates `expandedWorkflowInvocationIds` until [02](./02-monitor-tree-expansion-and-docs.md) removes it; no visible left-pane effect on tree rows — rules out silently dropping invocation state in 00.
- Tests assert pure left-pane row derivation and/or monitor state wiring — rules out painted ink assertions (`v2/docs/test-writing.md` § TUI test strategy).

## Tasks

- Add a pure `monitorLeftPaneTreeRows(state, layout, nowMs)` (name need not be exact) that merges snapshots,
  calls `buildMonitorPipelineTree` with `expandedPipelineNodeIds`, current selection id, `maxVisibleRows`,
  and `nowMs`, and returns ordered `{ kind, id, depth, render payload }` entries plus `unattributedRows`.
- Stop applying `filterMonitorRunsForLiveWindow` to the merged run list in `tui-entry.tsx` `refreshRuns`;
  pass full merged runs into monitor state for tree build.
- Replace `monitorLeftPaneTableRows` as the tree-pane source in `tui-ink-monitor.tsx` left-pane render
  (keep `monitorLeftPaneTableRows` only for unattributed/legacy call sites until 01 retires flat-only
  navigation).
- Render pipeline/stage/run tree rows through existing row helpers and depth-aware indent; append
  unattributed rows with existing `listMonitorTreeCells` / `buildMonitorTreeRow` behavior.
- Add `tui-monitor-lines.test.ts` (or colocated module test) coverage for merged snapshots,
  depth-indented tree ordering, unattributed placement after tree rows, and full-run-set pipeline
  matching without global pre-filter.
- Add `tui-ink-monitor.test.tsx` (or `tui-entry.test.tsx`) coverage that the ink left-pane row
  source consumes tree derivation output — via props/state/hooks, not painted ink.
- Add guard-inversion comment checkpoints on pinning tests naming snapshot merge, tree-vs-flat source,
  and global pre-filter removal guards.

## Acceptance criteria

- [ ] `tui-monitor-lines.test.ts` — with pipeline snapshots and stage-matched runs, left-pane derivation emits pipeline → stage → run rows with increasing `depth` and places unmatched runs only in the unattributed segment after tree rows; fails pre-fix when derivation still mirrors flat `monitorLeftPaneTableRows` only.
- [ ] `tui-monitor-lines.test.ts` — with an expanded pipeline (stage and run visible), left-pane derivation maps `node.depth` to indent column slots (pipeline `0`, stage `1`, run leaf `2`); fails pre-fix when row helpers ignore depth or emit a single flat indent.
- [ ] `tui-monitor-lines.test.ts` — a run matched to a pipeline stage is excluded from the unattributed segment even when it would fail the 1h/20-row terminal window; fails pre-fix when `tui-entry.tsx` globally pre-filters runs before tree build.
- [ ] `tui-monitor-lines.test.ts` — merged `pipelineSnapshotsBySocketPath` from two socket paths concatenates both daemons' `pipelines` arrays in stable socket-path order; fails pre-fix when snapshots are ignored.
- [ ] `tui-monitor-lines.test.ts` — pinning tests include `Mutation checkpoint:` comments naming guard-inversion mutations for global pre-filter removal and tree-row source selection; inverting each named guard turns the corresponding pin RED.
- [ ] `tui-ink-monitor.test.tsx` — left-pane row source reads from tree derivation (pipeline/stage/run node ids present in render props or equivalent hook output); fails pre-fix when the ink shell still calls flat `monitorLeftPaneTableRows` only for the tree segment.
- [ ] `tui-ink-monitor.test.tsx` — `drives quit and kill through the injected input hook` and `drives row navigation through the injected input hook` stay green.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

None — operator-facing nesting docs ship in [02](./02-monitor-tree-expansion-and-docs.md).
