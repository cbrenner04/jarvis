# 00 - Review step emits start and terminal log events

## Problem

`runWorkflowStep` (`v2/src/execution/workflow-runner.ts:300`) forwards `logSink`
to write steps only; `runReviewStep` (`:1735`) takes no sink. A durable review
run (reviewed-intent workflows, where `deferredIntentOutput` is set and
`store.createRun` runs at `:1765`) therefore completes with an empty log, so
`jarvis run workflow intent-reviewed` gives operators nothing to tail.

## Decisions

- Emit only on review steps that own a durable run row (`deferredIntentOutput` set) — other review steps synthesize a run id with no run row (`:1773`), so their records would be orphans no reader can key on.
- Reuse existing `LogEvent` kinds (`iteration_started`, `loop_finished`) rather than adding review-specific kinds; `ReviewStepOutcome` kinds are already `WriteLoopOutcomeKind`s, so readers need no new cases.
- One `iteration_started` per review step (the step's `attemptId`), not one per review cycle: cycles are not attempts and the durable path records a single attempt (`:1776`).
- Terminal `loop_finished` carries the step's outcome kind, `iterationsConsumed` (cycle count), and `resumable`, matching the write-loop terminal record.
- The resumed landing path (checkpoint hit at `:1749`) emits the same start/terminal pair on the existing run row — a re-entered review step is still work an operator tails.

## Acceptance criteria

- [x] `runReviewStep` receives the step's `logSink` from `runWorkflowStep`.
- [x] A review step with a durable run row appends `iteration_started` (with its `attemptId`) to that run's log before critic/actuator execution.
- [x] The same step appends a terminal `loop_finished` carrying its outcome kind, cycles consumed, and `resumable` flag, on both the completed and the `invocation_failure` path.
- [x] A review step re-entered at its landing checkpoint emits the same start and terminal events on the existing run row.
- [x] Review steps without a durable run row append nothing.
- [x] `v2/src/execution/workflow-runner.test.ts` covers the above by reading the review run's log records (not run status).

## Documentation updates

- `v2/docs/workflow-runner.md` — Review dispatch: which review steps emit log events, and which events.
