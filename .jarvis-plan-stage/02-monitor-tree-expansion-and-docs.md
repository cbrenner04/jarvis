# Monitor tree expansion and docs

`e` toggles pipeline/stage expansion via `expandedPipelineNodeIds`; run leaves and unattributed rows are
no-ops. Retire `expandedWorkflowInvocationIds` for monitor expansion. Depends on
[01](./01-monitor-tree-selection-and-detail.md).

## Problem

`e` still toggles `expandedWorkflowInvocationIds` on workflow-bound run rows. Pipeline tree stage
expansion must show constituent runs through `expandedPipelineNodeIds` with no dual collapse state.

## Prerequisites

- [01 - Monitor tree selection and detail](./01-monitor-tree-selection-and-detail.md) merged — `selectedNodeId` and three-deep navigation exist.

## Decisions

- `toggleSelectedWorkflowExpansion` becomes pipeline-tree expansion: toggle `selectedNodeId` in `expandedPipelineNodeIds` when the selected node is `kind: "pipeline"` or `kind: "stage"` — rules out a second expansion keybinding.
- `e` on a run leaf or unattributed row is a no-op — rules out retaining workflow-invocation toggling on flat rows.
- `expandedWorkflowInvocationIds` is removed from `TuiMonitorState` and all monitor paths; stage expansion uses `buildMonitorPipelineTree` flatten with `expandedPipelineNodeIds` only — rules out dual collapse state on the same key.
- Unattributed segment keeps workflow-collapsed single-row presentation without `e` expansion — rules out reintroducing invocation expansion for orphans.
- Reveal-on-select (ancestor ids unioned into effective expansion) stays in the pure tree flatten path — rules out duplicating ancestor expansion in ink or entry.
- Tests press `e` through the injected input hook and assert monitor state / left-pane row visibility — rules out seeding `expandedPipelineNodeIds` without exercising the handler (`v2/docs/test-writing.md` § TUI test strategy).
- Operator docs record pipeline nesting, `e` on pipeline/stage rows, and retained right-pane/run steering behavior — rules out deferring doc alignment.

## Tasks

- Repurpose `toggleSelectedWorkflowExpansion` (control name may change) to toggle
  `expandedPipelineNodeIds` for the selected pipeline or stage node only.
- Remove `expandedWorkflowInvocationIds` from state, `tui-entry.tsx`, `tui-monitor-lines.ts`, and tests;
  pass `new Set()` to any remaining `buildWorkflowTableRows` calls in unattributed rendering.
- Add `tui-entry.test.tsx` regression driving `e` through the injected input hook: collapsed stage hides
  constituent runs; first `e` expands; second `e` collapses; `expandedWorkflowInvocationIds` stays
  empty throughout.
- Add no-op pin: `e` on a selected run leaf leaves `expandedPipelineNodeIds` unchanged.
- Add guard-inversion comment checkpoints on the expansion pinning test naming the `e` branch and
  toggle body mutations.
- Update `v2/docs/operator-runbook.md` `jarvis tui` observation: pipeline/stage/run nesting, `e`
  expansion, unattributed flat segment, right-pane fields retained per selection kind.
- Update `v2/docs/v1-behaviors.md` `jarvis tui` entry: pipeline tree in left pane; `e` on
  pipeline/stage; workflow-invocation expansion on flat rows removed.

## Acceptance criteria

- [ ] `tui-entry.test.tsx` — `drives pipeline tree expansion through the injected input hook` presses `e` on a selected stage without seeding `expandedPipelineNodeIds`; constituent run rows appear after the first press and disappear after the second; `expandedWorkflowInvocationIds` is absent or remains empty throughout; fails pre-fix when `e` still toggles invocation ids.
- [ ] `tui-entry.test.tsx` — `e` on a selected run leaf leaves `expandedPipelineNodeIds` unchanged; fails pre-fix when run selection still toggles invocation expansion.
- [ ] `tui-entry.test.tsx` — pinning test includes `Mutation checkpoint:` comments naming guard-inversion mutations for the ink `e` binding and the expansion toggle body; inverting each named guard turns the pin RED.
- [ ] `tui-monitor-pipeline-tree.test.ts` — collapse, reveal-on-select, and FIFO viewport tests stay green (behavior unchanged in the pure tree module).
- [ ] `tui-ink-monitor.test.tsx` — `drives quit and kill through the injected input hook` stays green.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — `jarvis tui` observation row: pipeline nesting, `e` on pipeline/stage rows, unattributed segment, right-pane content per selection kind.
- `v2/docs/v1-behaviors.md` — `jarvis tui` entry records the pipeline tree and retired flat workflow `e` expansion.
