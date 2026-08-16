---
name: tui-left-right-pane-divider
---

# No visual separation between the tui's left and right panes

## Problem

In split layout, `jarvis tui` renders the left work-tree pane and the right detail pane as two adjacent `Box` columns (`v2/src/tui/tui-ink-monitor.tsx`, the `flexDirection: "row"` container holding `leftPane` and `rightPane`) with no border or rule between them. Observed 2026-08-16: the two columns run together visually, so a wide right-pane detail line and a left-pane row read as one stream. The `[`/`]` divider nudges move the split but there is no painted divider to anchor the eye.

## Decisions

- Paint a one-column vertical divider between the left and right panes in split layout (a ruled glyph column, or `borderLeft` on the right pane), theme-consistent with the existing ruled `── Work ──`/`── Queue ──` headings. Rules out relying on whitespace alone.
- The divider occupies its own column: left pane keeps its computed `leftWidth`, the divider takes one column, and the right pane gets the remainder — so total width still sums to `columns` and no content is clipped by the addition. Adjust `computeShellLayout` accounting rather than overpainting a content column.
- Stacked layout (below the 120-column threshold) is unchanged — no divider between vertically stacked panes.

## Acceptance criteria

- [ ] Split layout paints a vertical divider column between the panes; left/divider/right widths sum to the terminal column count, pinned by a layout test.
- [ ] The right pane's usable width shrinks by exactly the divider column versus pre-fix, with no content clipped, pinned by a test.
- [ ] Stacked layout paints no inter-pane divider, pinned by a test.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — note the split-layout pane divider in the Observe section's layout description.
