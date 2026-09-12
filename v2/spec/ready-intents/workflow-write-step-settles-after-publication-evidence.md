---
name: workflow-write-step-settles-after-publication-evidence
---

# A workflow write step's durable row stays in-progress until publication evidence exists

A workflow-dispatched implement settles its durable row `completed` before the publication tail runs: `prepareWorkflowStep` hard-sets `publishCompletion: false` (`v2/src/execution/workflow-runner.ts:1899`) and `keepsCompletionInProgress` requires `publishCompletion !== false` (`v2/src/execution/write-loop.ts:1891`), so `boundaryRunStatus` writes `"completed"` at `boundary_committed` — PR-less, `terminalCause`-less, and untrue under the completion-honesty contract. Every strand class in the seed lands on work that is complete and gate-green; this is the mechanism that makes the strand look successful.

Behavior: a write step whose publication is deferred to the workflow tail keeps its row in-progress at the write-loop boundary, and reaches `completed` only when publication evidence (`prNumber`/`prUrl`) or a named terminal cause is recorded. Scope to the write-loop boundary settlement seam for workflow-dispatched steps; do not change where publication happens.

## Prerequisites

- A non-`complete` workflow step outcome settles its owning durable run row with a named operator-visible cause (`settleNonCompleteWorkflowStep`, `v2/src/execution/workflow-runner.ts`).
- Write-loop publication records `prNumber`/`prUrl` on the durable row when it runs inside the loop.
