---
name: tui-entry-reversible-descend-navigation
---

# Entry descend navigation scrolls viewport without losing selection

**Serial order:** runs after `tui-pipeline-tree-retain-full-flatten` (00) and `tui-monitor-scroll-viewport-selectables` (01).

`selectNextRun` persists expansion on descend, growing `expandedPipelineNodeIds` while FIFO trimming
(or misaligned selectables) can evict the selected pipeline. `indexOf` returns `-1` and selection
falls through to `ids[0]`; forward `j` walks are not reversible with `k`.

## Problem

On a short terminal with many pipelines, walking `j` from the first node covers a strict subset of
the tree; walking `k` back cannot reach pipelines evicted during the forward walk. Pressing `j` on
the oldest visible pipeline expands it and can evict that same pipeline from the selectable list.

## Decisions

- `j`/`k` advance within `monitorSelectableNodeIds` and scroll the painted viewport so the selected row stays visible — rules out leaving selection valid but off-screen with no scroll follow.
- Descend-expand adds the selected pipeline or stage to `expandedPipelineNodeIds` without removing that id from `monitorSelectableNodeIds`; selection moves to its first child — rules out silent `ids[0]` fallthrough when `indexOf` is `-1`.
- A selected node id is never absent from `monitorSelectableNodeIds` after a navigation step — rules out any nav path that drops the cursor target from walk order.

## Acceptance criteria

- [ ] `tui-entry.test.tsx` — with more pipelines than fit the pane, walking `j` from the first selectable node to the last and `k` back visits the same node set in reverse; no pipeline present at the start is absent at the end; fails pre-fix.
- [ ] `tui-entry.test.tsx` — selecting the oldest visible pipeline and pressing `j` keeps that pipeline in `monitorSelectableNodeIds` and moves selection to its first child; fails pre-fix.
- [ ] `tui-entry.test.tsx` — a selected node id is never absent from `monitorSelectableNodeIds` after `selectNextRun` or `selectPreviousRun`; fails pre-fix.
- [ ] `tui-entry.test.tsx` — after `j`/`k` moves selection beyond the painted viewport, the selected row appears in the painted left-pane tree slice; fails pre-fix.
- [ ] `tui-entry.test.tsx` — reintroducing selection fallthrough to `ids[0]` when the selected id leaves the list turns the descend-navigation pins RED; `Mutation checkpoint:` names that fallthrough.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/v1-behaviors.md` — replace the descend-eviction caveat with the scrolling contract.
- `v2/docs/operator-runbook.md` — `jarvis tui` row: what the pane does when the tree exceeds it.

## Prerequisites

- Today: `flattenMonitorPipelineTree` FIFO-drops terminal pipelines when expanded rows exceed `maxVisibleRows`.
- Today: `monitorSelectableNodeIds` and painted left-pane tree rows both derive from the same FIFO-trimmed `buildMonitorPipelineTree` output.
- Today: `selectNextRun` persists descend expansion into `expandedPipelineNodeIds`; `selectPreviousRun` walks the same selectable order in reverse.
- Today: selection can fall through to `ids[0]` when the selected id is absent from `monitorSelectableNodeIds`.
- `currentState` carries measured `terminalColumns` and `terminalRows` for `monitorSelectableNodeIds`.
