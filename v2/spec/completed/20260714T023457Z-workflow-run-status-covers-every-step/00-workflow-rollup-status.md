# 00 - Workflow rollup status

## Problem

`startWorkflowRun` (`v2/src/daemon/daemon.ts`) returns step 0's run id. Each later step runs
under its own run row, so step 0's row reaches `completed` when the split step's write loop
ends — while `review` has not been invoked yet. Nothing today can answer "is the *workflow*
behind this run id terminal?".

This subspec adds that answer as a pure, testable rollup over durable rows plus a liveness
flag. Wiring it into daemon reads is `01`.

## Decisions

- Compute the rollup at read; never overwrite a step row's status in place — resume skips a step whose `(project, branch, stepId)` row is `completed`, so stamping step 0's row with a later step's outcome would make resume re-run step 0. Rules out the in-place status update.
- Liveness is an input, not an inference from rows: an invocation whose `executeWorkflow` is still running rolls up non-terminal regardless of row state. Rules out a durable-rows-only rollup, which cannot see a `review-debate` step (no run row at all) and would read `completed` mid-debate.
- An authored step with no row in a *non-live* invocation rolls up `killed`. Rules out reporting `in-progress` forever after a daemon restart between steps, which would hang `wait`.
- The rollup applies only to the invocation's entry row (the snapshot's first authored step); every other step row keeps its own status so step-level progress stays readable.
- Sibling rows are matched by `workflowSnapshot.invocationId`, not by `(project, branch)` — a re-dispatched invocation on the same branch must not fold prior invocations' rows into this rollup.
- Deferred to first consumer: durable run identity for `review-debate` steps — pin when a caller needs a post-restart rollup across a debate step.

## Acceptance criteria

- [x] `StateStore` exposes an invocation-scoped lookup returning every run row whose `workflowSnapshot.invocationId` equals a given id.
- [x] A rollup function maps (entry run row, its workflow snapshot, that invocation's sibling rows, live flag) to an exposed `RunStatus`: live → `in-progress`; first authored durable step whose row is terminal-but-not-`completed` → that status; an authored durable step with no row while not live → `killed`; all authored durable steps `completed` → `completed`.
- [x] `review-debate` steps are skipped by the durable walk (they carry no run row) and do not force `killed`.
- [x] A run row with no workflow snapshot rolls up to its own status unchanged.
- [x] Unit tests cover, for an `intent-reviewed`-shaped two-step snapshot: split `completed` + review row absent while live → `in-progress`; split `completed` + review `failed` → `failed`; split `blocked` → `blocked`; both `completed` → `completed`; split `completed` + review row absent while not live → `killed`.
- [x] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/workflow-runner.md` — what a workflow run id's status covers: the returned id is the entry step's row, and its exposed status is a rollup over every authored step of the same invocation.
