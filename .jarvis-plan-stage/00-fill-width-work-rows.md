# Replace the tree grid with fill-width rows

## Problem

- The fixed ten-column tree grid reserves blank cells while truncating the identifying label to 22 columns.
- The padded indent cell paints different depths at the same label offset.
- The selection caret occupies the only marker slot, so expansion state is invisible.
- Pipeline/stage builders prebuild padded strings that the ink renderer slices through the same grid a second time.

## Decisions

- Compose every work-tree row as `indent · marker · fill label · right-aligned cluster`; rules out retaining per-column reservations for any row kind.
- Return `MonitorLineRow` segments from tree-row builders and paint them through the segment renderer; rules out any prebuilt-string or re-slicing path.
- Paint two display columns of indent per `depth`; rules out a single padded indent cell and kind-derived indentation.
- Paint `▼` for effectively expanded pipeline/branch/stage nodes, `▶` for collapsed ones, and a blank marker for run/ad-hoc leaves; rules out selection glyphs in the marker slot.
- Carry selection as row presentation state and apply inverse across every segment, including fill padding; rules out a caret or label-only highlight.
- Use full clusters by kind: pipeline `definition · attention · elapsed`, branch `current stage + status · elapsed`, stage `status · elapsed`, run `status · live · elapsed`; rules out a uniform cluster with empty placeholders.
- Derive pipeline attention only from that snapshot's approval-stage records (`✋` for `awaiting`/`rejected`) and failed stage records (`✗`); rules out global counts or delegation to the later attention segment.
- Fit by display width without wrapping: reserve hierarchy and the compact status atom, remove optional cluster atoms right-to-left, then give the label every remaining column and ellipsize overflow; rules out fixed width tiers and label-first truncation.
- At the narrow floor, substitute pipeline state for the pipeline's optional full cluster; branch keeps current stage plus status, while stage/run keep status; rules out treating the pipeline definition as its compact status.
- Preserve wall-clock elapsed values, role/seed/branch labels, collapsed-workflow suffixes, `RUN_STATUS_TONES`, and liveness tone; rules out pulling later work/idle semantics or a new palette into this change.
- Delete `TREE_COLUMN_WIDTHS`, `visibleColumns`, the width-tier table, `listMonitorTreeCellsAtDepth`, `splitPrebuiltTreeRow`, and their grid-specific tests; rules out a dormant fallback layout.

## Tasks

- Replace the grid helpers with a pure display-width row composer and per-kind segment builders for every `MonitorPipelineTreeDisplayNode`.
- Make effective expansion available when rows are composed, derive pipeline attention counts, and retain existing elapsed and label sources.
- Route all work-tree rows through the segment renderer, applying row-wide inverse selection while preserving segment tones.
- Replace grid/tier assertions with pure composition, degradation, glyph, attention, and selection tests; retain the injected-input expansion test.
- Update `v2/docs/operator-runbook.md` § Observe, `v2/docs/v1-behaviors.md` § TUI / observability, and `v2/docs/test-writing.md` § TUI test strategy in the same change.

## Acceptance criteria

- [ ] Depths 0/1/2 place markers and labels at strictly increasing two-column offsets; expandable rows paint `▼` or `▶` from effective expansion, leaves paint neither glyph, and `e` flips the selected expandable row's glyph.
- [ ] At reference width, pipeline, branch, stage, and run clusters use their declared per-kind atoms, end at the row's right edge, and leave all intervening width to the label; one awaiting approval gate plus one failed stage paints `✋1 ✗1` on that pipeline only.
- [ ] At every tested pane width each work-tree row occupies exactly one display line; overflow labels end in `…`, optional cluster atoms disappear right-to-left before label width is surrendered, and the narrow floor retains hierarchy, the fill label, and the kind's compact status.
- [ ] Selection inverses the complete padded row without changing existing status/liveness tones; selected and unselected work-tree rows emit no `>` caret.
- [ ] `TREE_COLUMN_WIDTHS`, `visibleColumns`, the width-tier table, `listMonitorTreeCellsAtDepth`, and `splitPrebuiltTreeRow` have no production references under `v2/src/`, and grid-specific tests are removed.
- [ ] `tui-shell-layout.test.ts` tests `run-row elapsed uses createdAt through finishedAtMs or nowMs` and `finishless terminal run elapsed keeps advancing when nowMs advances`, `tui-monitor-pipeline-tree.test.ts` tests `two pipelines of one definition label their rows with distinct seed basenames` and `a pipeline with no recorded seed path labels its row with the definition name and short pipeline id`, and `tui-monitor-lines.test.ts` test `live is active and not-live is untoned` stay green.
- [ ] `v2/src/tui/tui-shell-layout.test.ts` — `fills labels between hierarchy and per-kind clusters`; Keystone checkpoint: the test fails against the pre-fix fixed grid and contains an in-body `// @mutate` that restores the fixed-label baseline on the real production calculation.
- [ ] `v2/src/tui/tui-shell-layout.test.ts` — `drops optional cluster atoms before shrinking the label`; Mutation checkpoint: in-body `// @mutate` directives invert every added or modified fit/degradation guard on its real production condition, and negative cases prove dropped atoms remain absent while label width remains available.
- [ ] `v2/src/tui/tui-monitor-pipeline-tree.test.ts` — `derives expansion glyphs and pipeline attention from node state`; Mutation checkpoint: in-body `// @mutate` directives invert every added or modified expansion/attention guard on its real production condition, and negative cases prove leaves have no glyph and unrelated stage records add no attention count.
- [ ] `v2/src/tui/tui-ink-monitor.test.tsx` — `renders selected tree rows inverse without a caret`; Mutation checkpoint: in-body `// @mutate` directives invert every added or modified selection guard on its real production condition, and the unselected negative case proves inverse is absent.
- [ ] `v2/docs/operator-runbook.md` documents row anatomy, `▼`/`▶`/`✋`/`✗`, row-tone selection, and narrow-pane degradation; `v2/docs/v1-behaviors.md` records removal of the grid/tiers and the per-kind clusters; `v2/docs/test-writing.md` replaces column-degradation guidance with row-composition and cluster-degradation coverage.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Observe: row anatomy, glyph legend, selection, and narrow-pane degradation.
- `v2/docs/v1-behaviors.md` § TUI / observability: grid/tier removal, fill labels, per-kind clusters, indentation, expansion glyphs, and inverse selection.
- `v2/docs/test-writing.md` § TUI test strategy: pure row composition and cluster degradation replace column degradation.
