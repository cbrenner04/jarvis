# Document review idle-budget semantics

## Problem

Durable guidance still describes review roles as fixed at 90 s or outside the machine-wide idle budget.

## Decisions

- Describe one machine-wide `idleOutputTimeoutMs` contract for workflow write and review-role invocations.
- Document configured positive, absent-key 90 s fallback, and zero-disabled semantics.
- Retain the historical pre-fix interpretation for old `role_stalled` records.

## Task checklist

- [ ] Align configuration and workflow guidance.
- [ ] Align liveness and operator guidance.
- [ ] Update the v1 parity catalog.

## Acceptance criteria

- [x] `v2/docs/agent-model-config.md` and `v2/docs/install-and-config.md` state that `idleOutputTimeoutMs` governs workflow write and review-role invocations, with a 90 s absent-key fallback and `0` disabled semantics for reviews.
- [x] `v2/docs/workflow-runner.md` and `v2/docs/invocation-liveness.md` describe configured, fallback, and disabled review-role budgets without fixed-budget or no-global-budget claims.
- [x] `v2/docs/operator-runbook.md` removes the write-only warning, describes current review behavior, and retains the pre-fix 90 s caveat for old `role_stalled` records.
- [x] `v2/docs/v1-behaviors.md` records configured, fallback, and disabled v2 review-role idle-budget semantics and source paths.

## Documentation updates

- `v2/docs/agent-model-config.md` — record the machine-wide write/review idle budget.
- `v2/docs/install-and-config.md` — align config-key scope and disabled semantics.
- `v2/docs/workflow-runner.md` — align review-step construction and invocation bounds.
- `v2/docs/invocation-liveness.md` — remove fixed-review and no-global-budget claims.
- `v2/docs/operator-runbook.md` — remove the write-only warning and retain the historical-record caveat.
- `v2/docs/v1-behaviors.md` — catalog configured, fallback, and disabled review semantics.
