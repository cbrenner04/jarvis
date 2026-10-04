---
name: surviving-mutation-row-honest-on-any-step
---

# A surviving mutation settles a failed row no matter which step produced it

## Problem

`surviving_mutation_failed` on an `implement-review` step leaves the durable row `completed` with no
error columns, so `run list` / `run wait` hide the failure entirely. Observed 2026-07-25 on spec
`20260724T225946Z-write-loop-progress-extended-iteration-wall` (PR #2121): the terminal
`loop_finished` record carried `loopOutcomeKind: "surviving_mutation_failed"`, `resumable: true`, and
the mutation/file/line, while the row reported `completed  not-live  -  -  -`.

`v2/src/execution/write-loop.ts` already demotes to `failed` for this outcome; the review-step /
workflow-rollup path does not.

## Decisions

- A `surviving_mutation_failed` outcome settles durable `failed` with `error.reason:
  "surviving_mutation_failed"`, `retryable: true`, `nextAction: "resume"`, and `survivingMutation` /
  `survivingMutationSourceFile` / `survivingMutationSourceLine` on the row — regardless of which step
  produced it. Rules out the observed bare `completed` row.
- A run whose review step succeeded still settles `completed`. Rules out demoting every review-step
  run that emits a terminal record.
- Out of scope: resume admission and recovery (separate behaviors); reducing the mutation-miss rate.

## Acceptance criteria

- [ ] A test drives `surviving_mutation_failed` on an `implement-review` step and asserts the durable
      row is `failed` with `error.reason: "surviving_mutation_failed"`, `retryable: true`, and
      mutation/file/line populated; it fails against pre-fix code, which reports `completed`.
- [ ] The same assertions hold on `run wait` for that run.
- [ ] A run whose review step succeeded still settles `completed` with no `error`.
- [ ] `bun run typecheck`, `bun run test:v2`, `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — the `surviving_mutation_failed` operator-error row: state that it
  settles `failed` from any producing step, including review steps.

## Prerequisites
