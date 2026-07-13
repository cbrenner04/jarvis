# A reviewed workflow reports `completed` before its review step has run

`jarvis run workflow intent-reviewed` returns a run id that reaches `completed` as soon as
the **split** step finishes. The review step then executes under a **different run id the
operator never sees**. Polling the id you were handed shows `completed` with an empty log —
so the review looks like a silent no-op when it simply has not started yet.

## Problem

Observed 2026-07-13 (run `1c57346d`, seed `v2-has-no-help`), with the daemon freshly
restarted on current `main`:

| Time | Run | Event |
| --- | --- | --- |
| 18:55:30 | `1c57346d` (returned to operator) | `iteration_started` |
| 18:56:05 | `1c57346d` | `boundary_committed: done` → `loop_finished: complete` → **`completed`** |
| 18:56:35 | `75e0c241` (never surfaced) | critic invoked — claude-sonnet-5, 30s, `exit_kind: ok` |
| 18:56:45 | `75e0c241` | actuator invoked — 10s, `exit_kind: ok` |
| ~18:57:3x | `75e0c241` | `completed` |

The review **worked**: both roles ran, the verdict was non-empty (actuator fired), and the
split output landed. But the operator's run said `completed` **90 seconds before the critic
was even invoked**, and `jarvis run log <the-id-you-were-given>` is empty because the review
events belong to the other run row.

**This is the true mechanism behind the long-standing "review step is a silent no-op"
report** — the symptom operators actually see (instant `completed`, no log, no verdict, no
commit). Three prior diagnoses were wrong, and all three were wrong the same way: they
inferred from the parent run's empty log that no agent ran.

- "The review step never invokes an agent" — false; telemetry shows real 21–83s critic and
  actuator invocations throughout.
- "The critic gets a literal prompt id, returns an empty verdict, so the actuator never
  runs" — was a real defect (fixed, #1484), but not this symptom; the actuator does run.
- "`findReviewLandingCheckpoint` short-circuits the review" — plausible from the data, but
  not what happens on a fresh branch.

Evidence: the store holds 19 `intent` step runs against only 4-5 `review` step runs, because
the review row is a separate, later, un-surfaced run — not because reviews were skipped.

## Decisions

- **A workflow's run id must not reach a terminal status until every step of that workflow
  is terminal.** The operator polls one id; it must mean the workflow. Rules out today's
  "the id is really just the first step's run row."
- **A multi-step workflow's steps must be observable from the id the operator was given** —
  `jarvis run log <workflow-run-id>` shows the review step's events, or names the child run
  id. Rules out requiring the operator to discover the review row by querying SQLite.
- Do not "fix" this by making the review step synchronous inside the split step's run row if
  that reintroduces the daemon blocking on a long agent invocation
  (`responsive-daemon-run-git` class). The requirement is correct *status*, not a particular
  execution topology.

## Prerequisites

- `review-step-emits-log-events` — without it the review run row has no events to surface,
  so the log stays empty even once the right row is found.

## Out of scope

- The review prompt rendering (fixed, #1484).

## Documentation updates

- `v2/docs/operator-runbook.md` — delete the "review is untrustworthy / mechanism
  unresolved" warning and the "the review step is a silent no-op" claim; replace with the
  real semantics once this ships.
- `v2/docs/workflow-runner.md` — what a workflow run id's status covers.
