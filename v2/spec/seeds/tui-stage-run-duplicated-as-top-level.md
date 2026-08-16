---
name: tui-stage-run-duplicated-as-top-level
---

# A pipeline stage's workflow-step run also renders as a separate top-level row

## Problem

In `jarvis tui`, a pipeline renders correctly (pipeline → stages → runs), but a workflow-step run that belongs to a stage *also* appears as a separate top-level row **outside** the pipeline's subtree — the same run painted twice. Observed 2026-08-16 dogfooding a `full-review` pipeline: the pipeline collapse looked right, yet a workflow step showed up again as its own top-level line.

The unified-tree join (`v2/src/tui/tui-monitor-pipeline-tree.ts`) decides top-level ad-hoc rows with `isAdHocCandidate(run, matchedInvocationIds)`: a run is ad-hoc unless `run.workflow.invocationId` is in `collectMatchedInvocationIds(snapshots)` — the set of stage `workflowInvocationId`s. A stage records a **single** `workflowInvocationId`, so any run sharing the stage's work but carrying a *different* invocation id escapes attribution and is emitted as a standalone top-level ad-hoc node (labeled with the run's branch), while the stage still shows its own attributed run — hence the duplication.

**Confirmed 2026-08-16 with concrete data.** A `full-review` pipeline on branch `plan/pipeline-list-human-readable`: the nested `plan` stage records `workflowInvocationId 1c65481a-...` (the real run — it has the failure logs), while a separate top-level ad-hoc row `plan/pipeline-list-human-readable` carries a *different* `workflowInvocationId f900c104-...` (no useful logs — "bs"). So the leaked row is **not** merely a successor step of the same invocation; it is a distinct invocation on the **same branch** as the stage. Invocation-id-only attribution cannot catch it — a stage's branch, not just its one recorded invocation id, must anchor attribution. (Open, possibly separate, question for the plan to note: *why* a second stub invocation `f900c104` exists on that branch at all — it may be an orphan/retry artifact that also warrants a daemon-side fix; the TUI change here stops it from doubling regardless.)

## Decisions

- A run that belongs to any pipeline stage's work must render only within that pipeline's subtree, never also as a top-level ad-hoc row. The fix makes attribution **branch-aware**: a run whose branch matches a pipeline stage's branch is attributed to that pipeline (nested or suppressed), not just a run whose `workflow.invocationId` equals the stage's single recorded id. This catches both a stage's successor-step runs and a second/retry invocation on the same branch. Rules out the current invocation-id-only attribution that leaks any non-recorded invocation sharing the stage's branch.
- Genuinely stage-less `run workflow` invocations still render as top-level ad-hoc rows — the fix narrows ad-hoc to runs matching no stage of any pipeline, not to runs the current code happens to miss. Rules out over-suppressing real ad-hoc work.
- Pure pipeline-tree-model change: no daemon/schema change if the run rows already carry enough identity to attribute successor steps; if they do not, the plan surfaces that as the real gap. Rules out a speculative wire change before confirming the model can attribute from existing fields.

## Acceptance criteria

- [ ] A run sharing a pipeline stage's branch but carrying a different `workflow.invocationId` than the stage's recorded one is attributed to that pipeline and emits zero top-level ad-hoc rows, pinned by a pure-function test over `buildMonitorPipelineTreeJoin` reproducing the `1c65481a` (recorded) vs `f900c104` (same-branch leak) case.
- [ ] A pipeline stage backed by multiple step runs (entry + review + publication) attributes all of them to the stage, pinned by a test.
- [ ] A run workflow invocation matching no pipeline stage still renders as a top-level ad-hoc row, pinned by a test (no over-suppression).
- [ ] The duplicated-row regression is pinned: the same run id never appears both under a pipeline subtree and as a top-level node in the flattened tree.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — note (Observe section) that a stage's every step run nests under its stage and never doubles as a top-level ad-hoc row.
