---
name: tui-elapsed-columns
---

# TUI slice 3 — elapsed columns

Third slice of [tui-overhaul-brief.md](../tui-overhaul-brief.md), after the shell (#2453, #2456)
and the pipeline tree (#2462, #2463, #2466, #2471, #2473, #2479, #2481, #2485). Detail-pane depth
(slice 4), the command dock (slice 5), and steering (slice 6) stay out of scope.

## Problem

The `elapsed` column exists in the grid and reserves its width, but every cell is empty. An
operator watching a pipeline cannot tell a stage that started forty seconds ago from one that has
been running twenty minutes without leaving the TUI for `jarvis run list`.

Stage timing is durable but not observable: `PipelineStageRecord` carries `startedAt` and `endedAt`
(`v2/src/persistence/state-store.ts:344-345`), and `projectPipelineSnapshot` drops both. Pipeline
`createdAt` and `finishedAtMs` already reach the wire (#2463); run rows already carry
`finishedAtMs`.

## Decisions

- `projectPipelineSnapshot` adds `startedAt` and `endedAt` per stage — rules out deriving stage elapsed from run rows, which is wrong for a stage whose runs have not started.
- Elapsed is wall-clock, computed at render from a single injected `nowMs`: pipeline from `createdAt` to `finishedAtMs` or now; stage from `startedAt` to `endedAt` or now; run from its start to `finishedAtMs` or now — rules out per-row clock reads and rules out CPU-time or attempt-sum semantics.
- A row with no start timestamp renders an empty elapsed cell, not `0s` — rules out a zero that reads as "just started".
- Formatting is a pure function sized to the 8-column budget: `<60s` as `Ns`, under an hour as `Nm Ss`, under a day as `Nh Nm`, beyond that `Nd Nh` — rules out a format that overflows the column and gets truncated to `…`.
- Between refresh ticks the elapsed cells advance locally without issuing an RPC; the refresh cadence is unchanged — rules out polling faster to make the clock move.
- Terminal rows freeze at their final elapsed and never tick — rules out a completed stage whose age keeps climbing.
- Tests inject a fixed clock and assert formatted strings; no painted ink assertions (`v2/docs/test-writing.md` § TUI test strategy).

## Acceptance criteria

- [ ] `projectPipelineSnapshot` emits each stage's `startedAt` and `endedAt`, `null` when unset, from the durable record.
- [ ] A running pipeline, stage, and run each render elapsed from their own start to the injected `nowMs`; the three values are independent.
- [ ] A terminal pipeline, stage, and run each render elapsed from start to their recorded end, and do not change when `nowMs` advances.
- [ ] A row whose start timestamp is `null` renders an empty elapsed cell.
- [ ] The formatter covers all four ranges and never exceeds the 8-column budget, boundary-pinned at `59s`/`60s`, `3599s`/`3600s`, and `86399s`/`86400s`.
- [ ] Advancing the local tick updates elapsed cells with no additional `pipeline_list` or `list` RPC — proved by counting RPCs across ticks.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — `jarvis tui` row: what elapsed measures at each level and when it freezes.
- `v2/docs/v1-behaviors.md` — `jarvis tui` entry records elapsed columns.
- `v2/docs/daemon-host.md` — `pipeline_list` stage timestamps on the wire.

## Prerequisites

- `v2/src/daemon/pipeline-observation.ts` — `projectPipelineSnapshot`, `PipelineSnapshot`
- `v2/src/persistence/state-store.ts` — `PipelineStageRecord.startedAt` / `.endedAt`
- `v2/src/tui/tui-shell-layout.ts` — `TREE_COLUMN_WIDTHS.elapsed` (8), `formatTreeCell`
- `v2/src/tui/tui-monitor-pipeline-tree.ts` — display nodes carrying pipeline/stage/run payloads
- `v2/src/tui/tui-entry.tsx` — refresh tick and injected `nowMs`
- `v2/spec/tui-overhaul-brief.md` § Timing
