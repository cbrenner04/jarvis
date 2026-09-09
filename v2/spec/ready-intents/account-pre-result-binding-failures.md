---
name: account-pre-result-binding-failures
---

# Account for binding failures before result settlement

## Prerequisites

## Module-boundary surface

- Shared invocation execution and telemetry in `shared/invocation/`

## Problem

A binding can fail after invocation starts but before returning an `InvocationResult`, leaving no attempt or telemetry row for the operator to attribute.

## Behavior

- Every entered binding attempt, including one that fails before returning a typed result, is represented with its binding outcome and emits one attributed `invocation_completed` row when telemetry is configured before the invocation chain settles.

## Decision ledger

- Normalize pre-result binding failures at the shared invocation boundary; rules out loop-specific synthetic telemetry that can miss other callers or double-count attempts.
- Apply each binding's existing advancement policy to the normalized failure; rules out turning observability repair into an unconditional chain stop or fallback.
- Retain the raw failure diagnostic in the existing invocation session transcript; rules out discarding evidence while removing it from the operator summary.
- Do not diagnose or change the underlying agent spawn defect; rules out an adapter-specific fix unsupported by the incident evidence.

## Acceptance criteria

- [ ] `shared/invocation/execute.test.ts` proves a binding that fails before returning an `InvocationResult` produces an ordered attempt and an `invocation_completed` row naming `agent`, `model`, `binding_id`, and a failure `exit_kind`; it fails against the pre-fix escaping-failure path.
- [ ] `shared/invocation/execute.test.ts` proves normalized failures obey the binding's existing advance predicate and every attempted rung is returned in chain order.
- [ ] `shared/invocation/execute.test.ts` proves the raw failure diagnostic remains in the invocation session transcript.
- [ ] Existing settled-result telemetry and fallback tests in `shared/invocation/execute.test.ts` stay green.
- [ ] `bun run typecheck`, `bun run test:v2`, `bun run test:integration:v2`, `bun run test:shared`, and `bun run test:integration:shared` pass.

## Documentation updates

- `v2/docs/shared-invocation.md` — pre-result failure accounting, telemetry, fallback, and session-transcript behavior.
- `v2/docs/operator-runbook.md` — § Reading telemetry: every entered binding failure leaves an attributed row, so a correctly filtered empty result means no binding was entered.
- `v2/docs/v1-behaviors.md` — record the changed v2 binding-failure telemetry behavior.
