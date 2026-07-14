# 00 - Fresh dispatch forces a new run row per step

`executeWorkflow` has no notion of "this is a new operator request". Every call replays the steps
array and re-enters each step through `findRunByProjectBranch({project, branch, stepId})`, so a
prior `completed` run short-circuits: `prepareWorkflowStep` returns `{ kind: "completed" }` with the
old run id, and even if it did not, `prepareRun` in `write-loop.ts` would reuse the same row and
return its committed result. Give the runner an explicit fresh-dispatch input that suppresses
reuse of runs from prior invocations, while keeping reuse inside the current execution (shrink,
linked-implement re-entry, review landing checkpoint) and keeping resume behavior when the input is
absent.

## Decisions

- Fresh dispatch is an explicit `WorkflowRunnerInput` field, defaulted off — rules out inferring
  "new request" from step shape or timestamps, and keeps every existing `executeWorkflow` caller
  and test on today's resume semantics.
- Freshness is per `stepId`, applied the first time this execution touches that step: prior runs
  for the step are ignored and a new run row is created. Later touches of the same `stepId` within
  the same execution reuse the row created this execution — rules out "fresh for step 0 only"
  (a stale `completed` review/second step would still short-circuit) and "fresh on every lookup"
  (shrink and linked-implement re-entry would spawn duplicate rows).
- The forced-new-row decision reaches `prepareRun` (`write-loop.ts`); suppressing only
  `prepareWorkflowStep`'s short-circuit is insufficient — rules out a fix confined to the runner.
- On fresh dispatch, `buildWorkflowSnapshot` mints a new `invocationId` instead of inheriting a
  matching prior run's snapshot; the "owned by another invocation" throw cannot fire for a fresh
  request. Rules out reusing the old snapshot, which would stamp new rows with a stale invocation.
- `findRunByProjectBranch` keeps its `(project, branch, stepId)` key and latest-row semantics; no
  store schema or query change — the newly created row is the latest, so `list`, `revise`, and
  resume attach to it.
- Non-terminal prior runs are untouched: an `in-progress` / `paused` / `budget-soft-stopped` /
  `awaiting-human` / `revising` run is not in scope here, and dispatch-level admission for those
  stays in `01`.

## Acceptance criteria

- [x] `executeWorkflow` called with fresh dispatch set, against a project/branch/step whose prior
      run is `completed`, creates a new run row, invokes the agent, and returns the new run id.
- [x] With fresh dispatch set on a two-step preset, both steps get new run rows even when both had
      `completed` rows from a prior invocation.
- [x] With fresh dispatch set, an `implement` step's post-completion shrink step and a linked-index
      implement's re-entry still reuse the run row created during the same execution (no duplicate
      rows per step per execution).
- [x] With fresh dispatch set, the workflow snapshot recorded on the new rows carries a new
      `invocationId`, and no "owned by another invocation" error is raised.
- [x] With fresh dispatch absent, existing resume behavior is unchanged: `workflow-runner` resume /
      step-idempotence tests in `v2/src/execution/workflow-runner*.test.ts` stay green.
- [x] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/workflow-runner.md` — the resume contract's step-idempotence rules apply only when the
  caller does not request a fresh dispatch; a fresh dispatch mints a new invocation and a new run
  row per step, reusing only rows created within that execution.
- `v2/docs/v1-behaviors.md` — record the changed runner behavior (existing functionality change).
