---
name: linked-implement-finalization-logs-non-complete-returns
---

# Linked-implement finalization names the producer when it ends a workflow non-complete

`finalizeLinkedImplementPass` (`link_incomplete` → `contract_miss`, `index_routing_mutated` → `blocked`) and `linkedImplementRoutingFailureOutcome` (routing failure → `blocked`; `empty_index`/`already_complete` → `complete` with `implementReviewEligible: false`) return from `runLinkedImplementStep` without appending anything to the run log. The run log ends at `loop_finished` and the operator cannot tell which producer ended the workflow or why — two candidates (`index_routing_mutated` vs the `already_complete` re-scan) were indistinguishable from the surviving evidence of the 2026-09-11 strands.

Behavior: each of these return sites appends a durable log event naming the producer and the reason, including the `complete`-but-review-skipping shapes. Diagnostic only — outcome kinds and routing semantics stay as they are.

## Prerequisites

- A non-`complete` workflow step outcome settles its owning durable run row with a named operator-visible cause (`settleNonCompleteWorkflowStep`, `v2/src/execution/workflow-runner.ts`).
- Workflow steps append durable log events through the step `logSink` seam.
