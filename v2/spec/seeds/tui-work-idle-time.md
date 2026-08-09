---
name: tui-work-idle-time
---

# TUI work/idle time — elapsed measures stages, not operator wait

TUI command-center phase ([tui-command-center-brief.md](../tui-command-center-brief.md)), on `pipeline-terminal-timestamps` (honest timestamps) and `tui-intent-branch-subtree` (branch nodes).

## Problem

Pipeline elapsed is wall clock from `createdAt` with no terminal settle, so a pipeline whose stages ran ~16 minutes and then parked at a gate reads `6d 5h` — the number conflates agent work with operator wait and answers neither "how long do stages take" (the operator's stated purpose for elapsed) nor "when did this stop moving". Approval waits are attributed to nothing. Finishless terminal rows tick forever (display side; the data fix is `pipeline-terminal-timestamps`).

## Decisions

- **work** = Σ stage `startedAt→(endedAt | now)` — branch node over its stages, pipeline over all its stages. This is the elapsed shown on pipeline and branch rows. Rules out wall clock as the headline number.
- **idle** = now − last activity in the subtree (max of stage `startedAt`/`endedAt`, approval `decidedAt`, member-run `finishedAtMs`); shown on pipeline rows when the pipeline is not running (parked or terminal) and in the detail pane always. A parked pipeline reads `work 16m · idle 6d`.
- Stage and run rows keep their own start→end elapsed; a failed-before-start stage (terminal, `startedAt` null) renders `failed before start`, not a blank.
- A terminal row with no finish timestamp renders its last known activity age, frozen — never a ticking wall clock.
- `createdAt` and wall-clock duration remain available in the detail pane; they leave the tree.
- Local 1s tick still advances only genuinely running durations.

## Acceptance criteria

- [ ] Pure aggregators: branch work sums its stages, pipeline work sums all stages; running stages contribute `now − startedAt`; pins include the parked-pipeline case (small work, large idle).
- [ ] Idle pins: last activity is the max across stage timestamps, `decidedAt`, and member-run finishes; a pipeline with a 6-day-old last activity renders `idle 6d` while work stays the stage sum.
- [ ] A terminal stage with null `startedAt` renders `failed before start` in tree and detail.
- [ ] A terminal run with null `finishedAtMs` renders frozen (two renders 60s apart produce the same elapsed text).
- [ ] Running rows still tick between refreshes; parked pipelines do not.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Observe — work vs idle definitions and where each renders.

## Prerequisites

- `v2/src/tui/tui-elapsed-format.ts` — `formatElapsedWallClock`
- `v2/src/tui/tui-monitor-pipeline-tree.ts` — pipeline/branch/stage node timestamps
- Seed `pipeline-terminal-timestamps` — `decidedAt`, terminal `finishedAtMs`/`endedAt` guarantees
