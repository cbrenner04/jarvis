# Project TUI work and idle time

Authoritative for implement runs: acceptance criteria, documentation updates, and material decisions in this file supersede `intent.md` where they differ.

## Problem

The TUI presents pipeline wall-clock age as elapsed work, leaves failed-before-start stages unexplained, and advances legacy terminal runs that have no finish timestamp.

## Decision ledger

- Pipeline and branch work is the sum of member stage intervals, including overlapping intervals independently; each started stage ends at `endedAt`, at the display clock only while its status is `running`, or at its own start for a non-running legacy row with no end. Rules out wall-clock span and continued accrual by settled malformed rows.
- Pipeline last activity is the maximum present stage `startedAt`, `endedAt`, and `decidedAt` plus attributed member-run `finishedAtMs`; omit idle when none exists. Rules out `createdAt`, run admission time, and refresh time as activity fallbacks.
- Pipeline rows always show work; `pending` and `running` rows omit idle, while every other state shows idle when last activity exists. Rules out presenting active execution as idle or operator wait as work.
- Branch rows show summed branch work and no idle; stage and run rows retain start-to-end elapsed. Rules out replacing leaf timing or inventing an unused branch-idle presentation.
- Only a `failed` stage with null `startedAt` renders `failed before start`; skipped and approval rows with no start retain their existing semantics. Rules out mislabeling deliberately unstarted rows as failures.
- A terminal run row without `finishedAtMs` freezes at its latest durable row/group activity, falling back to the latest member `createdAt` when no member finish exists; an active row still ends at the display clock. Rules out a terminal fallback to the display clock.
- Pipeline detail labels created-to-finish duration `wallClock`, retains raw `createdAt` and `finishedAtMs`, and adds work and idle; wall clock uses the display clock until pipeline finish, while work uses it only for running stages. Rules out deleting forensic timestamps or leaving wall clock under the ambiguous `elapsed` label.
- The existing local display tick rerenders timing projections; it issues no `list` or `pipeline_list` request. Rules out new polling for animation.

## Prerequisites

- `PipelineSnapshot` projects stage `startedAt`, `endedAt`, and `decidedAt`; failed-before-start rows carry `status: "failed"`, numeric `endedAt`, null `startedAt`, and no workflow linkage.
- Current terminal daemon list rows project durable `finishedAtMs`; legacy terminal rows may omit it.
- The monitor tree retains every branch's complete post-split stage subtree, descendant selection resolves pipeline context, and the local display tick rerenders without daemon requests.

## Tasks

- Extend `v2/src/tui/tui-elapsed-format.ts` with compact duration formatting for aggregate work/idle while preserving existing leaf elapsed behavior and width tiers.
- In `v2/src/tui/tui-monitor-pipeline-tree.ts`, derive display-clock-sensitive work and durable last activity from pipeline/branch stage records and attributed run members; preserve complete branch records needed for aggregation even when a gate row is elided. Keep the unique work guards as `if (stage.startedAt === null) return 0;` and `const endMs = stage.endedAt ?? (stage.status === "running" ? nowMs : stage.startedAt);`, and the activity guard as `return activity.length === 0 ? null : Math.max(...activity);`.
- Replace pipeline tree age with work/idle and add branch work. Keep `if (RUNNING_PIPELINE_STATES.has(state)) return work;` and `if (timing.lastActivityMs === null) return work;` as unique formatting guards, and keep the pipeline row assignment `elapsed: formatPipelineTreeTiming(node, nowMs),` as the keystone anchor.
- In `v2/src/tui/tui-monitor-pipeline-tree.ts` and `v2/src/tui/tui-monitor-lines.ts`, use one stage elapsed projection for tree, roll-up, and selected-stage detail. Keep `if (stage.status === "failed" && stage.startedAt === null) return "failed before start";` as the unique failed-before-start guard.
- In `v2/src/tui/tui-shell-layout.ts`, derive run-row elapsed from all members of the painted workflow row. Active groups use the display clock; terminal groups use their latest durable finish or latest admission fallback. Keep `if (workflowGroupHasActiveMember(members)) return null;` as the unique active-group guard.
- Update pipeline detail in `v2/src/tui/tui-monitor-lines.ts` to render `work`, `idle`, `createdAt`, `wallClock`, and retained durable finish fields from the same projection used by the tree; wall clock advances for non-terminal pipelines and freezes at `finishedAtMs`.
- Update `v2/src/tui/tui-monitor-pipeline-tree.test.ts`, `v2/src/tui/tui-monitor-lines.test.ts`, and `v2/src/tui/tui-entry.test.tsx` with the regressions and in-test `// @mutate` directives named below; update `v2/src/tui/tui-elapsed-format.test.ts` only for aggregate-duration boundary coverage.
- Apply the Documentation updates.
- Run `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2`.

## Acceptance criteria

