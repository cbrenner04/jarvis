---
name: tui-left-pane-width-and-timing-threshold
---

# TUI left-pane width and labeled-timing threshold: readable work · idle at ordinary terminal widths

Surface: pane geometry — the left-width clamp in `v2/src/tui/tui-shell-layout.ts` and the compact/labeled timing threshold in `v2/src/tui/tui-monitor-pipeline-tree.ts`. Left-pane section framing and row content are a separate surface.

## Problem

`computeShellLayout` clamps the left pane to ~38–40% of terminal width (`LEFT_BASE_FRACTION` 0.38, `LEFT_CEILING_FRACTION` 0.4), and the tree timing cell only renders the labeled `work <d> · idle <d>` form at a left-pane width ≥100 cols (`width < 100` picks compact in three sites). On the operator's normal ~180–200-col terminal the labeled form the brief designed never appears; only the cryptic `w16m/i6d` fallback does. The runbook already flags the clamp as a deferred retune.

## Decisions

- Raise the left-pane width fraction/floor and lower the labeled-timing threshold together, so the labeled form is what actually paints; the constraint is labeled `work <d> · idle <d>` visible at ≤200 terminal cols. Rules out retuning width alone (still compact) or the threshold alone (cell too narrow to fit).
- Keep the compact `w<d>/i<d>` form as the genuine narrow-terminal fallback below the new threshold, including its `w<d>/i…` overflow elision. Rules out deleting the compact form.
- Exact fraction/floor/threshold values pinned by the plan against the ≤200-col constraint.
- The stacked-layout threshold, divider nudges, right pane, and dock are unchanged. Rules out reworking layout modes.

## Acceptance criteria

- [ ] At a representative ordinary terminal width (≤200 cols), a pipeline/branch row's timing renders the labeled `work <d> · idle <d>` (or `work <d>`) form, not the compact `w<d>/i<d>` form. Pinned by a timing test at that width.
- [ ] Below the new threshold the compact `w<d>/i<d>` form still renders, and its overflow still elides to `w<d>/i…`. Pinned by a timing test at a narrow width.
- [ ] `computeShellLayout` returns the retuned left-pane width at ordinary and wide terminal widths, with base ≤ ceiling and the stacked threshold unchanged. Pinned by a shell-layout test.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — Observe section: record the new left-width clamp values and the new labeled-timing floor, and remove the "left pane clamped to ~38–40%, 100-column floor needs a ~250-column terminal, retune left as a follow-up" note.

## Prerequisites

- The left pane renders a ruled `── Work (N) ──` heading and a ruled `── Queue (N) ──` heading.
- The tree row budget (`leftPaneTreeMaxVisibleRows`) reserves the attention, Work, and Queue heading rows and never goes negative.
- Terminal (not-live) run rows paint no `idle` liveness atom.
