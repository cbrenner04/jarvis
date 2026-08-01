---
name: tui-descend-expansion-evicts-pipelines-permanently
---

# Descending with j expands as it goes, pushing older pipelines out of the FIFO viewport for good

## Problem

`selectNextRun` persists an expansion every time it descends into a collapsed pipeline or stage.
Each expansion adds rows; once the flattened tree exceeds the pane budget,
`dropOldestTerminalPipeline` evicts the oldest terminal pipelines. Those pipelines do not return
when the operator walks back up, because the expansions that displaced them stay in
`expandedPipelineNodeIds`. Walking down a long tree therefore destroys the top of it.

## Evidence

Measured during review of #2473, 2026-08-01, at `100x24` with 30 pipelines:

- forward walk starts at `pipe-10` and covers 56 nodes
- backward walk bottoms out at `pipe-24`
- **14 pipelines are unreachable afterwards, with no key that brings them back**

Edge case in the same run: pressing `j` while the oldest *visible* pipeline is selected expands it,
which evicts that same pipeline — `monitorSelectableNodeIds` no longer contains it, `indexOf`
returns `-1`, and selection falls through to `ids[0]`. The row under the cursor disappears and its
stages are never shown.

## Decisions

- Walking the tree never makes a previously reachable pipeline unreachable. Rules out today's descend-expands-then-evicts sequence.
- The viewport scrolls rather than discarding: rows outside the pane are off-screen, not removed from the selectable list. Rules out FIFO eviction as the only fit strategy once a tree overflows.
- Selection never falls through to `ids[0]` because the selected id left the list. Rules out the silent jump-to-top on the oldest visible row.
- FIFO eviction of terminal pipelines stays valid for *unselected, uninvolved* pipelines when nothing is being navigated. Rules out removing retention entirely.

## Acceptance criteria

- [ ] With more pipelines than fit the pane, walking `j` from the first node to the last and back with `k` visits the same node set in reverse; no pipeline present at the start is absent at the end.
- [ ] Selecting the oldest visible pipeline and pressing `j` keeps that pipeline in the selectable list and moves selection to its first child.
- [ ] A selected node id is never absent from the selectable list after a navigation step.
- [ ] Rows beyond the pane budget are reachable by continued navigation (scroll), not dropped from the selectable list.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/v1-behaviors.md` — replace the descend-eviction caveat with the scrolling contract.
- `v2/docs/operator-runbook.md` — `jarvis tui` row: what the pane does when the tree exceeds it.

## Prerequisites

- `v2/src/tui/tui-entry.tsx` — `selectNextRun` persist-on-descend, `selectPreviousRun`
- `v2/src/tui/tui-monitor-pipeline-tree.ts` — `dropOldestTerminalPipeline`, `maxVisibleRows` budget
- `v2/src/tui/tui-monitor-lines.ts` — `monitorSelectableNodeIds`