- [ ] `v2/src/tui/tui-monitor-pipeline-tree.test.ts` — `pipeline and branch rows report summed work while a parked pipeline reports idle` builds separated and overlapping completed intervals plus one running interval, asserts branch work is its stage sum and pipeline work is every stage's sum at the injected display clock, asserts a parked pipeline has small work plus six days idle, and fails against the pre-fix pipeline-age row.
- [ ] `v2/src/tui/tui-monitor-pipeline-tree.test.ts` — `pipeline and branch rows report summed work while a parked pipeline reports idle`; Keystone checkpoint: its test body carries `// @mutate v2/src/tui/tui-monitor-pipeline-tree.ts "elapsed: formatPipelineTreeTiming(node, nowMs)," -> "elapsed: formatElapsedWallClock(node.snapshot.createdAt, node.snapshot.finishedAtMs, nowMs),"`, restoring pipeline wall-clock age as the headline, and the mutation turns the regression RED.
- [ ] `v2/src/tui/tui-monitor-pipeline-tree.test.ts` — `work timing sums stages and excludes non-started or non-running open intervals` asserts a null-start stage contributes zero, a running open stage advances, and a non-running open legacy stage remains stable; its test body carries `// @mutate v2/src/tui/tui-monitor-pipeline-tree.ts "if (stage.startedAt === null) return 0;" -> "if (false) return 0;"` and `// @mutate v2/src/tui/tui-monitor-pipeline-tree.ts "const endMs = stage.endedAt ?? (stage.status === \"running\" ? nowMs : stage.startedAt);" -> "const endMs = stage.endedAt ?? (true ? nowMs : stage.startedAt);"`, and each mutation turns the regression RED.
- [ ] `v2/src/tui/tui-monitor-pipeline-tree.test.ts` — `last activity selects durable stage and member-run timestamps and omits idle when absent` makes stage start, end, decision, and attributed run finish independently latest, asserts each wins, asserts a six-day-old maximum paints `idle 6d`, and asserts a pipeline with no activity does not derive idle from `createdAt`; its test body carries `// @mutate v2/src/tui/tui-monitor-pipeline-tree.ts "return activity.length === 0 ? null : Math.max(...activity);" -> "return activity.length < 0 ? null : Math.max(...activity);"` and `// @mutate v2/src/tui/tui-monitor-pipeline-tree.ts "if (timing.lastActivityMs === null) return work;" -> "if (false) return work;"`, and each mutation turns the regression RED.
- [ ] `v2/src/tui/tui-monitor-pipeline-tree.test.ts` — `pipeline rows hide idle only while running` asserts `pending` and `running` rows show work without idle while awaiting-approval and terminal rows show work plus idle; its test body carries `// @mutate v2/src/tui/tui-monitor-pipeline-tree.ts "if (RUNNING_PIPELINE_STATES.has(state)) return work;" -> "if (false) return work;"`, and the mutation turns the regression RED.
- [ ] `v2/src/tui/tui-monitor-lines.test.ts` — `pipeline detail separates work idle and wall clock` asserts work is the stage sum, idle uses durable last activity, raw `createdAt` remains, wall clock advances from creation to the display clock while non-terminal, and terminal wall clock and work freeze at durable ends; it fails against the pre-fix detail's single pipeline-age `elapsed` field.
- [ ] `v2/src/tui/tui-monitor-lines.test.ts` — `a failed stage with no start paints failed before start in tree and detail` asserts the tree stage row, pipeline Stages roll-up, and selected Stage section render `failed before start`, while a skipped null-start row does not; it fails against the pre-fix blank elapsed and its test body carries `// @mutate v2/src/tui/tui-monitor-pipeline-tree.ts "if (stage.status === \"failed\" && stage.startedAt === null) return \"failed before start\";" -> "if (false) return \"failed before start\";"`, which turns the regression RED.
- [ ] `v2/src/tui/tui-monitor-pipeline-tree.test.ts` — `running runs tick while finishless terminal runs freeze at durable activity` renders active and terminal workflow rows at display clocks 60 seconds apart, asserts only the active row changes and the terminal row uses its latest durable member finish or admission fallback; it fails against the pre-fix finishless terminal row and its test body carries `// @mutate v2/src/tui/tui-shell-layout.ts "if (workflowGroupHasActiveMember(members)) return null;" -> "if (false) return null;"`, which turns the active-row regression RED.
- [ ] `v2/src/tui/tui-entry.test.tsx` — `display tick advances running work but not parked work without additional list or pipeline_list RPC` advances the injected display clock and display scheduler, asserts running stage/run and pipeline work change, parked work remains fixed while idle changes, and `list`/`pipeline_list` call counts do not change; it fails against the pre-fix pipeline-age projection.
- [ ] `v2/docs/operator-runbook.md` § Observe defines work as summed stage intervals, idle as age since durable subtree activity, and wall clock as created-to-current-or-finish duration; it states pipeline/branch/tree/detail placement, failed-before-start wording, terminal finishless-run fallback, and which values advance on the local display tick or freeze.
- [ ] `v2/docs/v1-behaviors.md` § TUI / observability replaces pipeline-age semantics with work/idle projection and records aggregate sources, failed-before-start rendering, finishless-terminal freezing, forensic wall clock, and no-RPC local ticking.
- [ ] `v2/spec/tui-command-center-brief.md` marks seed 6 shipped by this spec directory.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Observe — work, idle, wall clock, their render locations, failed-before-start and finishless-terminal behavior, and display-clock advance/freeze rules.
- `v2/docs/v1-behaviors.md` § TUI / observability — replace pipeline age with work/idle, retain leaf elapsed, and record failed-before-start, finishless-terminal, wall-clock detail, and local-tick semantics.
- `v2/spec/tui-command-center-brief.md` — mark seed 6 shipped by this spec directory.
