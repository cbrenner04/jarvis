# The implement publication tail settles honestly

## Problem

A `jarvis run workflow implement` run settles `completed` with a real commit on its branch, nothing pushed, no PR opened, and no review or publication run row. The completion-honesty contract states that a `completed` implement implies confirmed PR evidence, so the row is not merely unhelpful — it is untrue. Seven lanes across two sessions (2026-09-10 and 2026-09-11) landed in this state and every one was published by hand.

Root-caused 2026-09-11. Three mechanisms compose, and there is no exception anywhere in the chain:

1. `prepareWorkflowStep` sets `publishCompletion: false` on every workflow write-loop input (`v2/src/execution/workflow-runner.ts`), and the write loop's `keepsCompletionInProgress` requires `publishCompletion !== false` (`v2/src/execution/write-loop.ts`). So a workflow write step's durable row is settled `completed` at its boundary, before the workflow's publication tail runs. That is by design — `executeWorkflow` owns publication for workflow steps — but it means the row is terminal and PR-less for the whole tail.
2. The linked-implement finalizers then convert an already-settled `complete` outcome to `contract_miss` or `blocked` (`finalizeLinkedImplementPass`, `linkedImplementRoutingFailureOutcome`). `executeWorkflow` returned on any non-`complete` step result with no log append and no store write, so the row kept its premature `completed` status and nothing recorded the real outcome.
3. The daemon's admission handler ran `execute().catch(...).finally(...)` with no `.then`, so the returned `WorkflowResult` was discarded. A non-`complete` workflow outcome reached no log and no operator surface.

The pipeline stage's `harness_failure` is not an exception — it is the fallthrough classifier in `pipeline-stage-settlement.ts` for a terminal entry run with no `terminalCause` and an unmapped `outcomeKind: "done"`, which is exactly the row shape mechanism 1 leaves.

## Scope

The honest-settlement half only. Keeping a workflow write step's row `in-progress` across the publication tail is the larger change and is deliberately not attempted here: it would leave rows hanging `in-progress` on any tail path that fails to settle, which is worse than the defect. Settling at the point the outcome is known achieves honesty without that risk.
