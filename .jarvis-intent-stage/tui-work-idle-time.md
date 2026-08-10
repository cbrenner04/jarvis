---
name: tui-work-idle-time
---

# TUI work and idle time

TUI command-center phase ([tui-command-center-brief.md](../tui-command-center-brief.md)), after honest terminal timestamps and the intent-branch subtree.

Split does not apply: the elapsed formatter, work-tree rows, detail rows, and local display tick form one TUI monitor-projection surface.

## Problem

Pipeline elapsed uses `createdAt`, so stage work and operator wait collapse into one growing wall-clock age. Parked work looks active, failed-before-start stages show no elapsed explanation, and legacy terminal runs without a finish timestamp tick forever.

## Decision ledger

- Define pipeline work as the sum of every stage's `startedAt` to `endedAt`, using the display clock only for a started stage that is still running. Rules out pipeline wall clock as the headline elapsed.
- Define branch work as the same sum over that branch's stages. Rules out deriving branch elapsed from its first and last stage boundary.
- Define subtree last activity as the maximum present stage `startedAt`, `endedAt`, and `decidedAt` plus member-run `finishedAtMs`. Rules out using `createdAt` or refresh time as activity.
- Show `idle <age>` on parked and terminal pipeline rows, while running pipeline rows show work without idle. Rules out labeling operator wait as work.
- Show pipeline and branch work in the tree; keep stage and run rows on their own start-to-end elapsed. Rules out replacing leaf timing with subtree aggregates.
- Render a terminal stage with no `startedAt` as `failed before start` in the tree and detail. Rules out the current blank elapsed.
- End a terminal row lacking its terminal timestamp at its latest durable activity rather than the display clock. Rules out finishless terminal rows ticking forever.
- Keep `createdAt` and created-to-finish wall-clock duration in pipeline detail, and add work plus idle there. Rules out deleting forensic wall-clock timing.
- Advance running stage and run durations from the existing local display clock without extra daemon requests; completed work remains stable between refreshes. Rules out polling to animate elapsed.

## Acceptance criteria

- [ ] Pure aggregation pins show branch work as the sum of its stages and pipeline work as the sum of all stages, with running stages contributing display-clock time; a parked pipeline has small work and large idle.
- [ ] Last activity uses the maximum present stage start/end/decision and member-run finish; a pipeline whose last activity was six days ago renders `idle 6d` while work remains the stage sum.
- [ ] Pipeline rows render work, non-running pipeline rows also render idle, branch rows render branch work, and pipeline age leaves the tree.
- [ ] Pipeline detail renders work, idle, `createdAt`, and wall-clock duration.
- [ ] A terminal stage with null `startedAt` renders `failed before start` in both tree and detail.
- [ ] A terminal run with no `finishedAtMs` produces identical elapsed text across renders 60 seconds apart.
- [ ] Running stage and run elapsed changes across local display ticks without additional `list` or `pipeline_list` requests; parked work does not change.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Observe — define work, idle, and wall clock; state where each renders and when elapsed freezes or advances.
- `v2/docs/v1-behaviors.md` § TUI / observability — replace pipeline-age semantics with work/idle projection and record failed-before-start and finishless-terminal behavior.

## Prerequisites

- Pipeline snapshots project approval `decidedAt` and terminal stage `endedAt`, including failed-before-start stages whose `startedAt` remains null.
- Current terminal daemon list rows project durable `finishedAtMs`; legacy terminal rows may omit it.
- The TUI work tree groups post-split stages under branch nodes and exposes each branch's complete stage subtree.
- The TUI detail pane renders pipeline context for pipeline descendants and selection-specific stage or run detail.
- A local display tick rerenders elapsed without issuing `list` or `pipeline_list` requests.
