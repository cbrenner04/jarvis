# 00 - Publication-tail failure settles a durable row

## Problem

`executeWorkflow`'s completion-publication tail (`v2/src/execution/workflow-runner.ts`) writes every
status transition and the terminal `loop_finished` against `lastResult.runId`. When the last step is a
non-durable `review` step (implement `--review-behavior light`: `landing` absent, so
`isDurableWorkflowStep` is false and the step run id is a synthesized `crypto.randomUUID()`), the
`in-progress` → `failed` writes hit no row and the terminal record lands under a run id with no durable
row. A `surviving_mutation_failed` from the finalizer then evaporates: every durable row stays
`completed`, so the rollup reports `completed` and `run list` / `run wait` show no error.

Write-loop-owned publication already demotes correctly (`readyFailed`, `v2/src/execution/write-loop.ts`);
only the workflow-owned tail leaks.

## Decisions

- The publication tail settles the workflow's durable completion row, not the last step's row, whenever
  the last step is non-durable: the completion (last write) step's hidden `~shrink` row when one exists,
  else the completion step's own row. Rules out settling a phantom run id, and rules out inventing a new
  durable row for a step the workflow deliberately keeps non-durable.
- The terminal `loop_finished` (including `survivingMutation` / `survivingMutationSourceFile` /
  `survivingMutationSourceLine`) is appended under that same durable run id, so the log and the row agree.
  Rules out demoting the row while the evidence stays under the phantom id.
- Settle-row resolution applies to the whole tail — `in-progress`, `completed`, and every failure branch —
  so success still settles `completed` on the same row. Rules out a failure-only special case that leaves
  the success path writing to the phantom id.
- A durable last step (review-debate) keeps settling its own row; unchanged.
- Out of scope: entry rollup / error-column surfacing (subspec 01), resume admission, mutation-miss rate.

## Acceptance criteria

- [x] A workflow whose last step is a non-durable `review` step and whose publication fails with
      `surviving_mutation_failed` leaves a durable `failed` row carrying the terminal
      `loop_finished` with `loopOutcomeKind: "surviving_mutation_failed"`, `resumable: true`, and
      mutation/file/line; a new `workflow-runner.test.ts` case fails against pre-fix code (durable rows
      stay `completed` and no terminal record is reachable from any durable run id).
- [x] `run wait` on that durable run id reports `runStatus: "failed"` with `error.reason:
      "surviving_mutation_failed"`, `retryable: true`, `nextAction: "resume"`, and mutation/file/line.
- [x] The same workflow whose publication succeeds still settles that durable row `completed` with no
      terminal failure record.
- [x] A workflow whose last step is a durable review step still settles that step's own row on both the
      failure and success paths (existing `workflow-runner.test.ts` publication cases stay green).
- [x] Inverting each added guard (the non-durable-last-step branch and the shrink-row-present branch)
      fails at least one test; with the branch inverted so no redirect occurs, the negative case proves no
      durable row is demoted.
- [x] `bun run typecheck`, `bun run test:v2`, `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/workflow-runner.md` — completion-publication section: the tail settles the durable completion
  row (hidden `~shrink` when present, else the completion step's row) when the last step is non-durable,
  on success and failure alike.
- `v2/docs/daemon-host.md` — the `surviving_mutation_failed` operator-error row: it settles `failed` from
  any producing step, including review steps.
- `v2/docs/v1-behaviors.md` — extend the v2 finalization bullet (line ~458) to record that workflow-owned
  publication demotes a durable row regardless of which step produced the failure.
