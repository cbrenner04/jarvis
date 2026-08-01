---
name: tui-tree-self-expand-hides-the-e-toggle
---

# Reveal-on-select self-expands the selection, so `e` does nothing visible and j/k cannot walk back

## Problem

`resolveEffectiveExpansion` adds the **selected** pipeline/stage node id to the effective expansion
set. The selected node's children are therefore always visible, whether or not the operator has
expanded it. Three consequences, all operator-visible:

1. `e` on the selected stage is a visual no-op — its runs are already shown, and toggling the
   durable id off does not hide them.
2. `j`/`k` is not reversible: stepping down into a stage and its runs, then stepping back up,
   collapses those rows out of the selectable list, so the cursor jumps past them to the parent
   pipeline.
3. Entry and ink disagree on the viewport. `monitorSelectableNodeIds` / `monitorLeftPaneTreeRows`
   fall back to `terminalColumns ?? 245, terminalRows ?? 72`, but entry's `currentState` never
   carries terminal dimensions — `monitorShellState` builds a separate object for the shell. Entry
   offers selectable ids the pane never paints.

## Evidence

Measured during review of #2466 (spec `20260801T122726Z-tui-pipeline-tree-monitor`), 2026-08-01:

- With a stage selected, `expandedPipelineNodeIds: []` and `[stageId]` produce **byte-identical**
  row lists.
- `v2/src/tui/tui-entry.test.tsx:911-937` pins the non-reversible walk as correct: from the orphan
  row, `selectPreviousRun` lands on `pipe-alpha`, skipping the stage and run it just walked through.
- 30 terminal pipelines on a 24-row terminal: entry offers 30 selectable ids while ink paints 20 —
  10 nodes are selectable but never rendered, so `j`/`k` looks frozen.

Subspec 02's first acceptance criterion was ticked on the visual toggle; the wording was corrected
at merge rather than the behavior.

## Decisions

- Selection reveals **ancestors** of the selected node without expanding the node itself — a selected collapsed stage shows its own row, not its runs. Rules out the current self-expand, which makes `e` unobservable.
- `e` on the selected pipeline or stage changes the visible row list in both directions. Rules out a durable-state-only toggle.
- Walking down with `j` and back up with `k` visits the same rows in reverse. Rules out selection changes that mutate the selectable list underneath the cursor.
- The selectable node list and the painted row list derive from the **same** terminal dimensions. Rules out entry's `245×72` fallback diverging from the shell's measured size.
- Terminal dimensions reach the derivation used by entry — either `currentState` carries them or both call sites share one resolved layout. Rules out fixing the fallback constant without fixing the source.

## Acceptance criteria

- [ ] With a stage selected and its id absent from `expandedPipelineNodeIds`, the stage's run rows are **not** in the derived row list; adding the id adds them.
- [ ] Pressing `e` twice on a selected stage returns the row list to its starting value, and the intermediate list differs from it.
- [ ] Selecting a run leaf reveals its ancestor pipeline and stage rows without expanding sibling stages.
- [ ] From a run leaf, `k` selects that run's stage, then its pipeline — the same nodes `j` traversed, in reverse.
- [ ] With more pipelines than fit a small terminal, every id from the selectable-node list appears in the derived row list for the same terminal size — no selectable-but-unpainted node.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — `jarvis tui` row: replace the self-expand caveat with the real `e` and navigation behavior.

## Prerequisites

- `v2/src/tui/tui-monitor-pipeline-tree.ts` — `resolveEffectiveExpansion`, `stageRunsForExpansion`
- `v2/src/tui/tui-monitor-lines.ts` — `monitorSelectableNodeIds`, `monitorLeftPaneTreeRows`, the `245`/`72` fallback
- `v2/src/tui/tui-entry.tsx` — `monitorShellState`, `firstSelectableNodeId`, selection controls
- `v2/src/tui/tui-entry.test.tsx` — the navigation pin that currently encodes the non-reversible walk
