# Aggregate TUI work and idle projection

Authoritative for implement runs: acceptance criteria, documentation updates, and material decisions in this file supersede `intent.md` where they differ.

## Problem

The tree reports pipeline wall-clock age as work, obscuring small completed work followed by a long operator wait.

## Decision ledger

- Pipeline and branch work is the nonnegative sum of its member stage intervals; overlapping intervals count independently. A started `running` stage ends at the display clock, an ended stage ends at `endedAt`, and a non-running open or null-start stage contributes zero. Reversed, corrupt, and future intervals clamp to zero.
- Subtree activity is the maximum present snapshot stage `startedAt`, `endedAt`, and `decidedAt`, plus `finishedAtMs` on currently retained attributed run members. Snapshot-stage timestamps are complete; run finishes are best-effort under daemon row capping or eviction, so absent members contribute nothing and no admission/creation/refresh fallback is inferred for idle.
- `running` is the only active-execution pipeline state: it shows work and no idle. Every non-running state, including `pending`, awaiting approval, interrupted, failed, cancelled, and succeeded, shows work plus idle when durable activity exists. Tree and detail use this same mapping.
- Aggregate duration is always visible, including zero, as nonnegative whole-unit text: `0s`, seconds below one minute, minutes below one hour, hours below one day, then days. The normal timing cell says `work <duration> · idle <duration>`; with no activity it says `work <duration>`.
- The tree timing column is 20 characters at widths of 100 columns or more and eight characters below 100. Normal width uses the full labels and ` · ` separator. Compact width uses `w<duration>/i<duration>` or `w<duration>`; it never silently drops work. Leaf timing remains the existing leaf formatter.
- Pipeline detail retains raw `createdAt` and `finishedAtMs`, labels created-to-display-or-finish duration `wallClock`, and adds `work` and applicable `idle`. Wall clock advances until a pipeline finish and then freezes; work advances only for running stages.
- The existing local display tick recalculates these projections without `list` or `pipeline_list` requests. Completed and parked work stays fixed while idle advances for a non-running pipeline.

## Prerequisites

- `PipelineSnapshot` projects complete stage `startedAt`, `endedAt`, and `decidedAt` records, and the monitor tree retains every post-split branch stage record even if its gate row is elided.
- Current daemon list rows expose `finishedAtMs`; retention may cap or evict historical terminal rows.

## Tasks

- Add aggregate-duration and work/idle timing projection shared by the pipeline tree and detail; preserve leaf elapsed formatting.
- Derive pipeline and branch work from complete stage records, retain records required by hidden gate rows, and derive best-effort activity from stage timestamps plus retained attributed run finishes.
- Replace pipeline tree age with width-aware work/idle timing and add width-aware branch work; widen the normal timing column without regressing compact tree placement.
- Render pipeline detail with work, conditional idle, raw timestamps, and `wallClock`; use the same timing projection as the tree.
- Cover tree, detail, formatter, and display-tick behavior in `v2/src/tui/tui-elapsed-format.test.ts`, `v2/src/tui/tui-monitor-pipeline-tree.test.ts`, `v2/src/tui/tui-monitor-lines.test.ts`, and `v2/src/tui/tui-entry.test.tsx`.
- Update the aggregate timing portions of `v2/docs/operator-runbook.md` § Observe and `v2/docs/v1-behaviors.md` § TUI / observability, and mark seed 6 shipped in `v2/spec/tui-command-center-brief.md`.
- Run `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2`.

## Acceptance criteria

