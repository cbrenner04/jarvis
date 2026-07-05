---
name: converge-actuator-rung-loops-on-shared-fallback-executor
---

# Converge patch review/shrink actuator rung loops onto the shared fallback executor

## Problem

`v1/src/modes/patch/review.ts` (`createActuator`) and `v1/src/modes/patch/shrink.ts`
each hand-roll their own per-agent rung loop over `reviewActuatorOrder` instead of
using `executeWithQuotaFallback` (already used by plan's `verdict-actuator.ts` and
`v1/src/modes/review/run.ts`). This class of duplication already produced one bug
(review's rung loop threw immediately on quota instead of falling through to the
next agent; fixed). Confirmed on inspection: shrink.ts's loop already falls through
correctly on quota via `applyQuotaFallbackWhenAllowed`, so no second live bug exists
today — but the duplicated control flow remains a standing drift risk.

## Scope

- Rewrite the `createActuator` rung loop in `review.ts` and the rung loop in
  `shrink.ts` on top of `executeWithQuotaFallback` / `createReviewInvocationBinding`,
  preserving existing behavior: quota advances to next agent, idle-timeout advances
  to next agent (patch-specific extension), `model_config`/other `error` results stay
  terminal.
- Preserve all existing side effects tied to each rung (telemetry writes, verdict
  file restore, spec-tree-edit revert, commit/push/reconcile, auth-failure vs.
  strict-quota log line selection) — these move into binding callbacks/wrappers, not
  into the shared executor itself.

## Out of scope

- Idle-timeout watchdog mechanics themselves (unchanged).
- Plan mode's `verdict-actuator.ts` (already on the shared executor).
- Any behavior change to when quota/idle-timeout/model_config are terminal vs.
  advancing.

## Prerequisites

- `executeWithQuotaFallback` fallback executor exists in `shared/invocation/execute.ts`
- `createReviewInvocationBinding` exists in `v1/src/modes/review/review-invocation-binding.ts`
