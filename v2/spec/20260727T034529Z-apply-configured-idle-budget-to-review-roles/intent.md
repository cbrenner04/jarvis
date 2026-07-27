---
name: apply-configured-idle-budget-to-review-roles
---

# Apply the configured idle budget to review roles

## Problem

Workflow construction applies the resolved machine `idleOutputTimeoutMs` only to write steps. Review and review-debate invocations therefore always use their hardcoded 90 s fallback, so changing the documented machine-wide budget does not affect them.

## Decisions

- Apply the existing machine-wide idle budget to review and review-debate steps; rules out a review-specific config key.
- Keep 90 s only as the review invocation fallback when the key is unset; rules out deleting or retuning the default.
- Preserve `0` as watchdog-disabled for review roles; rules out treating disabled config as an absent override that re-arms the fallback.
- Leave write-step bound behavior unchanged; rules out folding liveness-policy or tuning changes into this plumbing fix.

## Acceptance criteria

- [ ] Workflow construction stamps a configured positive `idleOutputTimeoutMs` onto review and review-debate steps as `idleOutputMs`.
- [ ] A review-role invocation driven through the workflow path observes the configured idle budget instead of 90 s.
- [ ] With `idleOutputTimeoutMs` unset, review-role invocations still use the 90 s fallback.
- [ ] With `idleOutputTimeoutMs: 0`, review-role invocations have no idle-output watchdog.
- [ ] Write-step bound application remains unchanged; its existing coverage stays green.
- [ ] Dropping the review-step `idleOutputMs` wiring makes `v2/src/commands/workflow.test.ts`'s `applies the configured idle budget to review and review-debate steps` regression test fail.

## Documentation updates

- `v2/docs/agent-model-config.md` — state that `idleOutputTimeoutMs` governs write and review-role invocations.
- `v2/docs/operator-runbook.md` — replace the write-only warning with current behavior while retaining the pre-fix budget note for old `role_stalled` records.
- `v2/docs/v1-behaviors.md` — record configured, fallback, and disabled review-role idle-budget semantics.

## Prerequisites

- Machine config already resolves `idleOutputTimeoutMs` for write steps with a 90 s default and `0` disable semantics.
- Review-role invocation already accepts an explicit `idleOutputMs` and falls back to 90 s when omitted.