- [x] `v2/src/tui/tui-monitor-pipeline-tree.test.ts` — `pipeline and branch rows report summed work while a parked pipeline reports idle` fails against the baseline and proves separated, overlapping, and running stage intervals sum independently for each branch and for the pipeline; a parked pipeline reports small work and six days idle rather than pipeline age.
- [x] `v2/src/tui/tui-monitor-pipeline-tree.test.ts` — `pipeline and branch rows report summed work while a parked pipeline reports idle`; Keystone checkpoint: its test body carries `// @mutate v2/src/tui/tui-monitor-pipeline-tree.ts "elapsed: formatPipelineTreeTiming(node, nowMs)," -> "elapsed: formatElapsedWallClock(node.snapshot.createdAt, node.snapshot.finishedAtMs, nowMs),"`, and the mutation turns the regression RED.
- [x] `v2/src/tui/tui-monitor-pipeline-tree.test.ts` — `work timing clamps invalid intervals and advances only running stages` fails against the baseline and proves null-start, reversed, future, and non-running open stages add zero while a running stage advances; its test body carries `// @mutate v2/src/tui/tui-monitor-pipeline-tree.ts "if (stage.startedAt === null) return 0;" -> "if (false) return 0;"`, `// @mutate v2/src/tui/tui-monitor-pipeline-tree.ts "const endMs = stage.endedAt ?? (stage.status === \"running\" ? nowMs : stage.startedAt);" -> "const endMs = stage.endedAt ?? (true ? nowMs : stage.startedAt);"`, and `// @mutate v2/src/tui/tui-monitor-pipeline-tree.ts "return Math.max(0, endMs - stage.startedAt);" -> "return endMs - stage.startedAt;"`; each mutation turns the regression RED.
- [x] `v2/src/tui/tui-elapsed-format.test.ts` — `aggregate duration formatting is labeled nonnegative and width-aware` fails against the baseline and pins `0s`, second/minute/hour/day boundaries, clamped negative values, the normal `work <duration> · idle <duration>` form, and compact `w<duration>/i<duration>` form; its test body carries `// @mutate v2/src/tui/tui-elapsed-format.ts "if (durationMs <= 0) return \"0s\";" -> "if (durationMs <= 0) return \"\";"`, and the mutation turns the regression RED.
- [x] `v2/src/tui/tui-monitor-pipeline-tree.test.ts` — `last activity selects durable timestamps and is best effort for evicted runs` fails against the baseline and makes stage start, end, decision, and retained attributed run finish independently latest; it renders `idle 6d`, clamps future activity to `idle 0s`, omits idle with no activity, and shows that an evicted run finish is neither guessed nor replaced by creation/admission time. Its test body carries `// @mutate v2/src/tui/tui-monitor-pipeline-tree.ts "return activity.length === 0 ? null : Math.max(...activity);" -> "return activity.length < 0 ? null : Math.max(...activity);"`, `// @mutate v2/src/tui/tui-monitor-pipeline-tree.ts "if (member.finishedAtMs !== undefined) activity.push(member.finishedAtMs);" -> "if (false) activity.push(member.finishedAtMs);"`, and `// @mutate v2/src/tui/tui-monitor-pipeline-tree.ts "const idleMs = Math.max(0, nowMs - timing.lastActivityMs);" -> "const idleMs = nowMs - timing.lastActivityMs;"`; each mutation turns the regression RED.
- [x] `v2/src/tui/tui-monitor-pipeline-tree.test.ts` — `pipeline rows hide idle only while running` fails against the baseline and proves running shows work without idle while pending, awaiting approval, and terminal states show work plus idle. Its test body carries `// @mutate v2/src/tui/tui-monitor-pipeline-tree.ts "if (state === \"running\") return work;" -> "if (false) return work;"`, and the mutation turns the regression RED.
- [x] `v2/src/tui/tui-monitor-pipeline-tree.test.ts` — `pipeline timing has full and compact tree representations` fails against the baseline and proves a 100-column tree has a 20-character timing cell with full work/idle labels, while a 99-column tree has an eight-character compact cell that still represents work; it also protects state and label placement. Its test body carries `// @mutate v2/src/tui/tui-monitor-pipeline-tree.ts "const compact = width < 100;" -> "const compact = false;"`, and the mutation turns the compact-width assertion RED.
- [x] `v2/src/tui/tui-monitor-lines.test.ts` — `pipeline detail separates work idle and wall clock` fails against the baseline and proves work is the stage sum, idle is omitted without durable activity, raw `createdAt` remains, and `wallClock` advances from creation while non-terminal then freezes at `finishedAtMs`; work freezes when no stage runs.
- [x] `v2/src/tui/tui-monitor-lines.test.ts` — `ordinary stage elapsed agrees across tree roll-up and detail` fails against the baseline and proves the same running and completed stage elapsed appears in the tree row, pipeline Stages roll-up, and selected Stage detail.
- [x] `v2/src/tui/tui-entry.test.tsx` — `display tick advances running work but not parked work without additional list or pipeline_list RPC` fails against the baseline and advances the injected display clock and scheduler: running stage, run, and pipeline work change, parked work remains fixed while idle changes, and `list` and `pipeline_list` counts do not change.
- [x] `v2/docs/operator-runbook.md` § Observe and `v2/docs/v1-behaviors.md` § TUI / observability define aggregate work, best-effort idle under evicted run rows, forensic wall clock, the tree/detail width and state rules, and local tick advance/freeze behavior; `v2/spec/tui-command-center-brief.md` marks seed 6 shipped by this spec directory.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Observe — aggregate work/idle sources, state and width rules, wall clock, and local-tick behavior.
- `v2/docs/v1-behaviors.md` § TUI / observability — replace pipeline age with the aggregate work/idle projection and record best-effort eviction semantics.
- `v2/spec/tui-command-center-brief.md` — mark seed 6 shipped by this spec directory.
