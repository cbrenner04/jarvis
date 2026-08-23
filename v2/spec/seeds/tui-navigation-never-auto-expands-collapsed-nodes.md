---
name: tui-navigation-never-auto-expands-collapsed-nodes
---

# TUI down-arrow still descends into collapsed nodes; expansion should be fully explicit

## Problem

`j`/↓ navigation still auto-reveals a collapsed structural node's subtree. In `selectNextRun` (`v2/src/tui/tui-entry.tsx`), when the selected row is a collapsed expandable pipeline node, the walk builds a throwaway `revealState` that adds that node to the expansion set and descends into its children, so pressing down on a collapsed pipeline selects its first hidden child instead of skipping past the collapsed subtree. `selectPreviousRun` has no matching branch. The #2922 change stopped this reveal from *persisting* (revealState is never written back), but the reveal-for-paint on down still happens — so the operator sees the subtree open as they scroll down and re-collapse as they scroll back up. The operator wants expansion to be **fully explicit**: nothing opens or closes except via `e`/`expand`/`collapse`. Navigation should treat a collapsed node as a single stop and move to the next visible row past its hidden descendants.

## Evidence

`v2/src/tui/tui-entry.tsx:1036-1051`: the `isExpandablePipelineNodeId(...) && !expandedPipelineNodeIds.includes(selectedNodeId)` branch feeds `revealState` (collapsed node forced expanded) into `monitorSelectableNodeIds`, so the next-id walk descends into the collapsed subtree. Down-arrow reveals; up-arrow (`selectPreviousRun`, no reveal branch) does not — the asymmetry the operator reported ("expands on scroll-down, collapses on the way back up").

## Decisions

- Remove the reveal-on-navigate branch from `selectNextRun` so both `selectNextRun` and `selectPreviousRun` walk only the persisted-expansion selectable set (`monitorSelectableNodeIds(currentState, …)`, no `revealState`). A collapsed structural node is one stop; `j`/↓ from it selects the next row that is visible under the persisted expansion (its next sibling / top-level row), never a hidden child. Rules out any implicit expansion during navigation.
- Expansion state changes only through the explicit verbs: the `e` key (`toggleSelectedWorkflowExpansion`) and the `expand`/`collapse` dock commands. Rules out `j`/↓/↑ writing or transiently simulating expansion.
- Preserve the distinct, intentional reveal paths that are *not* free navigation: `revealSelectedAttentionTarget` (Enter on an attention row) and `selectNode`/`resolveSelectedAncestors` revealing a directly-selected node's own ancestors still work — those are deliberate jumps to a named target, not scroll-through. Rules out regressing attention-row Enter reveal or programmatic `selectNode`.
- No new persisted state or key; this is a removal that makes down-navigation symmetric with up-navigation. Rules out adding a toggle.

## Acceptance criteria

- [ ] With a collapsed expandable pipeline (or stage) node selected, `selectNextRun` selects the next row visible under the persisted expansion set (next sibling / top-level row), not a hidden child, and writes no expansion — pinned by a control-level test asserting `expandedPipelineNodeIds` is unchanged and the selection lands on the collapsed node's successor, not its first child.
- [ ] `selectNextRun` and `selectPreviousRun` walk the same persisted-expansion selectable id list, so down-then-up returns to the prior selection with no intervening reveal — pinned by a test.
- [ ] `e`/`toggleSelectedWorkflowExpansion` and the `expand`/`collapse` dock commands remain the only way to change `expandedPipelineNodeIds`, pinned by existing/added expansion tests still green.
- [ ] `revealSelectedAttentionTarget` (Enter on an attention row) and `selectNode` ancestor reveal are unaffected, pinned by their existing tests staying green.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — the Observe/dock section: `j`/↓/↑ navigate only the explicitly-expanded tree and never auto-expand a collapsed node; `e`/`expand`/`collapse` are the sole expansion controls. Reconcile with the `tui-down-arrow-reveals-without-persisting-expansion` note (which described the now-removed reveal-for-paint behavior).
