---
name: tui-pipeline-tree-reveal-ancestors-only
---

# Pipeline tree reveal-on-select expands ancestors only

`resolveEffectiveExpansion` self-expands the selected pipeline or stage id, so `expandedNodeIds`
membership cannot change the flattened row list while that node stays selected.

## Problem

With a stage selected, `expandedPipelineNodeIds: []` and `[stageId]` produce byte-identical flatten
output. `e` is a durable-state toggle with no visible delta; navigation cannot collapse rows the
cursor just walked through.

## Decisions

- Effective expansion is `expandedNodeIds ∪ ancestors(selectedNodeId)` — rules out unioning `selectedNodeId` itself (current self-expand).
- A selected collapsed stage appears in flatten output without its run descendants until its id is in `expandedNodeIds` — rules out treating selection as implicit stage expansion.
- `e` membership in `expandedNodeIds` changes flatten output for the selected pipeline or stage in both directions — rules out a toggle that only mutates durable state.

## Acceptance criteria

- [ ] With a stage selected and its id absent from `expandedNodeIds`, flatten output omits that stage's run rows; adding the id includes them; a regression test in `tui-monitor-pipeline-tree.test.ts` fails pre-fix.
- [ ] Toggling `expandedNodeIds` on a selected stage twice returns flatten output to its starting value with a distinct intermediate list; `tui-monitor-pipeline-tree.test.ts` fails pre-fix.
- [ ] Selecting a run leaf reveals ancestor pipeline and stage rows without expanding sibling stages; `tui-monitor-pipeline-tree.test.ts` reveal-on-select pins stay green or are updated with guard-inversion checkpoints.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

None — operator-facing `e` and navigation docs ship with entry integration.

## Prerequisites

- `flattenMonitorPipelineTree` joins pipeline snapshots to run rows and accepts `expandedNodeIds`, `selectedNodeId`, and `maxVisibleRows`.
- Collapsing a pipeline hides stage and run descendants; collapsing a stage hides only its runs.
- Reveal-on-select currently forces ancestor visibility via `resolveSelectedAncestors`.
