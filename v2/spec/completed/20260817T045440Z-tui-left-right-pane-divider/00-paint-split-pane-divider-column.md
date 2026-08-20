# Paint the split-pane divider column

## Problem

In split layout the left work-tree pane and the right detail pane abut with no painted separation: `computeShellLayout` splits the terminal into `leftWidth` + `rightWidth` with nothing between, and `createMonitorDisplay` places the two pane boxes as adjacent flex children of one row container. A wide right-pane line and a left-pane row read as one stream, and the `[`/`]` nudges move a boundary the eye cannot find.

## Decision ledger

- `ShellLayout` gains a numeric `dividerWidth` (1 in split, 0 in stacked) and `rightWidth` becomes `columns - leftWidth - dividerWidth`; rules out a `hasDivider` boolean each consumer re-translates into a width, and rules out letting left + right still consume every column while a glyph overpaints one of them.
- `dividerWidth` is distinct from the existing `dividerOffset`: offset is where the boundary sits, driven by the `[`/`]` nudges; width is how many columns the divider itself occupies (0 or 1). `dividerOffset` keeps its name — it is documented operator vocabulary.
- The divider column comes out of the right pane; `LEFT_FLOOR`, `LEFT_BASE_FRACTION`, `LEFT_CEILING_FRACTION`, and `NUDGE_DELTA` are untouched; rules out re-tuning the left clamp, which would move the documented 81/90/111 left widths and the 80-column labeled-timing threshold.
- Stacked `rightWidth` keeps its pre-fix `columns - leftWidth`; rules out charging a divider column to a layout that paints none.
- No gutter: right-aligned left-pane content and first-column right-pane content sit flush against the divider (e.g. `…12m 3s│Pipeline`); rules out an implementer inventing a padding column, which would break the left + divider + right sum.
- The divider paints as its own one-column flex child between the two pane boxes, filled with `Math.max(0, paneHeight)` rows of `│` (one per pane row); flooring at zero means a terminal with `rows <= DOCK_HEIGHT` renders zero divider rows instead of a repeat/array construction throwing on a negative length. Rules out an ink `borderStyle`/`borderLeft` on a pane box (which consumes that pane's own width and paints corner glyphs) and rules out prefixing right-pane rows with a glyph (which re-enters right-pane width composition).
- The divider flex child sets `flexShrink: 0`, matching that neither pane box shrinks today; rules out a stale-resize frame squeezing the one-column divider out first.
- Render inclusion is gated on `layout.dividerWidth > 0`, not on a second `layoutMode` test; rules out layout accounting and paint drifting apart.
- The glyph is untoned `│` (U+2502), consistent with the untoned rules in the `── Work ──`/`── Queue ──` headings; rules out ASCII `|` or the dock cursor's `▏`.
- The divider spans the pane band only; the 4-row dock is unchanged; rules out a full-height rule running through the dock.
- The `Box === undefined` render path is unchanged — it paints no boxes and therefore no divider.

## Task checklist

- Add `dividerWidth` to `ShellLayout` and derive `rightWidth` from it in `v2/src/tui/tui-shell-layout.ts`.
- Build the divider element in `v2/src/tui/tui-ink-monitor.tsx` (height-floored, `flexShrink: 0`) and place it between the left and right pane boxes in the split container, gated by `layout.dividerWidth > 0`.
- Update the hard-coded zero-offset `rightWidth` values (99/110/134 → 98/109/133) in `v2/src/tui/tui-shell-layout.test.ts` test `ordinary and wide terminals use the retuned left-pane clamp`.
- Add a new all-narrow detail-row fixture exceeding 134 display columns to `v2/src/tui/tui-monitor-lines.test.ts` for the wrap test below — the existing wrap fixture's widest row (~129 display columns, wide/combining graphemes) can't cross either threshold, so it is added, not reused.
- Add the layout, right-pane wrap, and render tests named in the acceptance criteria.
- Update the two durable docs below, including the split-layout prose outside the width-figure sentences (operator-runbook.md's hard-wrap/dock-nudge sentence in the `jarvis tui` Observe row; v1-behaviors.md's split-pane-layout intro sentence in the `jarvis tui` entry).

## Acceptance criteria

- [x] `v2/src/tui/tui-shell-layout.test.ts` test `split layout reserves a divider column between left and right widths` fails against the pre-fix code and proves zero-offset split left/divider/right widths of 81/1/98 at 180 columns, 90/1/109 at 200, and 111/1/133 at 245 — each summing to the terminal column count — plus `dividerWidth: 0` with `rightWidth: 39` for the stacked 119-column case, plus (at 245 columns) `leftWidth + dividerWidth + rightWidth === columns` holding at both the nudge ceiling (`]` held to `LEFT_CEILING_FRACTION`) and nudge floor (`[` held to `LEFT_FLOOR`) clamp extremes.
- [x] `v2/src/tui/tui-monitor-lines.test.ts` test `split detail wraps one column narrower for the pane divider` adds a new all-narrow detail row exceeding 134 display columns (see task checklist), fails against the pre-fix code, and proves that row wraps at exactly 134 display columns pre-fix and exactly 133 display columns post-fix at 245 terminal columns, rejoining losslessly to the unwrapped text with no `…`.
- [x] `v2/src/tui/tui-ink-monitor.test.tsx` test `split layout paints a pane divider column and stacked layout paints none` fails against the pre-fix code and proves that a 245-column split render carries `│` at display column 111 — measured as `Bun.stringWidth` of each rendered pane row's line up to the divider, matching this file's existing display-width measurement convention — on every painted left work-tree and right detail row within the pane band, and on no dock row, while a 119-column stacked render carries `│` on no row.
- [x] `v2/src/tui/tui-shell-layout.test.ts` — `split layout reserves a divider column between left and right widths`; Keystone checkpoint: an in-body `// @mutate v2/src/tui/tui-shell-layout.ts "rightWidth: columns - leftWidth - dividerWidth," -> "rightWidth: columns - leftWidth,"` directive turns the scoped test red.
- [x] `v2/src/tui/tui-shell-layout.test.ts` — `split layout reserves a divider column between left and right widths`; Mutation checkpoint: an in-body directive inverting the stacked branch of the `dividerWidth` guard to always charge a divider column turns the scoped test red on its 119-column stacked case, proving the suppressed divider column is absent in stacked layout.
- [x] `v2/src/tui/tui-ink-monitor.test.tsx` — `split layout paints a pane divider column and stacked layout paints none`; Mutation checkpoint: an in-body directive forcing the `createMonitorDisplay` divider-inclusion guard to `false` turns the scoped test red by dropping the split divider.
- [x] `v2/src/tui/tui-ink-monitor.test.tsx` — `split layout paints a pane divider column and stacked layout paints none`; Mutation checkpoint: a second in-body directive forcing the same divider-inclusion guard to `true` turns the scoped test red by painting a divider in the stacked case.
- [x] `v2/src/tui/tui-shell-layout.test.ts` test `ordinary and wide terminals use the retuned left-pane clamp` keeps its 81/90/111 left widths, 80-column nudge floor, and 50% nudge ceiling unchanged — only its right-width expectations shift by the divider column — and its tests `each nudge moves dividerOffset and left width by exactly 2 when unclamped` and `width 119 is stacked and width 120 is split` stay green.
- [x] `v2/src/tui/tui-monitor-lines.test.ts` tests `split detail wraps losslessly by display columns without ellipsis` and `stacked detail uses the full terminal width` stay green, and `v2/src/tui/tui-ink-monitor.test.tsx` tests `stacked shell vertically stacks left and right panes below 120 columns` and `paints only the four projected dock rows in split and stacked shells` stay green (stacked layout and dock unchanged).
- [x] `v2/docs/operator-runbook.md` Observe section and the `jarvis tui` entry in `v2/docs/v1-behaviors.md` record the split-layout divider column, the revised zero-offset left/divider/right split of 81/1/98, 90/1/109, and 111/1/133, and that stacked layout paints no inter-pane divider.
- [x] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — Observe section: the painted one-column split-pane divider, replacing the `81/99, 90/110, and 111/134` left/right figures with the left/divider/right accounting; note stacked paints none. Also revise the row that describes right-pane hard-wrap width and the `[`/`]` divider-nudge dock so they reflect the divider column rather than only left/right widths.
- `v2/docs/v1-behaviors.md` — the `jarvis tui` parity entry: revise both the split-pane-layout intro sentence (left tree/queue, right detail, dock, `[`/`]` nudge) to mention the painted divider, and the width-figure sentence to the revised split-pane width split (left/divider/right) for the documented terminal widths, plus that stacked layout paints no inter-pane divider.
