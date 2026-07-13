# A workflow run reports `completed` before its review step has run

The run id returned by `jarvis run workflow intent-reviewed` reaches `completed` as soon as
the **split** step finishes — while the review step is still pending. The review then runs
to completion afterwards, under its own run row.

## Problem

Observed 2026-07-13 (run `1c57346d`, seed `v2-has-no-help`), daemon freshly restarted on
current `main`:

| Time | Run | Event |
| --- | --- | --- |
| 18:55:30 | `1c57346d` (returned by `run workflow`) | `iteration_started` |
| 18:56:05 | `1c57346d` | `loop_finished: complete` → **`completed`** |
| 18:56:35 | `75e0c241` (the review row) | critic invoked — claude-sonnet-5, 30s, `exit_kind: ok` |
| 18:56:45 | `75e0c241` | actuator invoked — 10s, `exit_kind: ok` |

The workflow's status went terminal **30 seconds before its review step's critic was
invoked**. So a `completed` workflow run is not a statement that the workflow finished —
only that its first step did. Anything gating on that status (an operator, a script, a
`run wait`) proceeds while the workflow is still doing work.

## This is not the "silent review" symptom

Recorded so it is not re-derived. The long-standing report that the review is a "silent
no-op" is a **separate** defect: the review row emits no log events at all, because
`runReviewStep` receives no `logSink`. That is `review-step-emits-log-events`. Reading the
review step's own run id out of `jarvis run list` and logging it returns nothing — correctly
— no matter what the agents did.

Three diagnoses of the "silent review" have been wrong, all inferring "no agent ran" from
that empty log:

- "The review step never invokes an agent" — false; telemetry shows real 21–83s critic and
  actuator invocations throughout.
- "The critic gets a literal prompt id, returns an empty verdict, so the actuator never
  runs" — a real defect (fixed, #1484), but the actuator does run.
- "`findReviewLandingCheckpoint` short-circuits the review" — not what happens on a fresh
  branch.

**An empty log is not evidence that nothing ran.** Until `review-step-emits-log-events`
ships, the only trustworthy evidence a review executed is `~/.jarvis/telemetry.jsonl`
(`step_id: review`, roles `critic`/`actuator`).

## Decisions

- **A workflow's run id must not reach a terminal status until every step of that workflow
  is terminal.** Rules out today's behavior, where the id stands for the first step only.
- Do not fix this by making the review synchronous inside the split step's run row if that
  reintroduces the daemon blocking on a long agent invocation (`responsive-daemon-run-git`
  class). The requirement is a correct *status*, not a particular execution topology.

## Prerequisites

- None.

## Out of scope

- The empty review log — `review-step-emits-log-events`.
- Review prompt rendering — fixed, #1484.

## Documentation updates

- `v2/docs/workflow-runner.md` — what a workflow run id's status covers.
