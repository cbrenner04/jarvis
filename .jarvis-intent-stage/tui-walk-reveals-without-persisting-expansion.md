---
name: tui-walk-reveals-without-persisting-expansion
---

# TUI walk reveals collapsed nodes for paint without persisting expansion

Single surface: the change is confined to the TUI monitor controls in `v2/src/tui/tui-entry.tsx` (`selectNextRun`), whose only writer of `expandedPipelineNodeIds` on navigation is removed; reveal-for-paint already lives in `buildMonitorPipelineTree`'s effective-expansion union and needs no change, so splitting by module boundary does not apply.

## Problem

In `jarvis tui`, walking ↓/`j` onto a collapsed pipeline, stage, or branch adds that node id to `expandedPipelineNodeIds` so the walk can descend into it. The expansion is durable for the session: an operator scrolling *past* collapsed work expands every node passed through, exploding the tree. Navigation carries an irreversible side effect.

## Decisions

- ↓/`j` descends into a collapsed expandable node by evaluating the next selectable id against a provisional state where that node is expanded, mirroring `revealSelectedAttentionTarget`'s provisional-selection guard — rules out persisting the expansion to make the child selectable.
- `selectNextRun` no longer writes `expandedPipelineNodeIds`; ancestors of the new selection stay painted only through `resolveSelectedAncestors`, so the node collapses again once selection leaves it. Rules out a "transient expanded set" second store alongside the durable one.
- `e` (toggle) and the `expand`/`collapse` dock verbs remain the only writers of `expandedPipelineNodeIds`. Rules out a second expansion source.
- `selectPreviousRun` is unchanged; it already never wrote expansion.

## Acceptance criteria

- [ ] Walking ↓ from a collapsed pipeline/stage/branch selects a node inside it and paints its ancestors while leaving `expandedPipelineNodeIds` unchanged, pinned by a test that fails against the pre-fix persist-on-walk behavior.
- [ ] After selection moves back out of a walk-revealed node, that node's descendants are no longer painted (no residual expansion), pinned by a test.
- [ ] `e` and the `expand` verb still durably expand the selected node, pinned by existing/updated tests.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — replace the "walking into a collapsed pipeline, stage, or branch with ↓ expands it for the session" clause with reveal-for-paint semantics; only `e`/`expand`/`collapse` change the expanded set.
- `v2/docs/v1-behaviors.md` — record that TUI walk navigation never writes `expandedPipelineNodeIds`, alongside the existing `expand`/`collapse` entry.

## Prerequisites

- Selecting a descendant of a collapsed node paints its ancestor chain via the effective-expansion union of `expandedPipelineNodeIds` and `resolveSelectedAncestors`.
- `e` and the dock `expand`/`collapse` verbs write `expandedPipelineNodeIds` as durable, non-navigation edits.
