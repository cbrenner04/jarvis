---
name: tui-left-right-pane-divider
---

# TUI split layout paints a vertical pane divider

## Prerequisites

## Surface

CLI (operator-facing `jarvis tui` shell layout and its monitor render).

Splitting does not apply: the divider column is one behavior owned by the TUI shell-layout seam (`computeShellLayout` plus its sole monitor render consumer), with no second module boundary to cross.

## Problem

- In split layout the left work-tree pane and the right detail pane abut with no painted separation, so a wide right-pane line and a left-pane row read as one stream; the `[`/`]` nudges move the split with nothing to anchor the eye.

## Behavior

- Split layout paints a one-column vertical divider between the left and right panes, theme-consistent with the ruled `── Work ──`/`── Queue ──` headings; stacked layout paints none.

## Decisions

- The divider owns its own column: left keeps its computed width, the divider takes one column, and the right pane takes the remainder, so widths still sum to the terminal column count; rules out overpainting a content column or letting total width exceed `columns`.
- Account for the divider in the shell-layout computation, not only in the render tree; rules out a painted glyph whose column the layout consumers still hand to right-pane content composition.
- Stacked layout (below the 120-column threshold) is unchanged; rules out a horizontal rule between vertically stacked panes.

## Required verification

- A layout test pins left width, divider column, and right width summing to the terminal column count in split layout, and fails against the pre-fix widths.
- A test pins the right pane's usable width shrinking by exactly one column versus pre-fix, with no content clipped.
- A render test pins that split layout paints the divider between the panes and stacked layout paints no inter-pane divider.
- `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — the split-layout pane divider and the divider column's place in the Observe section's left/right width accounting.
- `v2/docs/v1-behaviors.md` — revised split-pane width split (left/divider/right) for the documented terminal widths.
