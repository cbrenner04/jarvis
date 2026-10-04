---
name: tui-attention-row-enter-reveal
---

# Reveal an attention target with tree-focus Enter

Single module-boundary surface — the TUI monitor session (key binding in `tui-ink-monitor.tsx`, reveal control on `TuiMonitorControls` in `tui-entry.tsx`, contextual hint in `tui-monitor-lines.ts`) — so splitting does not apply; it is one behavior well inside the reviewability rule.

## Prerequisites

- Attention rows are built and a selected attention row is resolvable from `state.selectedNodeId` (`selectedAttentionRow` in `tui-entry.tsx`, shipped with attention-row gate dispatch in #2804).
- `TuiMonitorControls.selectNode(nodeId)` changes selection to a selectable tree or unattributed row.
- Tree rows expand implicitly along the selected node's ancestors and scroll-follow paints the selected row inside the viewport.

## Problem

Tree-focus Enter is unbound, so a selected attention row can surface an incident but cannot move selection to its underlying tree node. Scoped to targets already present in the tree; the collapsed non-representative run-member reveal is deferred to the `tui-tree-reveal-collapsed-workflow-member` seed.

## Decisions

- Bind unmodified tree-focus Enter on a selected attention row to select its `targetId` through the existing `selectNode` path — rules out a separate navigation state or alias selection.
- Preserve `expandedPipelineNodeIds`; rely on selected-ancestor expansion plus scroll-follow for the reveal — rules out converting implicit reveal into durable explicit expansion.
- Leave tree-focus Shift+Enter and Enter on every non-attention row inert; command-focus Enter still submits — rules out a second activation binding or stealing the dock editor key.
- Advertise the Enter reveal in the tree hints only while an attention row is selected — rules out a permanently inapplicable hint.
- Keystone/mutation checkpoints carry linkable `// @mutate` directives on the Enter-binding guard, per #2806 — rules out re-stranding on prose-only checkpoints.

## Acceptance criteria

- [ ] Tree-focus Enter on a selected attention row selects its target, leaves `expandedPipelineNodeIds` unchanged, and produces a painted selected tree row inside the scroll-follow viewport with every required ancestor expanded; a `tui-entry.test.tsx` regression pins it and fails against the pre-fix unbound key. The regression carries a linkable `// @mutate` directive on the Enter-binding guard.
- [ ] Tree-focus Enter and Shift+Enter on a pipeline, branch, stage, run, or ad-hoc tree row leave selection and explicit expansion unchanged (existing non-attention-row Enter/Shift+Enter coverage stays green).
- [ ] Tree hints advertise Enter reveal only while an attention row is selected; command-focus Enter still submits (existing `submits only focused command input` and command-hint tests stay green).
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Observe and § Dock commands — tree-focus Enter reveal from an attention row and its contextual hint.
- `v2/docs/v1-behaviors.md` § TUI / observability — the attention-target Enter binding and preserved explicit expansion state.
