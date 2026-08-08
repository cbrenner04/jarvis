---
name: tui-work-idle-time
---

# TUI work/idle time — elapsed measures stage work, not operator wait

## Problem

Pipeline elapsed is wall clock from `createdAt` with no terminal settle, so a pipeline whose stages ran ~16 minutes and then parked at a gate reads `6d 5h` — one number conflating agent work with operator wait, answering neither "how long do stages take" nor "when did this stop moving". Approval waits are attributed to nothing. A terminal stage that failed before start renders blank elapsed, and a terminal row with no finish timestamp ticks forever on the local display tick.

The whole fix lands on the TUI monitor render surface (elapsed measures plus the tree and detail-pane consumers that read them); there is no second module boundary to split across, and the measures have no consumer outside the rows changed here.

## Decisions

- **work** = Σ stage `startedAt→(endedAt | now)` — pipeline over all its stages, branch node over its own — and is the elapsed rendered on pipeline and branch rows; rules out wall clock from `createdAt` as the headline number.
- **idle** = `now` − the latest activity in the subtree: stage `startedAt`/`endedAt`, approval `decidedAt`, member-run `finishedAtMs`; rules out deriving it from pipeline `finishedAtMs`, which is null exactly when the pipeline is parked.
- Last activity falls back to pipeline `createdAt` when the subtree carries no timestamp; rules out a blank or `NaN` idle on a pending pipeline.
- Idle renders on pipeline rows only when the pipeline is not running (parked or terminal) and in the detail pane always; rules out a second permanent number competing with work on live rows.
- Stage and run rows keep their own `start→end` elapsed; rules out pushing the aggregate down to leaves that each have one duration.
- A terminal stage with null `startedAt` renders `failed before start`; rules out a blank cell or a synthesized start.
- A terminal row with no finish timestamp renders its last-activity age frozen; rules out the current display-tick wall clock that advances a dead row.
- `createdAt` and wall-clock duration stay in the detail pane and leave the tree; rules out carrying both measures in the row.

## Acceptance criteria

- [ ] `tui-elapsed-format.test.ts` test `pipeline work sums stage durations and ignores gate wait` fails against the pre-fix code: pipeline work sums every stage, branch work sums only that branch's stages, a running stage contributes `now − startedAt`, and the parked-pipeline pin reads minutes of work against days of idle.
- [ ] Idle is `now` minus the latest of stage `startedAt`/`endedAt`, approval `decidedAt`, and member-run `finishedAtMs` across the subtree, falling back to `createdAt` when none is set; a pipeline whose last activity is six days old renders `idle 6d` while work stays the stage sum.
- [ ] A pipeline row renders work always and idle only when the pipeline is not running; a branch row renders work; `tui-monitor-pipeline-tree.test.ts` pins a running pipeline with no idle segment and a parked one with both.
- [ ] A terminal stage with null `startedAt` renders `failed before start` on its tree row and in stage detail (`tui-monitor-pipeline-tree.test.ts`, `tui-monitor-lines.test.ts`).
- [ ] A terminal run with null `finishedAtMs` renders identical elapsed text at two `nowMs` values 60 s apart, while a running run's text differs across that same pair (`tui-shell-layout.test.ts`).
- [ ] Pipeline detail renders work and idle alongside `createdAt` and wall-clock duration; no tree row renders wall clock (`tui-monitor-lines.test.ts`).
- [ ] Keystone checkpoint: in `tui-monitor-pipeline-tree.test.ts` test `a parked pipeline row reads stage work and idle since last activity`, a `// @mutate` directive reverting the pipeline row's elapsed cell to `formatElapsedWallClock(node.snapshot.createdAt, node.snapshot.finishedAtMs, nowMs)` turns that regression RED.
- [ ] `bun run typecheck` and `bun run test:v2` pass. Behavior is proven through the pure row builders and production monitor state, not rendered-ink assertions (`v2/docs/test-writing.md` § TUI test strategy).

## Documentation updates

- `v2/docs/operator-runbook.md` § Observe, `jarvis tui` row — work and idle definitions, which rows render each, `failed before start`, and frozen finishless terminal rows; replaces the current wall-clock `elapsed` sentence.
- `v2/docs/v1-behaviors.md` — record that TUI pipeline and branch elapsed is stage work, not wall clock, and that wall clock and `createdAt` are detail-pane only.

## Prerequisites

- Every durable stage write landing a terminal status persists `endedAt`, and a stage that failed before start keeps `startedAt` null on `pipeline_list`.
- `pipeline_list` projects the approval decision timestamp `decidedAt` on the stage shape.
- Daemon `list` reports non-null `finishedAtMs` for every terminal run status.
- The monitor tree renders one branch node per fan-out `branchKey` holding that branch's post-split stages (`v2/src/tui/tui-monitor-pipeline-tree.ts`).
- `formatElapsedWallClock` renders pipeline, stage, and run elapsed from start/end timestamps (`v2/src/tui/tui-elapsed-format.ts`).
- Run rows render elapsed from run `createdAt`/`finishedAtMs` through the tree column cell (`v2/src/tui/tui-shell-layout.ts`).
- The right pane renders pipeline context, stage roll-up, and selected-run detail (`v2/src/tui/tui-monitor-lines.ts`).
- The monitor advances live durations on a local display tick against an injected `nowMs`.
