---
name: patch-review-actuator-quota-fallback-audit
---

# Patch review actuator dropped quota fallback (fixed); audit for siblings

## Problem

Observed 2026-07-04 on the `emit-invocation-completed-telemetry-for-write-steps`
run: the review actuator loop in `v1/src/modes/patch/review.ts`
(`createActuator`) hand-rolls its own per-agent `reviewActuator` fallback
instead of using `executeWithQuotaFallback`. Its rung loop only continued to
the next agent on idle-timeout; a `quota` result threw immediately, so a
single quota hit killed the whole review pass (`review: actuator error
(quota)` -> `review did not complete`) instead of rotating claude -> codex per
`reviewActuatorOrder`.

Root-caused and fixed same session: added a quota branch mirroring the
existing idle-timeout fallback branch (continue to next rung on quota when
one remains, throw only when exhausted), plus a regression test (`actuator
falls back through reviewActuator order on quota` in
`v1/test/modes/patch/review.sandbox-unrunnable.test.ts`). Plan mode's sibling
(`v1/src/modes/plan/verdict-actuator.ts`) already uses
`executeWithQuotaFallback` and was unaffected.

## Scope (for plan → run)

- Audit `v1/src/modes/patch/review.ts` and any other hand-rolled per-agent
  rung loops (grep for `actuatorOrder`/`for (let rungIndex`) for further
  divergence from the shared `executeWithQuotaFallback` fallback semantics
  (e.g. `model_config`, auth-failure classification, non-quota `error` retry
  policy) that the debate roles (adversary/advocate/adjudicator) already get
  for free via `runRoleAttempt`.
- Consider whether the actuator rung loop should be rewritten on top of
  `executeWithQuotaFallback`/`createReviewInvocationBinding` instead of
  duplicating fallback control flow, to prevent this class of drift
  recurring.

## Out of scope

- The already-landed quota-fallback fix itself (done).
- Unrelated actuator behaviors (spec-file revert guard, rebase/push
  reconciliation, idle watchdog) — no bugs found there this session.
