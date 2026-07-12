# `intent-reviewed`'s review step is a silent no-op that reports success

The review phase creates a durable run row, emits zero log events, writes no
artifact, makes no commit, and reports `completed`. The operator gets a run that
looks reviewed and is not. A review that always passes without running is worse
than no review — it is false assurance on the exact artifact the operator trusts it
to check.

## Problem

Observed 2026-07-12 on `main` at `4525d3a9`. Also observed twice by the operator in
an earlier session ("intent review didn't seem to do anything, no logs, just gives
status complete").

```sh
jarvis run workflow intent-reviewed --seed v2/spec/seeds/workflow-composable-collapse.md
```

The split half works: it produced 5 ready-intents and draft PR #1433. Two run rows
exist for the branch:

```
d446cb08…  jarvis  intent/workflow-composable-collapse  completed  not-live   ← review step
9f279f27…  jarvis  intent/workflow-composable-collapse  completed  not-live   ← split step
```

The split step's log is a normal three-event write loop:

```json
{"kind":"iteration_started"}
{"kind":"boundary_committed","outcomeKind":"done","runStatus":"completed"}
{"kind":"loop_finished","loopOutcomeKind":"complete","iterationsConsumed":1}
```

The review step's log is **empty**. Zero events. And the branch carries exactly one
commit — `jarvis: complete run`, the split output. No review commit, no verdict
file, nothing.

`reviewPasses` defaults to `1` (`intent-workflow-steps.ts:329`), so a review pass is
requested by default and the step *is* built. It simply does nothing observable and
then reports success.

## Scope

- Determine why the review step produces no events and no output. Candidates: the
  step is constructed but never executed; it executes against an empty/missing
  workspace (`resolveReviewedIntentWorkspace`); or its actuator is invoked and its
  output is dropped on the floor by `landReviewedIntentOutput`
  (`workflow-runner.ts:1448`).
- A review step that runs must emit log events — at minimum `iteration_started` and
  a terminal outcome, like every other step.
- A review step that cannot run must **fail**, not report `completed`. Silent
  success on a skipped review is a gate-trust bug in the same family as
  `run-cannot-report-complete-over-red-gate`.
- Regression coverage must assert the review step *did something* — a log event, a
  verdict artifact, a commit — not merely that the run reached `completed`.

## Decisions

- `completed` must mean the review ran. If `reviewPasses >= 1` and no review
  actually executed, that is a failed run.
- Assert on review *evidence*, not on run status. The current tests presumably check
  status and are satisfied by a no-op; that is exactly how this shipped.
- Related: `tui-tests-bypass-the-render-path` is the same class of blind spot — a
  test that passes while the real path does nothing.

## Out of scope

- The split half of `intent-reviewed`, which works.
- `plan-reviewed*` review phases — likely the same defect, but they die earlier on
  `invalid-token-discards-completed-work` and cannot be observed until that lands.
  Re-test them once it does.

## Documentation updates

- `v2/docs/workflow-runner.md` — what the review phase emits and when it fails.
- `v2/docs/operator-runbook.md` — remove the "review evidence missing" caveat once
  this ships.
