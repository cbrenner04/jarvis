---
name: tui-work-row-fill-layout
---

# TUI work-row layout — fill-width labels, real indent, expansion glyphs

TUI command-center phase ([tui-command-center-brief.md](../tui-command-center-brief.md)), on the unified work tree and its branch subtree.

## Problem

The fixed 10-column grid (`TREE_COLUMN_WIDTHS`) inverts priorities: it reserves width for columns that are empty on most row kinds (`project`/`branch`/`agent`/`id` — the last two always render `""` at full width) while the cell that identifies the row truncates at 22 chars. Two shipped defects ride on it. The 2-col indent cell is padded to width for every row kind, so a pipeline row and its stage rows start at the same offset and hierarchy is invisible. Expansion state has no glyph at all: the marker cell carries only the `>` selection caret, so nothing on screen says whether a row hides children. Pipeline and stage rows are built as padded strings and then re-sliced by the same widths in the renderer (`splitPrebuiltTreeRow`), so the grid is encoded twice.

## Decisions

- Row anatomy is `indent · marker · label (fills remaining width) · right-aligned status cluster`. Rules out per-column width reservation.
- `TREE_COLUMN_WIDTHS`, `visibleColumns`, the width-tier table, `listMonitorTreeCellsAtDepth`, and `splitPrebuiltTreeRow` are deleted with their tests. Rules out leaving the grid as a dormant second layout path.
- Row builders return toned segments and render through the existing segment renderer. Rules out the prebuilt-string-then-re-slice path, which is what duplicated the widths.
- Indent is two columns per depth level, so pipeline, branch/stage, and run rows start at strictly increasing offsets. Rules out the padded fixed-width indent cell that made depth a no-op.
- Marker is `▼` on an expanded row, `▶` on a collapsed one, blank on a leaf. Rules out reusing the marker slot for selection.
- Selection renders as row tone/inverse across the whole row; the `>` caret is retired. Revisit only if tone-only proves illegible in dogfood.
- Cluster per kind: pipeline `definition · attention glyphs (✋n ✗n) · elapsed`; branch `current stage + status · elapsed`; stage `status · elapsed`; run `status · live · elapsed`. Rules out one uniform cluster, which is what forced empty reserved columns.
- Attention counts come from the pipeline's own stage records — `✋` per awaiting or rejected gate, `✗` per failed stage. Rules out deferring the glyphs to the attention segment.
- Label truncates with `…`; a row never wraps. Rules out the right-pane wrapping behavior leaking into tree rows.
- Narrow panes drop cluster elements right-to-left; below the floor the row is `indent · marker · label · status`. Rules out truncating the label first, which is the defect being fixed.
- Elapsed values are unchanged (wall clock); work/idle semantics ride a later seed.
- Tone rules are unchanged (`RUN_STATUS_TONES`).

## Acceptance criteria

- [ ] Rows at depths 0/1/2 start at strictly increasing column offsets. Fails against pre-fix code, where the padded indent cell renders every kind at the same offset.
- [ ] An expanded expandable row renders `▼`, a collapsed one `▶`, and a leaf renders neither; `e` on the selected row flips the glyph.
- [ ] At a reference width each kind's cluster is right-aligned at the row's right edge and the label spans the width between marker and cluster.
- [ ] A label longer than the width available to it truncates with `…`, and every row is exactly one line at every width.
- [ ] As width shrinks, cluster elements drop right-to-left; at the floor the row is `indent · marker · label · status` and the label keeps the remaining width.
- [ ] A pipeline row with one awaiting gate and one failed stage renders `✋1 ✗1` in its cluster.
- [ ] A selected row is rendered by tone/inverse across the full row, and no tree row emits a `>` caret.
- [ ] `TREE_COLUMN_WIDTHS`, `visibleColumns`, the width-tier table, `listMonitorTreeCellsAtDepth`, and `splitPrebuiltTreeRow` no longer exist under `v2/src/`, and the tests covering them are removed with them.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Observe — row anatomy, glyph legend (`▼ ▶ ✋ ✗`), selection by tone, what drops first when the pane narrows.
- `v2/docs/v1-behaviors.md` § TUI / observability — the column grid and its width tiers are gone; rows are indent/marker/fill-label/right-cluster with per-kind clusters and tone-only selection.
- `v2/docs/test-writing.md` § TUI test strategy — the pure-layout substitute now covers row composition and cluster degradation rather than column degradation.

## Prerequisites

- Pipeline rows are labeled with the seed slug, falling back to definition name plus short `pipelineId` when no `seedPath` was recorded.
- Run rows lead with the role and follow with the short `runId`; ad-hoc top-level rows are labeled with their entry run's branch.
- Ad-hoc workflow invocations render as top-level nodes in the same flatten as pipelines.
- The work tree renders one node per fan-out branch, labeled with the stripped `branchKey` and summarized by its current stage plus status.
- Post-split `default` placeholder rows and satisfied gate rows are already elided from the tree.
- Every display node carries its depth, and the effective expansion set is resolved before rows are built (`flattenMonitorPipelineTree`, `v2/src/tui/tui-monitor-pipeline-tree.ts`).
- `e` toggles expansion of the selected expandable node (`toggleSelectedWorkflowExpansion`, `v2/src/tui/tui-ink-monitor.tsx`).
- `MonitorSegment`/`MonitorLineRow` rows with `RUN_STATUS_TONES` tones render through the ink segment renderer (`v2/src/tui/tui-monitor-lines.ts`, `renderSegmentRow`).
- `PipelineSnapshot` stage records carry `status` and `branchKey` for gate and failure counting (`v2/src/daemon/pipeline-observation.ts`).
