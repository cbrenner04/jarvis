---
name: review-actuator-shared-invocation-executor
---

# Review actuator rung loop runs on the shared invocation executor

## Problem

`createActuator` in `v1/src/modes/patch/review.ts` hand-rolls its own
per-agent fallback loop (idle-timeout continue, quota continue, terminal on
exhaustion) instead of running through `executeWithQuotaFallback`. This
duplicated control flow is what let the quota-fallback branch go missing in
the first place, and what let it drift again on lenient weak-quota
classification. The debate roles (adversary/advocate/adjudicator) and
standalone review mode get this fallback semantics for free via
`runRoleAttempt` / `createReviewInvocationBinding`.

## Scope

- Extract the review actuator's per-rung invoke step into an
  `InvocationBinding` per `reviewActuatorOrder` entry (idle watchdog,
  descendant tracking, telemetry stay inside `invoke`).
- Drive rung selection and fallback (idle-timeout, quota, lenient weak-quota)
  through `executeWithQuotaFallback` instead of the hand-rolled loop.
- Keep post-success side effects (verdict restore, spec-edit revert, git
  commit/push/reconcile, PR body refresh) and terminal-error/model_config
  handling behaviorally unchanged.
- Existing actuator tests in `v1/test/modes/patch/review.sandbox-unrunnable.test.ts`
  stay green (behavior unchanged by the extraction).

## Out of scope

- Changing fallback semantics themselves (lenient weak-quota classification
  is a separate concern; strict-quota fallback is already landed).
- `v1/src/modes/patch/shrink.ts`'s rung loop — not divergent, not named in
  this seed.

## Prerequisites

- `executeWithQuotaFallback` and `InvocationBinding` exist in `shared/invocation/execute.ts`.
- `createReviewInvocationBinding` in `v1/src/modes/review/review-invocation-binding.ts` demonstrates the binding pattern for review-shaped invocations.
