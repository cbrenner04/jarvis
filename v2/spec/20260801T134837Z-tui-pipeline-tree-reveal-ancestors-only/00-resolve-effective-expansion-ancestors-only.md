# Resolve effective expansion from ancestors only

`resolveEffectiveExpansion` unions `selectedNodeId` into effective expansion, so `expandedNodeIds`
membership cannot change flatten output while that pipeline or stage stays selected.

## Problem

With a stage selected, `expandedNodeIds: []` and `[stageId]` produce byte-identical flatten output.
`e` is a durable-state toggle with no visible delta; navigation cannot collapse rows the cursor just
walked through.

## Decisions

- Effective expansion is `expandedNodeIds ∪ ancestors(selectedNodeId)` — rules out unioning `selectedNodeId` itself (current self-expand loop in `resolveEffectiveExpansion`).
- A selected collapsed stage appears in flatten output without expanded constituent run rows until its id is in `expandedNodeIds` — rules out treating selection as implicit stage expansion.
- A selected collapsed pipeline appears as a single pipeline row until its id is in `expandedNodeIds` — rules out pipeline self-expand mirroring stage self-expand.
- `expandedNodeIds` membership changes flatten output for the selected pipeline or stage in both directions — rules out a toggle that only mutates durable state.
- Collapsed stage still emits join-time `stage.runs` collapsed representatives when the parent pipeline is expanded; this subspec does not change that contract — rules out conflating “expanded constituent rows” with “zero run rows”.
- Reveal-on-select preservation pins `selecting a descendant expands ancestors only and leaves sibling pipelines collapsed` and `selecting a run reveals ancestor stages only and leaves sibling stage runs collapsed` stay green or are updated to match post-fix flatten semantics — rules out silently dropping ancestor reveal.
- No production `setInvert*ForTest` / `invert*ForTest` hooks — rules out test-only bypasses in `resolveEffectiveExpansion`.

## Prerequisites

- `flattenMonitorPipelineTree` joins pipeline snapshots to run rows and accepts `expandedNodeIds`, `selectedNodeId`, and `maxVisibleRows`.
- Collapsing a pipeline hides stage and run descendants; collapsing a stage hides only its runs.
- Reveal-on-select currently forces ancestor visibility via `resolveSelectedAncestors`.
- Must land before `tui-entry-tree-viewport-and-navigation` and `seeds/tui-tree-self-expand-hides-the-e-toggle`; do not implement in parallel — that entry work lists ancestors-only reveal and bidirectional `expandedNodeIds` flatten deltas as prerequisites this spec delivers.

## Tasks

- Remove the `resolveEffectiveExpansion` self-expand loop that adds `selectedNodeId` when it matches a
  pipeline or stage node.
- Add `tui-monitor-pipeline-tree.test.ts` regression `selected stage expansion toggles flatten output`:
  multi-member stage fixture, stage selected, `expandedNodeIds` `[]` vs `[stageId]` produce distinct
  flatten lists; `[]` shows collapsed representative run rows only, `[stageId]` shows expanded
  constituent rows.
- Add `tui-monitor-pipeline-tree.test.ts` regression `toggling expandedNodeIds on a selected stage
  round-trips flatten output`: multi-member stage fixture, stage selected, press-equivalent toggle
  `[]` → `[stageId]` → `[]` returns the starting list with a distinct intermediate list.
- Add `Mutation checkpoint:` comments on the new regressions naming re-adding the removed self-expand
  loop in `resolveEffectiveExpansion`.
- Reconcile reveal-on-select pinning tests if post-fix flatten output differs; retain or add
  `Mutation checkpoint:` comments naming `resolveSelectedAncestors` omission or stage-run expansion
  without `stage.id` membership.
- Update `tui-entry.test.tsx` `drives pipeline tree expansion through the injected input hook`:
  visibility assertions match post-fix flatten (collapsed representative run rows when the stage is
  selected with empty `expandedPipelineNodeIds`; expanded constituent rows after the first `e`);
  preserve `expandedPipelineNodeIds` membership pins.
- Update `v2/docs/operator-runbook.md` `jarvis tui` row: remove the self-expand caveat and note that
  `e` on the selected stage toggles collapsed representatives vs expanded constituent rows; full
  `e`/navigation narrative ships with `tui-entry-tree-viewport-and-navigation`.
- Run `bun run typecheck` and `bun run test:v2`.

## Acceptance criteria

- [x] `tui-monitor-pipeline-tree.test.ts` — `selected stage expansion toggles flatten output` fails
      against pre-fix self-expand and passes after; multi-member stage fixture, stage selected,
      `expandedNodeIds: []` omits expanded constituent run rows (collapsed representatives remain)
      while `expandedNodeIds: [stageId]` includes them.
- [x] `tui-monitor-pipeline-tree.test.ts` — `toggling expandedNodeIds on a selected stage round-trips
      flatten output` fails against pre-fix self-expand and passes after; multi-member stage fixture,
      `[]` → `[stageId]` → `[]` returns the starting list with a distinct intermediate list.
- [x] `tui-monitor-pipeline-tree.test.ts` — mutating `resolveEffectiveExpansion` to re-add selected
      pipeline/stage ids turns both new regressions RED; `Mutation checkpoint:` on each names that
      mutation.
- [x] `tui-monitor-pipeline-tree.test.ts` — `selecting a descendant expands ancestors only and leaves
      sibling pipelines collapsed` and `selecting a run reveals ancestor stages only and leaves sibling
      stage runs collapsed` stay green or are updated with `Mutation checkpoint:` comments naming
      `resolveSelectedAncestors` omission or sibling stage-run expansion without `stage.id` membership.
- [x] `tui-entry.test.tsx` — `drives pipeline tree expansion through the injected input hook` visibility
      assertions match post-fix flatten output; `expandedPipelineNodeIds` membership pins unchanged.
- [x] `v2/docs/operator-runbook.md` — `jarvis tui` row no longer states selected-node self-expand or
      that `e` on the selected stage has no visible effect.
- [x] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — remove/replace the self-expand paragraph in the `jarvis tui` row;
  note that full `e` and `j`/↓/↑ navigation narrative ships with `tui-entry-tree-viewport-and-navigation`.
