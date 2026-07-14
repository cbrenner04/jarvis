---
name: workflow-run-status-covers-every-step
---

# A workflow's run id stays non-terminal until every step is terminal

The run id returned by `jarvis run workflow <preset>` must not reach a terminal status
(`completed`/`failed`/`blocked`) while any step of that workflow is still pending or running.

## Behavior

- Observed 2026-07-13 (run `1c57346d`, preset `intent-reviewed`): the returned id reached
  `completed` when the **split** step's write loop finished; the review step's critic was
  invoked 30s later under a separate run row (`75e0c241`). A `completed` status therefore
  meant "first step done", not "workflow done".
- Anything gating on that status — an operator, a script, `run wait` — proceeds while the
  workflow is still invoking agents.
- Required: the returned id's terminal status implies every step of the workflow is terminal,
  including a trailing `review` step through its own completion (success, failure, or blocked —
  not any step beyond `review` itself).
- A workflow that stops early (`blocked`, `contract_miss`, `invocation_failure`,
  `awaiting-human`, soft-stop) still resolves the returned id to that stopping outcome — the
  requirement is that a *success* status is not reported before later steps have run.

## Decisions

- Fix the **status**, not the execution topology — do not make the review synchronous inside the
  split step's run row if that reintroduces the daemon blocking on a long agent invocation
  (`responsive-daemon-run-git` class). Rules out "just await the review before returning" as the
  design if it blocks the daemon.
- Steps stay in separate run rows (one row per step invocation, as today). The row the returned
  id points at is not a fixed snapshot: its status must be updated (or computed live, e.g. by
  looking up sibling rows for the same workflow invocation) as later steps land, so that reading
  the returned id's status after `review` finishes reflects `review`'s outcome, not `split`'s.
  Whether that's an in-place status update or a computed rollup is an implementation choice; the
  requirement fixed here is that the same id must expose the later outcome once the later step
  is terminal.

## Out of scope

- The review row emitting no log events (`runReviewStep` gets no `logSink`) —
  `review-step-emits-log-events`. An empty review log is not evidence nothing ran; telemetry
  (`~/.jarvis/telemetry.jsonl`, `step_id: review`) is the trustworthy source until that ships.
- Review prompt rendering — fixed, #1484.

## Documentation updates

- `v2/docs/workflow-runner.md` — what a workflow run id's status covers.

## Prerequisites
