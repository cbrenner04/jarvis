---
name: tui-left-pane-section-framing
---

# TUI left-pane section framing: ruled Work/Queue headings and no idle atom on terminal runs

Surface: the left-pane row builders in `v2/src/tui/tui-monitor-lines.ts` (`monitorLeftPaneTreeRows`, `monitorLeftPaneQueueRows`, `leftPaneTreeMaxVisibleRows`, and the run-row composer). Pane geometry (width clamp, labeled-timing threshold) is a separate surface and is not touched here.

## Problem

The three stacked left-pane sections run together: only the attention segment has a ruled `── Needs attention (N) ──` heading, the work tree has no heading, and the queue is a bare `Queue` line. A not-live run row also paints the `idle` liveness atom (`MONITOR_TREE_NOT_LIVE_LABEL`) beside its terminal status, so a completed run reads `completed … idle`.

## Decisions

- Add a ruled `── Work (N) ──` heading before the work tree, N = count of top-level tree nodes. Rules out leaving the tree headingless.
- Change the queue heading to the ruled `── Queue (N) ──` form, matching the attention heading style. Rules out keeping the undecorated `Queue` line.
- No blank-line padding between sections — the ruled headings are the separation. Rules out spending extra tree rows on spacers.
- Count the new Work heading row in `leftPaneTreeMaxVisibleRows` alongside the existing attention and queue reservations, keeping the budget floored at zero. Rules out a heading that silently overflows the pane or a negative budget.
- A not-live run row paints no liveness atom; a live run still paints `live`. Rules out the `completed … idle` contradiction and rules out inventing a new terminal-liveness word.
- Queued rows, the attention segment, the tree model, selection, expansion, right pane, and dock are unchanged. Rules out divider or command-grammar rework.

## Acceptance criteria

- [ ] The work tree renders a ruled `── Work (N) ──` heading with N = top-level node count, and the queue renders `── Queue (N) ──`, both matching the `── Needs attention (N) ──` style; an empty tree or empty queue still paints no heading. Pinned by pure-function tests on the left-pane row builders.
- [ ] A not-live (terminal) run row paints no liveness atom while a live run still paints `live`. Pinned by a run-row builder test covering both liveness states.
- [ ] `leftPaneTreeMaxVisibleRows` subtracts the attention, Work, and Queue heading rows and never returns a negative value. Pinned by a row-budget test at a pane height smaller than the reserved heading rows.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — Observe section: the left pane carries ruled `── Work (N) ──` and `── Queue (N) ──` headings, the tree row budget reserves them, and terminal run rows paint no `idle` liveness atom.

## Prerequisites
