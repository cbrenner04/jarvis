---
name: review-step-emits-log-events
---

# Review steps emit log events on their run row

## Problem

A `behavior: "review"` step creates a durable run row and writes zero log events.
`runWorkflowStep` receives `logSink` but only forwards it to write steps
(`workflow-runner.ts:305,332-341`); `runReviewStep` / `runStandardReviewStep` /
`executeReviewCycle` take no sink. The run row also carries empty `specRef` /
`specPath` (`workflow-runner.ts:1765`). Operators tailing the review run see an
empty stream and cannot tell the step from a no-op.

Observed 2026-07-12 on `main` at `4525d3a9` via
`jarvis run workflow intent-reviewed`: the review run row is `completed` with an
empty log.

## Scope

- Thread the step's `logSink` into the review step and its cycle execution.
- A review step that runs emits at minimum a start event and a terminal outcome
  event, like every other step.
- The review run row identifies what it reviewed instead of empty spec fields.
- Regression coverage asserts events on the review run's log, not run status.

## Out of scope

- Whether the critic prompt is rendered correctly.
- Failing a run whose review produced no evidence.

## Documentation updates

- `v2/docs/workflow-runner.md` — what the review phase emits.

## Prerequisites
