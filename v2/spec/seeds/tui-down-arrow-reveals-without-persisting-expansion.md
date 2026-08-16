---
name: tui-down-arrow-reveals-without-persisting-expansion
---

# Scrolling down auto-expands every collapsed node you pass through

## Problem

In `jarvis tui`, walking the tree with ↓ (or `j`) into a collapsed pipeline, stage, or branch expands it for the session via the same `expandedPipelineNodeIds` store as the `e` key. Observed 2026-08-16: an operator trying to scroll *past* collapsed work instead expanded each node in turn, exploding the tree and defeating the scroll. Selection movement and expansion are conflated — navigation has an irreversible side effect.

Reveal-on-select is still wanted for *painting* (a selected descendant must show its ancestors), but that reveal should be transient, not a persisted toggle: only `e`/`expand` should durably expand a node.

## Decisions

- ↓/`j`/↑ move the selection and reveal the selected row's ancestors for paint only, without writing `expandedPipelineNodeIds`. A node revealed solely to show the selection collapses again once selection leaves it. Rules out navigation persisting expansion.
- `e` (toggle) and the `expand`/`collapse` verbs remain the only writers of `expandedPipelineNodeIds`. Rules out a second expansion source.
- Selecting a descendant of a collapsed node still paints that descendant and its ancestor chain (existing reveal-for-paint), so navigation into collapsed subtrees stays possible — the subtree just does not stay expanded after you move on.

## Acceptance criteria

- [ ] Walking ↓ into a collapsed pipeline/stage/branch selects within it and paints its ancestors but does not add the node to `expandedPipelineNodeIds`, pinned by a test that fails against the pre-fix (persist-on-walk) behavior.
- [ ] After selection moves out of a walk-revealed node, that node is collapsed again (no residual expansion), pinned by a test.
- [ ] `e` and the `expand` verb still durably expand the selected node, pinned by existing/updated tests.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — clarify that ↓/`j` reveal-for-paint without persisting expansion; only `e`/`expand`/`collapse` change the expanded set.
