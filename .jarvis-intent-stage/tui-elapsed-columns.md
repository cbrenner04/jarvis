---
name: tui-elapsed-columns
---

# TUI elapsed columns

Fill the reserved `elapsed` column at pipeline, stage, and run rows with wall-clock duration from
injected `nowMs`. Terminal rows freeze; active rows tick locally between refresh polls.

## Problem

The `elapsed` column reserves width but every cell is empty. Operators cannot compare stage age
without `jarvis run list`.

## Decisions

- Elapsed is wall-clock from a single injected `nowMs`: pipeline from `createdAt` to `finishedAtMs` or now; stage from `startedAt` to `endedAt` or now; run from its start to `finishedAtMs` or now — rules out per-row clock reads and CPU-time or attempt-sum semantics.
- A row with no start timestamp renders an empty elapsed cell, not `0s` — rules out a zero that reads as "just started".
- Formatting is a pure function sized to the 8-column budget: `<60s` as `Ns`, under an hour as `Nm Ss`, under a day as `Nh Nm`, beyond that `Nd Nh` — rules out overflow truncated to `…`.
- Between refresh ticks elapsed cells advance locally without extra `pipeline_list` or `list` RPC — rules out polling faster to move the clock.
- Terminal rows freeze at final elapsed and never tick — rules out completed stages whose age keeps climbing.
- Deferred to first consumer: run elapsed start timestamp on `list` wire (`createdAt` vs active attempt `startedAt`) — pin when run cells render.
- Tests inject a fixed clock and assert formatted strings; no painted ink assertions (`v2/docs/test-writing.md` § TUI test strategy).

## Acceptance criteria

- [ ] A running pipeline, stage, and run each render elapsed from their own start to the injected `nowMs`; the three values are independent.
- [ ] A terminal pipeline, stage, and run each render elapsed from start to their recorded end, and do not change when `nowMs` advances.
- [ ] A row whose start timestamp is `null` renders an empty elapsed cell.
- [ ] The formatter covers all four ranges and never exceeds the 8-column budget, boundary-pinned at `59s`/`60s`, `3599s`/`3600s`, and `86399s`/`86400s`.
- [ ] Advancing the local tick updates elapsed cells with no additional `pipeline_list` or `list` RPC — proved by counting RPCs across ticks.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — `jarvis tui` row: what elapsed measures at each level and when it freezes.
- `v2/docs/v1-behaviors.md` — `jarvis tui` entry records elapsed columns.

## Prerequisites

- `projectPipelineSnapshot` emits each stage's `startedAt` and `endedAt`, `null` when unset, on the `pipeline_list` wire.
- `TREE_COLUMN_WIDTHS.elapsed` is 8 and the elapsed column is in `visibleColumns` degradation tiers.
- `formatTreeCell` truncates overflow with `…` at column width.
- A pure pipeline tree builder maps snapshots and run rows to ordered pipeline, stage, and run display nodes with depth and node ids.
- The ink monitor renders nested pipeline, stage, and run rows in the left pane; `e` toggles pipeline and stage expansion.
- The TUI refresh tick injects `nowMs` and polls `pipeline_list` once per tick per connected daemon on the same cadence as `list`.
- `list` run rows carry `finishedAtMs` for terminal runs.
- `v2/spec/tui-overhaul-brief.md` § Timing documents wall-clock elapsed at pipeline, stage, and run levels.
