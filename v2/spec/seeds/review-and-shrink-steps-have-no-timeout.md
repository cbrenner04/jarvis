# A workflow's review and shrink steps run with no timeout at all

The 600 s iteration watchdog only wraps **write-loop** iterations. A workflow's non-write steps —
`review` (critic/actuator) and `shrink` — invoke their agents through a path that passes no
timeout, so they can run indefinitely.

## Problem

Observed 2026-07-14, driving P1 implement runs. Two runs
(`20260714T023517Z-acceptance-criteria-require-a-failing-test`,
`20260714T023458Z-triage-merge-resolves-v2-worktrees`) held live `claude -p` child processes for
**14+ and 9+ minutes** past their write step's completion, with the run still `in-progress` and
no timeout event. Both exceed `DEFAULT_ITERATION_TIMEOUT_MS` (600 000 ms).

The mechanism:

- `v2/src/execution/write-loop.ts:459` arms `setTimeout(abortExecution, iterationTimeoutMs)` —
  but only inside `runIteration`, i.e. only for write-loop iterations.
- `v2/src/execution/review-debate-render.ts:318` (`invokePatchReviewRole`) calls
  `executeWithQuotaFallback` with `prompt`, `cwd`, `bindings`, an optional `signal`, and
  telemetry. **No timeout is threaded through.** `invokePatchLightReviewRole` (line 360) is the
  same.
- Nothing else in that path arms a wall clock.

So a review agent that hangs hangs the workflow, and the operator's only signal is a run that
stays `in-progress` forever. This compounds `v2-has-no-idle-output-watchdog`: v2 has neither an
idle-output watchdog *nor*, on these steps, a wall clock.

`iterationTimeoutMs` is plumbed onto workflow steps (`workflow-runner.ts:988`, `:1230`), so the
value reaches the step — it simply is not applied to non-write invocations.

## Decisions

- **Every agent invocation in a workflow is bounded by a wall clock**, whichever step it belongs
  to. Rules out today's split where write iterations are bounded and review/shrink are not.
- A step that hits the wall clock terminates its child process and records a named timeout
  outcome on the run — not a silent hang.
- Reuse the existing `iterationTimeoutMs` value and the existing abort seam; do not introduce a
  second timeout knob.

## Prerequisites

- None.

## Out of scope

- An idle-output watchdog for v2 (`v2-has-no-idle-output-watchdog`) — that is the finer-grained
  guard; this seed is the coarse backstop that should exist regardless.
- Whether the review step logs anything (`review-step-emits-log-events`).

## Documentation updates

- `v2/docs/write-behavior.md` — which invocations are bounded, and by what.
- `v2/docs/operator-runbook.md` § Recovery — a run stuck `in-progress` with a live agent child.
