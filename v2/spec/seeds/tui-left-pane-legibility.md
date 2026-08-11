---
name: tui-left-pane-legibility
---

# TUI left-pane legibility: section headings, wider pane, readable timing

## Problem

The shipped TUI command-center left pane renders three stacked sections — attention, work tree, queue — with no consistent separation, on a pane too thin to show the timing form the brief designed. Dogfooding (2026-08-11) surfaced three concrete gaps against the brief's own reference sketch (`tui-command-center-brief.md` § Design), which shows a `── Work ──` heading and the readable `work 16m · idle 6d` timing:

- **No section separation.** `renderLeftPaneContent` (`v2/src/tui/tui-ink-monitor.tsx`) concatenates attention rows → tree rows → queue rows directly. Only the attention segment has a ruled heading (`── Needs attention (N) ──`); the work tree has *no* heading at all and the queue is a bare undecorated `Queue` line. The three sections run together.
- **Left pane too thin.** `computeShellLayout` (`v2/src/tui/tui-shell-layout.ts`) clamps the left pane to ~38–40% of terminal width (`LEFT_BASE_FRACTION` 0.38, `LEFT_CEILING_FRACTION` 0.4). The runbook already flags this as a deferred retune (`v2/docs/operator-runbook.md`, Observe section). Because the pane is this thin, the readable `work <d> · idle <d>` timing form — which only renders at a left-pane width ≥100 cols (≈ a 250-col terminal) — essentially never appears; operators only ever see the cryptic compact `w16m/i6d` fallback the brief intended as a degradation, not the default.
- **Confusing data points.** (a) A terminal (not-live) run row still paints an `idle` liveness atom (`MONITOR_TREE_NOT_LIVE_LABEL`, `tui-shell-layout.ts`) beside its terminal status — a `completed` run reads `completed … idle`, which is nonsensical; the status already conveys the state. (b) The cryptic `w/i` timing atom (see prior point) reads as noise.

## Decisions

- **One heading style across all three left-pane sections.** Add a ruled `── Work (N) ──` heading before the work tree (N = count of top-level nodes) and change the queue heading to the same ruled `── Queue (N) ──` form, matching the existing `── Needs attention (N) ──`. Rules out leaving the tree headingless or the queue undecorated. No blank-line padding is added between sections — the ruled headings are the separation — so the tree's row budget only loses the one new Work heading row (attention and queue headings already counted).
- **Widen the left pane so the readable timing form renders at ordinary widths.** Raise the fraction/floor (target: `work · idle` legible on a ~180–200-col terminal, the operator's normal width) and lower the labeled-timing width threshold in tandem so the labeled form is what actually paints there. Keep the compact `w/i` form only as the genuine narrow-terminal fallback. Rules out shipping the readable form the brief designed but never letting it appear. Exact fraction/floor/threshold values pinned by the plan; the constraint is: labeled `work · idle` visible at ≤200 cols.
- **Drop the `idle` liveness atom on terminal run rows.** A live run still shows `live`; a not-live run shows no liveness atom (its terminal status carries the meaning). Rules out the `completed … idle` contradiction. Queued rows are unaffected (they live in the Queue section, not the tree).
- **No structural changes to the attention segment, tree model, selection, expansion, right pane, or dock.** Scope is left-pane section framing, pane width, and the two confusing atoms only. Rules out command-grammar or divider rework (brief non-goals).

## Acceptance criteria

- [ ] The work tree renders a ruled `── Work (N) ──` heading with N = top-level node count, and the queue renders `── Queue (N) ──`; both match the `── Needs attention (N) ──` style. Pinned by a pure-function test on the left-pane row builders.
- [ ] At a representative ordinary terminal width (≤200 cols), a pipeline/branch row's timing renders in the labeled `work <d> · idle <d>` (or `work <d>`) form, not the compact `w<d>/i<d>` form; the compact form still renders below the narrow-terminal threshold. Pinned by layout/timing tests at both widths.
- [ ] A not-live (terminal) run row paints no `idle` liveness atom; a live run still paints `live`. Pinned by a run-row builder test for both liveness states.
- [ ] The left-pane width fraction/floor is raised per the Decisions and the tree row-budget math (`leftPaneTreeMaxVisibleRows`) still accounts for the attention, Work, and Queue heading rows without going negative. Pinned by a shell-layout test.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — update the Observe section: the left pane now carries ruled `── Work (N) ──`/`── Queue (N) ──` headings, the left-width clamp values changed, and terminal run rows drop the `idle` liveness atom; remove the "left pane clamped to ~38–40%, retune deferred" follow-up note.
