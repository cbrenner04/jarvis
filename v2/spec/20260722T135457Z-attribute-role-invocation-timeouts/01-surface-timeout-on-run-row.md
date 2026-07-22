# 01 - Surface the attributed timeout on the run row

## Problem

`runReviewDebateStep` settles a failed review step with
`commitCompletionBoundary({ runStatus: "failed", outcomeKind: "invocation_failure" })` and no
`invocationFailureDetail` (`v2/src/execution/workflow-runner.ts`), so `composeRunOperatorError` takes
the legacy null-detail branch and reports `invocation_error` / `stop` naming nothing. With 00's
classification in hand, the run row can name the role, agent, model, and bound.

Depends on 00.

## Decisions

- Persist an `invocationFailureDetail` on review-step invocation failures carrying the failure kind
  and 00's attribution, plus a message naming role, agent, model, and bound; rules out today's
  detail-free settle that forces telemetry archaeology.
- Map `failureKind: "timeout"` to a new operator reason `role_timeout`; rules out reusing
  `iteration_timeout` (the write-loop bound, a different clock) and reusing `invocation_error`.
- `role_timeout` keeps `retryable: false` / `nextAction: "stop"`, matching today's disposition;
  rules out flipping resumability here — `preserve-committed-work-when-review-step-fails` owns that.
- A non-timeout review-step invocation failure keeps its current reason and next action; rules out
  reclassifying every review failure under an attribution change.

## Task checklist

- Persist the attributed `invocationFailureDetail` on review-step invocation failure in
  `runReviewDebateStep` and the standard/profile review step paths
  (`v2/src/execution/workflow-runner.ts`).
- Add `role_timeout` to `RUN_OPERATOR_ERROR_REASONS` and map `timeout` in
  `INVOCATION_BY_FAILURE_KIND` (`v2/src/daemon/run-operator-error.ts`).
- Tests in `v2/src/execution/workflow-runner.test.ts` and `v2/src/daemon/run-operator-error.test.ts`.
- Docs.

## Acceptance criteria

- [ ] A new test in `v2/src/execution/workflow-runner.test.ts` drives a review step whose actuator
      exceeds its bound and asserts the run row's persisted invocation-failure detail names the role,
      agent, model, and bound value; it fails against the pre-fix code.
- [ ] A `run-operator-error.test.ts` test asserts a `timeout` invocation failure composes to
      `reason: "role_timeout"` (not `invocation_error`), `retryable: false`, `nextAction: "stop"`.
- [ ] A non-timeout review-step invocation failure (e.g. `error`, `quota`) still composes to its
      existing reason and next action, pinned by test.
- [ ] A review step that completes normally settles unchanged — existing `workflow-runner.test.ts`
      review-step tests stay green.
- [ ] Tests fail when each added or modified guard is inverted; where a guard suppresses the timeout
      detail (non-timeout failure, completed step), the negative case proves no timeout detail is
      persisted.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/workflow-runner.md` — review-step settle detail on a bound-exceeded role invocation.
- `v2/docs/daemon-host.md` — operator-error mapping table gains `role_timeout`.
- `v2/docs/operator-runbook.md` § Gate trust — how a timed-out review step is reported.
- `v2/docs/v1-behaviors.md` — invocation-failure classification now distinguishes bound-exceeded.
