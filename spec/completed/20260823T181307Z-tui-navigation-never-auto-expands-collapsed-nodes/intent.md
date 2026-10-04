---
name: tui-navigation-never-auto-expands-collapsed-nodes
---

# TUI navigation never auto-expands collapsed nodes

Unsplit rationale: the fix is one removal inside the monitor-controls navigation seam (`selectNextRun` in `v2/src/tui/tui-entry.tsx`) plus its runbook wording, so there is no second module boundary to split across.

## Primary implementation surface

- `v2/src/tui/tui-entry.tsx` — monitor controls `selectNextRun`/`selectPreviousRun`

## Prerequisites

## Behavior

Drop the reveal-on-navigate branch in `selectNextRun`: both `selectNextRun` and `selectPreviousRun` walk `monitorSelectableNodeIds(currentState, …)` — the persisted-expansion selectable set — with no throwaway `revealState`. A collapsed expandable pipeline/stage/branch node is a single stop; `j`/↓ from it selects the next row visible under the persisted expansion (next sibling / next top-level row), never a hidden child, and writes no expansion. Down-then-up returns to the prior selection with no intervening reveal or collapse.

`e`/`toggleSelectedWorkflowExpansion` and the `expand`/`collapse` dock commands stay the only writers of `expandedPipelineNodeIds`. No new state, key, or toggle.

Deliberate reveal paths that are not free navigation are unchanged: `revealSelectedAttentionTarget` (Enter on an attention row) and `selectNode`/`resolveSelectedAncestors` ancestor reveal for a directly-selected node.

## Decisions

- Remove the reveal branch rather than mirror it into `selectPreviousRun` — the operator wants expansion fully explicit, not symmetric auto-reveal.
- Keep `resolveSelectedAncestors` paint-time ancestor reveal for directly-selected targets; rules out stripping reveal from Enter/`selectNode` too.

## Acceptance criteria

- [ ] `selectNextRun` on a collapsed expandable node selects that node's successor in the persisted-expansion selectable list, not its first hidden child, and leaves `expandedPipelineNodeIds` unchanged — pinned by a control-level test.
- [ ] `selectNextRun` and `selectPreviousRun` walk the same persisted-expansion id list, so down-then-up over a collapsed node returns to the prior selection with no reveal — pinned by a test.
- [ ] `e`/`toggleSelectedWorkflowExpansion` and the `expand`/`collapse` dock commands remain the only writers of `expandedPipelineNodeIds` — pinned by existing/updated expansion tests staying green.
- [ ] `revealSelectedAttentionTarget` and `selectNode` ancestor reveal are unaffected — pinned by their existing tests staying green.
- [ ] Existing `@mutate` checkpoints referencing the removed `revealState` walk are retired or retargeted to the surviving guard, with no dangling directive naming deleted source.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — Observe/dock sections: `j`/↓/↑ walk only the explicitly-expanded tree and never reveal a collapsed node's children; `e` and `expand`/`collapse` are the sole expansion controls. Replace the "↓ into a collapsed pipeline, stage, or branch reveals it for paint" wording and reconcile the `tui-down-arrow-reveals-without-persisting-expansion` note.
