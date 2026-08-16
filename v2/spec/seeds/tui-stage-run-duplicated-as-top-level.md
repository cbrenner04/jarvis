---
name: tui-stage-run-duplicated-as-top-level
---

# A pipeline stage's workflow-step run also renders as a separate top-level row

## Problem

In `jarvis tui`, a pipeline renders correctly (pipeline → stages → runs), but a workflow-step run that belongs to a stage *also* appears as a separate top-level row **outside** the pipeline's subtree — the same run painted twice. Observed 2026-08-16 dogfooding a `full-review` pipeline: the pipeline collapse looked right, yet a workflow step showed up again as its own top-level line.

The unified-tree join (`v2/src/tui/tui-monitor-pipeline-tree.ts`) decides top-level ad-hoc rows with `isAdHocCandidate(run, matchedInvocationIds)`: a run is ad-hoc unless `run.workflow.invocationId` is in `collectMatchedInvocationIds(snapshots)` — the set of stage `workflowInvocationId`s. A stage records a single `workflowInvocationId` (its entry step), so any run whose `workflow.invocationId` is not exactly that recorded stage id escapes attribution and is emitted as a standalone top-level ad-hoc node, while the stage still shows its own attributed run — hence the duplication. Candidate mechanism to pin in the plan: a stage's **successor-step** runs (review, publication) carry an invocation identity that is not the stage's recorded `workflowInvocationId`, so they match no stage and double as ad-hoc; confirm against real `full-review` run/stage records before fixing.

## Decisions

- A run that belongs to any pipeline stage's workflow invocation must render only within that pipeline's subtree, never also as a top-level ad-hoc row. The fix aligns `isAdHocCandidate` / `collectMatchedInvocationIds` / `attributedRunsForStages` so a stage's every constituent step run (entry and successors) is attributed to the stage and excluded from the ad-hoc set. Rules out the current single-recorded-id attribution that leaks successor runs.
- Genuinely stage-less `run workflow` invocations still render as top-level ad-hoc rows — the fix narrows ad-hoc to runs matching no stage of any pipeline, not to runs the current code happens to miss. Rules out over-suppressing real ad-hoc work.
- Pure pipeline-tree-model change: no daemon/schema change if the run rows already carry enough identity to attribute successor steps; if they do not, the plan surfaces that as the real gap. Rules out a speculative wire change before confirming the model can attribute from existing fields.

## Acceptance criteria

- [ ] A pipeline stage backed by multiple step runs (entry + review + publication) attributes all of them to the stage and emits zero top-level ad-hoc rows for that pipeline, pinned by a pure-function test over `buildMonitorPipelineTreeJoin` seeded with a stage whose successor runs currently leak.
- [ ] A run workflow invocation matching no pipeline stage still renders as a top-level ad-hoc row, pinned by a test (no over-suppression).
- [ ] The duplicated-row regression is pinned: the same run id never appears both under a pipeline subtree and as a top-level node in the flattened tree.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — note (Observe section) that a stage's every step run nests under its stage and never doubles as a top-level ad-hoc row.
