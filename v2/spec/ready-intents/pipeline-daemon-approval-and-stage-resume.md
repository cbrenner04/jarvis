---
name: pipeline-daemon-approval-and-stage-resume
---

# Daemon-owned approval decisions and stage-scoped resume

## Prerequisites

- Reaching an approval stage durably records `awaiting`, and decisions durably target that stage ID.
- Awaiting approval state and pipeline continuation context survive state-store reopen and daemon reconciliation.
- Reopening a failed pipeline preserves prior succeeded stage identities, invocation IDs, and artifacts while making only the failed suffix eligible.

## Problem

The daemon loop stops at approval and failure boundaries, but no daemon-owned operation can decide a gate or continue from the durable boundary.

## Decisions

- The ordered loop settles a reached approval stage as `awaiting` and dispatches nothing later until a matching stage-ID decision; rules out an implicit pause or optimistic continuation.
- Approve records `approved` and continues with the next authored stage, while reject records `rejected` and terminally settles there; the first atomically admitted matching decision wins, and duplicate or racing decisions are refused without another dispatch; rules out auto-approval, implicit rerun after rejection, and last-writer-wins settlement.
- Resume re-enters a failed stage without dispatching completed predecessors, and re-enters an awaiting gate without approving it; rules out restarting the pipeline and fail-open continuation.
- Resume refuses completed and rejected pipelines with named errors; rules out a silent no-op.
- Approval, rejection, and resume remain daemon-owned after the requesting client disconnects; rules out client-side stage chaining.

## Acceptance criteria

- [ ] A reached approval stage records `awaiting`, and a controlled test proves no later workflow dispatch occurs before a decision.
- [ ] Approving the matching awaiting stage advances to the next stage; rejecting it leaves every later stage undispatched and derives a terminal rejected pipeline.
- [ ] After daemon restart, an awaiting pipeline remains awaiting until an explicit matching-stage decision and can then continue from persisted context.
- [ ] Resuming a failed pipeline re-dispatches that stage only; all prior stage invocation IDs remain unchanged.
- [ ] Resuming an awaiting pipeline preserves `awaiting` and dispatches no later stage.
- [ ] Resume on a completed or rejected pipeline returns a distinct named refusal for each terminal state.
- [ ] `v2/src/daemon/pipeline-execution.test.ts` regression coverage for approval decisions and stage-scoped resume fails against the pre-fix daemon behavior.

## Documentation updates

- `v2/docs/daemon-host.md` — approval state machine, decision admission, stage-scoped resume, and terminal refusal semantics.
- `v2/docs/v1-behaviors.md` — v2 daemon pipeline decision and resume behavior.
