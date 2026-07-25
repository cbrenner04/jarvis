# 01 - Exhausted-rung timeout names rungs and stops retry

## Problem

After 00, a role can time out on every configured binding inside one
`invokeReviewRole` call, but settlement still names only the last attempt and
`composeRunOperatorError` maps every `failureKind: "timeout"` to
`role_timeout` / `retry_later` (`v2/src/daemon/run-operator-error.ts`). The
workflow layer still treats all post-commit `timeout` as re-dispatch eligible
(`isPostCommitReviewRetryableFailureKind`). That advertises a re-dispatch that
reproduces a deterministic ~30-minute wall when every rung already failed the
same way.

Depends on 00. Further configured rungs are consumed inside `invokeReviewRole`;
the workflow only sees wall-clock timeout after the binding list is exhausted
(not a retryable timeout with another profile rung left).

## Decisions

- Terminal exhausted role timeout (every configured binding timed out in the
  invocation, including a **single-binding** list) sets `invocationFailureDetail`
  with `failureKind: "timeout"` and `bindingAttempts` listing **every** timed-out
  rung in profile order: each entry carries `bindingId`, a timeout `resultKind`,
  and `agent` + `model` (extend `BindingAttemptSummary` if needed); rules out
  last-rung-only attribution or “both rungs appear somewhere” in free text alone.
- One shared exhausted-timeout rule (helper or detail gate, e.g.
  `exhaustedRoleTimeout` on detail) drives both `composeRunOperatorError`
  (`nextAction: "stop"`, `retryable: false`) and post-commit / workflow
  retryability (`resumable: false`); rules out `retry_later` or `resumable: true`
  when the detail is exhausted.
- Non-exhausted `timeout` fixtures (detail without the exhausted gate) keep
  today’s `role_timeout` / `retry_later` mapping where still used; rules out
  blanket non-retryable for every `failureKind: "timeout"`.
- `role_stalled` and non-timeout invocation failures keep today's operator
  mappings; rules out reclassifying every review failure under this change.

## Task checklist

- On terminal timeout after 00’s escalation, build `invocationFailureDetail`
  from merged role execution (`buildReviewInvocationFailureDetail` and review-cycle
  → workflow-runner persistence) with the exhausted `bindingAttempts` contract and
  exhausted gate.
- Map exhausted timeout in `run-operator-error.ts` via the shared gate so
  `composeRunOperatorError` yields `stop`, not `retry_later`.
- Wire `isPostCommitReviewRetryableFailureKind` (and workflow outcomes) through
  the same gate so exhausted settle is not re-dispatch eligible.
- Tests in `review-role-invocation.test.ts`, `workflow-runner.test.ts`, and
  `run-operator-error.test.ts`.

## Acceptance criteria

- [ ] A new test in `v2/src/execution/review-role-invocation.test.ts` times out
      every binding in a two-rung list and asserts terminal
      `invocationFailureDetail.bindingAttempts` equals the ordered per-rung
      timeout summaries (agent, model, bindingId per rung); it fails against the
      pre-fix code.
- [ ] A new test in `v2/src/execution/review-role-invocation.test.ts` times out
      a single-binding list and asserts the same contract with one entry; inverting
      an “exhausted when multiple attempts only” guard fails the test.
- [ ] A test on the production path (`workflow-runner.test.ts` driving a review step
      to exhausted wall-clock timeout, or a focused test exported around
      `buildReviewInvocationFailureDetail`) asserts persisted
      `invocationFailureDetail` carries the exhausted gate and full
      `bindingAttempts` before operator compose; hand-built detail alone is not
      sufficient.
- [ ] A new test in `v2/src/daemon/run-operator-error.test.ts` composes
      exhausted-gate timeout detail to `reason: "role_timeout"`, `nextAction:
      "stop"`, `retryable: false`; inverting the exhausted guard yields
      `retry_later` and fails the test.
- [ ] A `workflow-runner.test.ts` test drives a review step whose role exhausts
      every rung on wall-clock timeout and asserts `resumable: false` (via the
      shared exhausted gate, not `isPostCommitReviewRetryableFailureKind("timeout")`
      alone); inverting the gate fails the test.
- [ ] `run-operator-error.test.ts` `test.each` rows for `quota`, `error`, and
      `stall` and `composeRunOperatorError differs for stall vs error failureKind`
      stay green.
- [ ] Tests fail when each added or modified guard is inverted; where a guard
      suppresses the exhausted settlement shape (success mid-escalation,
      non-timeout failure), the negative case proves no exhausted `bindingAttempts`
      shape and no `stop` mapping.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — `role_timeout` after exhausted rungs: `stop`,
  re-dispatch does not fix deterministic wall-clock overrun; document internal
  rung escalation and per-rung cost (N × bound). Reconcile with snapshot
  re-dispatch / binding re-resolve: continuing queued work on a snapshot resume
  is not the same as retrying an exhausted wall-clock settle.
- `v2/docs/workflow-runner.md` — timeout settle after exhausted rungs is not
  `retry_later` / not `resumable`.
- `v2/docs/daemon-host.md` — operator-error table: exhausted `role_timeout` is
  `stop`.
- `v2/docs/v1-behaviors.md` — exhausted review-role timeout is non-retryable and
  names all rungs tried.
