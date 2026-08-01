# Monitor tree expansion and docs

`e` toggles pipeline/stage expansion via `expandedPipelineNodeIds`; run leaves and unattributed rows are
no-ops. Retire `expandedWorkflowInvocationIds` for monitor expansion. Depends on
[01](./01-monitor-tree-selection-and-detail.md).

## Problem

`e` still toggles `expandedWorkflowInvocationIds` on workflow-bound run rows. Pipeline tree stage
expansion must show constituent runs through `expandedPipelineNodeIds` with no dual collapse state.

The merged tree model currently collapses stage workflow runs at join time (`buildWorkflowTableRows` with
an empty expansion set). Flatten only reveals existing `stage.runs` leaves — it does not materialize
`workflow-child` rows. Stage `e` must re-expand workflow constituents at flatten time (or equivalent
join-time input keyed by `expandedPipelineNodeIds`); monitor wiring alone cannot satisfy intent.

## Prerequisites

- [01 - Monitor tree selection and detail](./01-monitor-tree-selection-and-detail.md) merged — `selectedNodeId` and three-deep navigation exist.

## Decisions

- Extend `buildMonitorPipelineTree` / flatten (or join with expansion input) so an expanded stage emits
  `workflow-collapsed` parent plus `workflow-child` constituent rows in pane order; a collapsed stage
  emits one collapsed parent row only — rules out flatten-only visibility of pre-collapsed join output.
- `toggleSelectedWorkflowExpansion` becomes pipeline-tree expansion: toggle `selectedNodeId` in `expandedPipelineNodeIds` when the selected node is `kind: "pipeline"` or `kind: "stage"` — rules out a second expansion keybinding.
- `e` on a run leaf or unattributed row is a no-op — rules out retaining workflow-invocation toggling on flat rows.
- `expandedWorkflowInvocationIds` is removed from `TuiMonitorState` and all monitor paths; stage expansion uses `expandedPipelineNodeIds` only — rules out dual collapse state on the same key.
- Unattributed segment keeps workflow-collapsed single-row presentation without `e` expansion — rules out reintroducing invocation expansion for orphans.
- Reveal-on-select (ancestor ids unioned into effective expansion) stays in the pure tree flatten path — rules out duplicating ancestor expansion in ink or entry.
- Tests press `e` through the injected input hook and assert monitor state / left-pane row visibility — rules out seeding `expandedPipelineNodeIds` without exercising the handler (`v2/docs/test-writing.md` § TUI test strategy).
- Operator docs reconcile `jarvis tui` sections in `operator-runbook.md` and `v1-behaviors.md` for pipeline nesting, pipeline-attributed run window exemption, three-deep selection, pipeline/stage `e`, retired flat workflow `e`, and right-pane content per selection kind — rules out updating only a single observation row.

## Tasks

- Patch `tui-monitor-pipeline-tree.ts` so expanded stages materialize workflow constituent rows (flatten-time
  re-expand with `expandedPipelineNodeIds`, or join-time expansion keyed the same way).
- Add `tui-monitor-pipeline-tree.test.ts` coverage: collapsed stage → one run row; expanded stage → parent
  plus `workflow-child` rows in pane order.
- Repurpose `toggleSelectedWorkflowExpansion` (control name may change) to toggle
  `expandedPipelineNodeIds` for the selected pipeline or stage node only.
- Remove `expandedWorkflowInvocationIds` from state, `tui-entry.tsx`, `tui-monitor-lines.ts`, and tests;
  pass `new Set()` to any remaining `buildWorkflowTableRows` calls in unattributed rendering.
- Add `tui-entry.test.tsx` regression driving `e` through the injected input hook: collapsed stage hides
  constituent runs; first `e` expands; second `e` collapses; `expandedWorkflowInvocationIds` stays
  empty throughout.
- Add pipeline expansion pin: `e` on a selected pipeline toggles stage/run visibility; second `e`
  collapses.
- Add no-op pin: `e` on a selected run leaf leaves `expandedPipelineNodeIds` unchanged.
- Add guard-inversion comment checkpoints on the expansion pinning test naming the `e` branch and
  toggle body mutations.
- Update `v2/docs/operator-runbook.md` `jarvis tui`: pipeline/stage/run nesting, full merged run set for
  pipeline matching (1h/20-row window on unattributed only), three-deep selection and right-pane fields,
  `e` on pipeline/stage rows, unattributed flat segment.
- Update `v2/docs/v1-behaviors.md` `jarvis tui` entry: pipeline tree in left pane; three-deep selection;
  pipeline/stage `e`; pipeline-attributed run window exemption; workflow-invocation expansion on flat
  rows removed.

## Acceptance criteria

- [ ] `tui-monitor-pipeline-tree.test.ts` — collapsed stage under an expanded pipeline emits one `workflow-collapsed` run row at depth 2; the same stage with its id in `expandedPipelineNodeIds` emits parent at depth 2 plus `workflow-child` rows at depth 3; fails pre-fix when join always collapses to a single row.
- [ ] `tui-entry.test.tsx` — `drives pipeline tree expansion through the injected input hook` presses `e` on a selected stage without seeding `expandedPipelineNodeIds`; constituent run rows appear after the first press and disappear after the second; `expandedWorkflowInvocationIds` is absent or remains empty throughout; fails pre-fix when `e` still toggles invocation ids.
- [ ] `tui-entry.test.tsx` — `e` on a selected pipeline without seeding `expandedPipelineNodeIds` reveals stage and run rows after the first press and hides them after the second; fails pre-fix when pipeline `e` is a no-op.
- [ ] `tui-entry.test.tsx` — `e` on a selected run leaf leaves `expandedPipelineNodeIds` unchanged; fails pre-fix when run selection still toggles invocation expansion.
- [ ] `tui-entry.test.tsx` — pinning test includes `Mutation checkpoint:` comments naming guard-inversion mutations for the ink `e` binding and the expansion toggle body; inverting each named guard turns the pin RED.
- [ ] `tui-monitor-pipeline-tree.test.ts` — collapse, reveal-on-select, and FIFO viewport tests stay green after the workflow-constituent materialization patch.
- [ ] `tui-ink-monitor.test.tsx` — `drives quit and kill through the injected input hook` stays green.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — reconcile `jarvis tui` for pipeline nesting, pipeline-attributed run window exemption, three-deep selection, `e` on pipeline/stage rows, unattributed segment, right-pane content per selection kind.
- `v2/docs/v1-behaviors.md` — `jarvis tui` entry records the pipeline tree, three-deep selection, pipeline/stage `e`, window exemption, and retired flat workflow `e` expansion.
