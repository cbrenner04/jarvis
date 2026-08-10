# Render interactive work rows

## Problem

- The Ink path still renders grid cells and the selection caret, so the semantic marker and row-wide selection presentation cannot reach the screen.

## Decisions

- Render every work-tree row through `renderSegmentRow`; tree builders supply toned segments directly and selection applies inverse to every segment, including label fill padding, without replacing `RUN_STATUS_TONES` or liveness tone.
- No tree row emits `>`; selection is inverse-only. Pressing `e` on the selected structural expandable node updates the effective expansion set so its rendered semantic glyph flips, while `e` on a leaf leaves state and its blank marker unchanged.

## Tasks

- Route pipeline, branch, stage, run, and ad-hoc rows through the segment renderer and remove the prebuilt row rendering path.
- Apply row-wide inverse selection while retaining status and liveness segment tones.
- Exercise injected-input expansion and selection rendering, including the unselected and leaf negative cases.
- Update `v2/docs/operator-runbook.md` § Observe and `v2/docs/v1-behaviors.md` § TUI / observability for the shipped row presentation.

## Acceptance criteria

- [x] Selected pipeline, branch, stage, run, and ad-hoc rows render inverse across their complete padded width, unselected rows do not render inverse, and neither emits a `>` caret while status and liveness segments retain their existing tones. `v2/src/tui/tui-ink-monitor.test.tsx` test `renders selected tree rows inverse without a caret` fails against the pre-fix renderer and passes after the change.
- [x] Pressing `e` through the injected input on a selected structural expandable node flips its rendered `▼`/`▶` glyph, while pressing it on a leaf changes neither expansion state nor the blank marker. `v2/src/tui/tui-ink-monitor.test.tsx` test `e toggles the selected expandable row glyph` fails against the pre-fix interactive rendering and passes after the change.
- [x] `v2/src/tui/tui-ink-monitor.test.tsx` — `renders selected tree rows inverse without a caret`; Keystone checkpoint: an in-body `// @mutate` restores the caret or label-only selection baseline on the real selection presentation guard and turns the scoped test red.
- [x] `v2/src/tui/tui-ink-monitor.test.tsx` — `renders selected tree rows inverse without a caret`; Mutation checkpoint: in-body `// @mutate` directives invert every added or modified selection, inverse-fill, and caret-suppression guard on its real production condition, and the unselected negative case proves inverse is absent.
- [x] `v2/src/tui/tui-ink-monitor.test.tsx` — `e toggles the selected expandable row glyph`; Mutation checkpoint: in-body `// @mutate` directives invert every added or modified selected-expandable toggle guard on its real production condition, and the leaf negative case proves no toggle occurs.
- [x] `v2/src/tui/tui-ink-monitor.test.tsx` test `colors status and liveness cells on run-table rows`, `v2/src/tui/tui-monitor-lines.test.ts` test `live is active and not-live is untoned`, and `v2/src/tui/tui-ink-monitor.test.tsx` test `drives workflow expansion through the injected input hook` stay green.
- [x] `v2/docs/operator-runbook.md` § Observe documents indent/marker/fill-label/right-cluster anatomy, `▼`/`▶`/`✋`/`✗`, inverse selection, and right-to-left cluster degradation; `v2/docs/v1-behaviors.md` § TUI / observability records grid/tier removal, per-kind clusters, indentation, expansion glyphs, and inverse selection.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Observe: row anatomy, glyph legend, inverse selection, and narrow-pane degradation.
- `v2/docs/v1-behaviors.md` § TUI / observability: grid/tier removal, fill labels, per-kind clusters, indentation, expansion glyphs, and inverse selection.
