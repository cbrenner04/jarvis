---
name: audit-actuator-rung-loops-vs-quota-fallback
---

# Audit hand-rolled actuator rung loops against `executeWithQuotaFallback` semantics

## Problem

`v1/src/modes/patch/review.ts` (`createActuator`) and `v1/src/modes/patch/shrink.ts`
hand-roll their own per-agent rung loops instead of using
`shared/invocation/execute.ts` `executeWithQuotaFallback` (already used by
`v1/src/modes/plan/verdict-actuator.ts` and other plan-mode call sites). The
review actuator's quota-fallback gap was already found and fixed this session;
this audits both hand-rolled loops for further divergence.

## Scope

- Compare `createActuator`'s rung loop (`v1/src/modes/patch/review.ts`) and the
  shrink rung loop (`v1/src/modes/patch/shrink.ts`) against
  `executeWithQuotaFallback` for: `model_config` handling, auth-failure
  classification, and non-quota `error` retry policy.
- Record findings and a rewrite-or-not recommendation in a durable doc
  (e.g. `v1/docs/quota-signals.md` or `v2/docs/v1-behaviors.md`, whichever
  fits the existing doc structure).
- Do not change rung-loop behavior in this intent; unresolved divergence is a
  follow-up seed.

## Out of scope

- The already-landed review-actuator quota-fallback fix.
- Rewriting either rung loop onto `executeWithQuotaFallback` (a follow-up if
  the audit recommends it).
- Unrelated actuator behaviors (spec-file revert guard, rebase/push
  reconciliation, idle watchdog).

## Prerequisites

- `executeWithQuotaFallback` exists in `shared/invocation/execute.ts` and is used by plan-mode actuators/roles.
