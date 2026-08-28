---
name: tui-branch-aware-stage-run-attribution
---

# Branch-aware stage attribution stops a stage's run from doubling as a top-level ad-hoc row

Unsplit rationale: the whole fix lives in the TUI unified-tree projection (`v2/src/tui/tui-monitor-pipeline-tree.ts` — stage/ad-hoc attribution in `buildMonitorPipelineTreeJoin`), which is one module-boundary surface; the run rows already carry `branch`, so no daemon, persistence, or CLI change is implied.

## Problem

A pipeline stage records exactly one `workflowInvocationId`. `isAdHocCandidate` calls a run ad-hoc unless its `workflow.invocationId` is in `collectMatchedInvocationIds(snapshots)`, so a run sharing a stage's work under a *different* invocation id escapes attribution and paints as its own top-level ad-hoc row while the stage still shows its attributed run — the same work painted twice. Confirmed 2026-08-16 on a `full-review` pipeline: the `plan` stage recorded `1c65481a-…` (the real run, with failure logs) while a top-level ad-hoc row on the *same branch* `plan/pipeline-list-human-readable` carried `f900c104-…` (no useful logs). The leak is a distinct invocation on the stage's branch, not merely a successor step, so invocation-id-only attribution cannot catch it.

## Decisions

- Attribution becomes branch-aware: a run whose branch matches a pipeline stage's branch is attributed to that pipeline, not only a run whose `workflow.invocationId` equals the stage's single recorded id — rules out the current invocation-id-only rule that leaks any non-recorded invocation sharing the stage's branch.
- A stage's branch is derived from the run rows already joined to its recorded invocation id (`DaemonListRunRow.branch`); no new daemon or snapshot field — rules out a speculative wire/schema change before confirming the model can attribute from existing fields. If the model turns out not to be able to derive a stage branch, the plan surfaces that as the real gap instead of inventing a field.
- A run matching no stage of any pipeline still renders as a top-level ad-hoc row — rules out over-suppressing genuinely stage-less `run workflow` invocations.
- Branch matching is scoped to the pipelines and runs present in the single `buildMonitorPipelineTreeJoin` call — no cross-call history or time window — so a finished pipeline absent from the current snapshot pass can never claim a run by branch. When more than one currently-listed stage shares a branch, the run attributes to the most-recently-started matching stage (by run start time) — rules out ambiguous double-attribution when branch names are reused across concurrent or resumed pipelines.
- The duplicate-invocation-on-the-same-branch root cause (why `f900c104` exists at all) stays out of scope and is noted by the plan as a possible separate daemon-side gap; the TUI change stops the doubling regardless — rules out bundling an unscoped daemon investigation into this behavior.

## Acceptance criteria

- [x] A run sharing a pipeline stage's branch but carrying a different `workflow.invocationId` than the stage's recorded one is attributed to that pipeline and emits zero top-level ad-hoc rows, pinned by a pure-function test over `buildMonitorPipelineTreeJoin` reproducing the recorded-vs-same-branch-leak case; the test fails against the pre-fix code.
- [x] A pipeline stage backed by multiple step runs (entry, review, publication) attributes all of them to the stage, pinned by a test.
- [x] A `run workflow` invocation matching no pipeline stage still renders as a top-level ad-hoc row, pinned by a test (no over-suppression).
- [x] When two currently-listed stages across concurrent or resumed pipelines share a branch, a run on that branch attributes to the most-recently-started matching stage only, never to both and never to a pipeline absent from the current snapshot pass, pinned by a test.
- [x] The same run id never appears both under a pipeline subtree and as a top-level node in the flattened tree, pinned by a regression test over the flattened output.
- [x] `bun run typecheck` and `bun run test:v2` pass.

## Prerequisites

- Daemon `list` run rows carry a `branch` value and optional `workflow.invocationId` on every non-queued row.
- Pipeline `pipeline_list` snapshots expose per-stage `workflowInvocationId`, `branchKey`, and status.
- The TUI unified work tree already joins pipelines, stages, runs, and ad-hoc rows through `buildMonitorPipelineTreeJoin`.

## Primary implementation surface

- TUI unified pipeline-tree projection (`v2/src/tui/tui-monitor-pipeline-tree.ts`)

## Documentation updates

- `v2/docs/operator-runbook.md` — Observe section: every run belonging to a stage's branch nests under that stage and never doubles as a top-level ad-hoc row; ad-hoc rows are only invocations matching no stage of any pipeline.
- `v2/docs/v1-behaviors.md` — update the existing TUI pipeline-tree entry (currently: ad-hoc rows are runs matching no stage by `workflowInvocationId`) to record the branch-aware attribution rule and the same-branch tie-break.
