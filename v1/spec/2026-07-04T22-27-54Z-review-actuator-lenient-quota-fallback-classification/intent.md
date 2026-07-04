---
name: review-actuator-lenient-quota-fallback-classification
---

# Review actuator applies lenient weak-quota fallback classification

## Problem

`createActuator`'s rung loop in `v1/src/modes/patch/review.ts` reads
`agent.run()`'s result `kind` directly and never calls
`applyQuotaFallbackWhenAllowed`. Every other per-agent fallback loop in the
codebase (`v1/src/modes/patch/shrink.ts`, `patch-invocation-binding.ts`,
`shrink-invocation-binding.ts`, `plan-invocation-binding.ts`,
`review-invocation-binding.ts`, `review-feedback.ts`, `prompt/run.ts`) runs
results through it. With `quotaFallback: "lenient"` and a matching
`weakQuotaExitCodes` entry, those callers upgrade an `error` result to
`quota` and fall through to the next configured agent; the review actuator
instead throws a terminal error on the first rung, even when a later agent
in `reviewActuatorOrder` is configured and available.

## Scope

- Classify each rung's `agent.run()` result through
  `applyQuotaFallbackWhenAllowed` before branching on `kind`, matching the
  pattern in `v1/src/modes/patch/shrink.ts`.
- Add a regression test exercising a lenient-config weak-quota exit code
  falling through to the next `reviewActuatorOrder` entry.

## Out of scope

- Rewriting the rung loop onto `executeWithQuotaFallback` /
  `createReviewInvocationBinding` (separate intent).
- The already-fixed strict-quota fallback branch and idle-timeout fallback
  branch.

## Prerequisites

- `applyQuotaFallbackWhenAllowed` and `weakQuotaExitCodes` config exist in `v1/src/agents/quota.ts`.
