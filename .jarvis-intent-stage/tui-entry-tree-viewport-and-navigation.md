---
name: tui-entry-tree-viewport-and-navigation
---

# Entry tree viewport alignment and reversible navigation

Entry derives selectable node ids from `currentState` without terminal dimensions while ink paints
from `monitorShellState`, so `j`/`k` can target unpainted rows and walk order is not reversible.

## Problem

`monitorSelectableNodeIds(currentState)` falls back to 245×72 because `currentState` never carries
measured terminal size; ink uses `monitorShellState` with real dimensions. On a 24-row terminal with
30 pipelines, entry offers 30 selectable ids while the pane paints 20. The navigation pin at
`tui-entry.test.tsx` encodes skipping the stage and run walked through on `k`.

## Decisions

- `currentState` carries measured terminal dimensions before any `monitorSelectableNodeIds` call — rules out shell-only injection via `monitorShellState`.
- Selectable ids and painted tree rows use the same `terminalColumns`/`terminalRows` on the state passed to `monitorLeftPaneTreeRows` — rules out entry fallback diverging from ink layout.
- `j`/`k` walk `monitorSelectableNodeIds` in order without deselect collapsing rows out from under the cursor — rules out the current orphan→pipeline skip on `selectPreviousRun`.

## Acceptance criteria

- [ ] Pressing `e` twice on a selected stage through the injected input hook returns left-pane tree row ids to their starting value with a distinct intermediate list; `tui-entry.test.tsx` fails pre-fix when reveal-on-select still self-expands the selection.
- [ ] From a run leaf, `selectPreviousRun` twice selects that run's stage then its pipeline — the same nodes `selectNextRun` traversed, in reverse; `tui-entry.test.tsx` `drives row navigation through the injected input hook` fails pre-fix and passes after.
- [ ] With more pipelines than fit a small terminal, every id from `monitorSelectableNodeIds(currentState)` appears in left-pane tree row ids for the same terminal size; a regression test fails pre-fix.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — `jarvis tui` row: replace the self-expand caveat with real `e` and `j`/`k` behavior.

## Prerequisites

- Reveal-on-select expands ancestors of the selected node without adding the selected node id to effective expansion.
- `expandedNodeIds` membership changes flattened tree output for a selected collapsed pipeline or stage in both directions.
- Three-deep `selectedNodeId` selection and `e` toggling `expandedPipelineNodeIds` on pipeline and stage rows are wired in entry and ink.
