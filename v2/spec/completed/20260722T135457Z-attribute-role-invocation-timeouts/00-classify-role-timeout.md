# 00 - Classify and attribute the bound-exceeded role invocation

## Problem

`invokeReviewRole` (`v2/src/execution/review-role-invocation.ts`) arms a wall-clock abort at
`roleTimeoutMs ?? DEFAULT_ITERATION_TIMEOUT_MS`. When it fires, the aborted invocation returns a
plain `InvocationError` (`kind: "error"`), so `reviewRoleFailureKind` reports `"error"` — identical
to a genuine agent failure — and nothing records which role hit which bound on which binding.

## Decisions

- Add `"timeout"` to `InvocationFailureKind`; rules out overloading `"error"` and forcing readers to
  sniff message text.
- Carry attribution as structured optional fields on `InvocationFailureDetail` (`role`, `agent`,
  `model`, `boundMs`); rules out a message-only string the operator must parse.
- Only `invokeReviewRole`'s own timer counts as a timeout — a caller-signal abort (pause/kill)
  keeps its existing classification; rules out relabeling every aborted invocation a timeout.
- Attribution comes from the final attempt's `binding.metadata` (`agent`, `model`); when metadata is
  absent the fields are omitted rather than invented.
- `invokeReviewRole` keeps returning an `InvocationExecution` with the timeout attached as an
  additive field; rules out a new return shape that churns every debate/cycle call site.
- Applies to every role routed through `invokeReviewRole` (critic, actuator, adversary, advocate,
  adjudicator); rules out an actuator-only special case in a shared helper.
- No bound's value changes; rules out folding timeout tuning into an attribution change.

## Task checklist

- Extend `InvocationFailureKind` with `"timeout"` and `InvocationFailureDetail` with the optional
  attribution fields (`v2/src/execution/invocation-failure.ts`).
- Have `invokeReviewRole` record that its own timer (not the caller signal) aborted the invocation
  and attach role/agent/model/bound attribution to the returned execution.
- Have `reviewRoleFailureKind` report `"timeout"` for that case.
- Propagate the failure kind and attribution through `executeReviewCycle` and `executeReviewDebate`
  role-failure outcomes/results.
- Add tests in `v2/src/execution/review-role-invocation.test.ts` (new), `review-cycle.test.ts`, and
  `review-debate.test.ts`.

## Acceptance criteria

- [x] A new test in `v2/src/execution/review-role-invocation.test.ts` drives a role invocation past a
      short `roleTimeoutMs` with a hanging binding and asserts the result classifies as `timeout`
      carrying the role, the binding's agent and model, and the bound value; it fails against the
      pre-fix code.
- [x] A caller-signal abort (not the role timer) still classifies as it does today, pinned by a test
      that fails if the timer/caller distinction is dropped.
- [x] `executeReviewCycle` and `executeReviewDebate` surface the `timeout` failure kind and its
      attribution for the failed role instead of `error`, pinned by tests in `review-cycle.test.ts`
      and `review-debate.test.ts`.
- [x] A role invocation that finishes inside its bound is unaffected — existing `review-cycle.test.ts`
      and `review-debate.test.ts` completion tests stay green.
- [x] Tests fail when each added or modified guard is inverted; where a guard suppresses the timeout
      classification (caller abort, non-timeout failure), the negative case proves no timeout
      attribution is attached.
- [x] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/workflow-runner.md` — per-role invocation bound and the `timeout` failure kind.
