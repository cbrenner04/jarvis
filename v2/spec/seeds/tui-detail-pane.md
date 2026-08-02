---
name: tui-detail-pane
---

# TUI slice 4 — the right pane is not a detail pane yet

## Problem

Slices 1-3 shipped the split shell, the pipeline tree, and elapsed columns. The right pane is
still a stub: `monitorRightPaneSegmentRows` (`v2/src/tui/tui-monitor-lines.ts:265`) emits four
lines for a pipeline (`pipelineId`, `name`, `project`, `state`), three for a stage (`stageId`,
`branch`, `status`), and for a run only the workflow step list plus whatever `state.waitState`
happens to hold — `outcomeLines` ignores the selected run id, so the outcome block can describe a
different run than the one selected.

The operator still leaves the TUI and greps CLI output for the things the brief
([tui-overhaul-brief.md](../tui-overhaul-brief.md) § Right pane — detail content) says belong
here: stage artifact and `failureDetail`, run worktree/PR/error, and the sticky pipeline identity
block.

Two distinct gaps, and they are not the same size:

**On the wire already, simply not rendered.** Pipeline `createdAt`/`finishedAtMs`; stage
`startedAt`/`endedAt`/`workflowInvocationId`; and on `DaemonListRunRow` (`v2/src/daemon/daemon-wire.ts:21`)
the run's own `project`, `branch`, `status`, `isLive`, `createdAt`, `finishedAtMs`,
`loopOutcomeKind`, `iterationsConsumed`, `resumable`, `error`, `reviewPasses`, `reviewBehavior`,
`worktreePath`, `prNumber`, `prUrl`, `stepId`, `workflow.invocationId`.

**Not on the wire at all.** `projectPipelineSnapshot` (`v2/src/daemon/pipeline-observation.ts:164`)
drops `terminalAction`, admission `context` (seed path), `terminalPublicationSucceededAt`,
`terminalPublicationFailure`; and it drops stage `id`, `position`, `artifact`, `failureDetail`
from `PipelineStageRecord` (`v2/src/daemon/state-store.ts:336`). Same shape as slice 3, which
needed `pipeline_list` timestamps before elapsed could be honest.

## Decisions

- Extend `projectPipelineSnapshot` additively with pipeline `terminalAction`, admission seed path,
  terminal publication outcome, and per-stage `id`, `position`, `artifact`, `failureDetail` —
  rules out rendering a detail pane that silently omits the fields the brief names, and rules out
  a second RPC from the TUI to fetch them.
- The detail pane stays a **pure function** over monitor state: extend
  `monitorRightPaneSegmentRows`, do not move content assembly into ink components — rules out
  content that CI cannot assert ([test-writing.md § TUI test strategy](../../docs/test-writing.md#tui-test-strategy)).
- Sticky pipeline identity block renders for **every** in-pipeline selection (pipeline, stage, or
  run), with selection detail below it; unattributed runs get the run block only — rules out
  losing pipeline context when the selection is three deep.
- Run detail is keyed to the **selected** run row, not `state.waitState`. `outcomeLines`' unused
  `_selectedRunId` becomes real — rules out the current cross-run bleed.
- The pane wraps long values (ids, paths, error text) to `layout.rightWidth` and never truncates
  them; tree-cell truncation stays left-pane only — rules out a detail pane that hides the very
  string the operator opened it to read.
- Out of scope, named: run **spec path** and **agent/model binding** are on no wire at all and
  keep the left pane's `agent`/`id` columns empty (`monitorTreeCellValue`,
  `v2/src/tui/tui-shell-layout.ts`); per-step timestamps on `DaemonWorkflowStepSnapshot`; the
  command dock (slice 5) and steering (slice 6); detail-pane scrolling beyond the pane height.

## Acceptance criteria

- [ ] `pipeline_list` carries pipeline `terminalAction`, seed path from admission context, and
      terminal publication outcome; a test asserts each against a stored pipeline record.
- [ ] `pipeline_list` stage rows carry `id`, `position`, `artifact`, and `failureDetail`.
- [ ] Selecting a stage or a run under a pipeline renders the pipeline identity block above the
      selection detail; selecting an unattributed run renders no pipeline block.
- [ ] Run detail reports the selected run's own `status`, `branch`, `worktreePath`,
      `loopOutcomeKind`, `iterationsConsumed`, `resumable`, `error`, and PR fields — asserted with
      a second, non-selected run in state carrying different values.
- [ ] A value longer than `layout.rightWidth` wraps across rows with no `…` in the output.
- [ ] Every mutation-checkpoint criterion carries a `// @mutate <path> "<old>" -> "<new>"`
      directive in the pinning test file (prose alone is refused).
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/spec/tui-overhaul-brief.md` — mark slice 4 shipped.
- `v2/docs/operator-runbook.md` § Observe — describe what the detail pane shows per selection.

## Prerequisites

- `projectPipelineSnapshot` and the `pipeline_list` wire (`v2/src/daemon/pipeline-observation.ts`)
- `monitorRightPaneSegmentRows` and `outcomeLines` (`v2/src/tui/tui-monitor-lines.ts`)
- `DaemonListRunRow` (`v2/src/daemon/daemon-wire.ts`) and `computeShellLayout` (`v2/src/tui/tui-shell-layout.ts`)
