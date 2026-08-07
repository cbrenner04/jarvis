---
name: tui-work-row-anatomy
---

# TUI work-row anatomy — fill-width labels, real hierarchy, seed-slug identity

TUI command-center phase ([tui-command-center-brief.md](../tui-command-center-brief.md)), on the unified tree (`tui-unified-work-tree`) and branch subtree (`tui-intent-branch-subtree`).

## Problem

The fixed 10-column grid (`TREE_COLUMN_WIDTHS`) inverts priorities: it spends width on columns that are empty for most row kinds (project/branch/agent/id) while truncating the one cell that identifies the row (label, 22 chars). Three shipped defects compound it: the 2-col indent cell is padded to width for every row kind, so pipeline and stage rows render at identical offsets and hierarchy is invisible; expansion state has no glyph (only the `>` selection caret renders, the brief's `▼/▶` never shipped); and the pipeline label is the registry definition name (`full-review`), identical for every pipeline — seed identity only surfaces in the detail pane.

## Decisions

- Row anatomy: `indent (per depth) · marker · label (fill remaining width) · right-aligned status cluster`. The fixed grid and its width-tier table are deleted. Rules out per-column width reservation.
- Marker: `▼`/`▶` on expandable rows reflecting expansion state; leaves get none. Selection is shown by row tone/inverse; the `>` caret is retired. (Revisit only if tone-only proves illegible in dogfood.)
- Indent is real and per-depth: each level shifts the row two columns; pinned so pipeline < stage/branch < run offsets differ.
- Labels: pipeline = seed slug (`seedPath` basename sans extension; fallback when absent, e.g. `--seed-text`: definition name + short `pipelineId`); ad-hoc item = entry run's branch; branch node = stripped `branchKey`; stage = `stageId`; run = role + short `runId`.
- Right-aligned clusters per kind, so states align vertically: pipeline `definition · attention glyphs (✋n ✗n) · elapsed`; branch `current stage + status · elapsed`; stage `status · elapsed`; run `status · live · elapsed`. Elapsed semantics change later (`tui-work-idle-time`); this seed keeps existing values.
- Label truncates with `…`; rows never wrap. Narrow panes drop cluster elements right-to-left before touching the label; below a floor the row is `indent · marker · label · status`.
- Tone rules unchanged (`RUN_STATUS_TONES`); gates awaiting render with the attention glyph `✋`, failures `✗`.

## Acceptance criteria

- [ ] Pure row builders render `(node, selection, expansion, width)` → string/segments with fill-width label and right-aligned cluster; `TREE_COLUMN_WIDTHS`, `visibleColumns`, and the tier table are removed with their tests.
- [ ] Indent pins: rows at depths 0/1/2 start at strictly increasing offsets (the padded-cell no-op is dead).
- [ ] Marker pins: expanded `▼`, collapsed `▶`, leaf blank; toggling `e` flips the glyph.
- [ ] Pipeline label pins: seedPath basename; fallback definition + short id when `seedPath` is absent; two pipelines from different seeds are distinguishable in the rendered row.
- [ ] Cluster pins per kind, right-aligned at reference width; at narrow widths cluster elements drop right-to-left and the label keeps its remaining width.
- [ ] Selection renders as tone/inverse on the full row; no `>` caret remains in tree rows.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Observe — row anatomy, glyph legend (`▼▶ ✋ ✗`), what identifies a pipeline.

## Prerequisites

- `v2/src/tui/tui-shell-layout.ts` — `TREE_COLUMN_WIDTHS`, `visibleColumns`, `listMonitorTreeCellsAtDepth`, `formatTreeCell`
- `v2/src/tui/tui-monitor-pipeline-tree.ts` — `buildPipelineMonitorTreeRow`, `buildStageMonitorTreeRow`, `joinPipelineTreeCells`
- `v2/src/daemon/pipeline-observation.ts` — `seedPath` on `PipelineSnapshot`
- `v2/docs/test-writing.md` § TUI test strategy
