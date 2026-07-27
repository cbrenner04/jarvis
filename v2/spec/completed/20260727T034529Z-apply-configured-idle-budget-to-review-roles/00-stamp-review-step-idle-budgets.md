# Stamp review-step idle budgets

## Problem

Write-bound resolution collapses disabled and absent idle-budget state, while review steps must retain that distinction for their invocation fallback.

## Decisions

- A configured positive or zero `idleOutputTimeoutMs` stamps `idleOutputMs` on `review` and `review-debate` workflow payloads.
- An absent key leaves review-step `idleOutputMs` unstamped; it does not stamp a 90 s default.
- Write-step bound resolution, including its omitted disabled `idleOutputMs`, remains unchanged.

## Task checklist

- [ ] Preserve configured-versus-absent idle-budget state while building workflow steps.
- [ ] Stamp positive and zero values on both review behaviors without changing write bounds.
- [ ] Add payload-construction regression coverage.

## Acceptance criteria

- [x] `v2/src/commands/workflow.test.ts` test `applies the configured idle budget to review and review-debate steps` proves a configured positive value is stamped exactly as `idleOutputMs` on both review payloads and fails against the pre-fix wiring.
- [x] `v2/src/commands/workflow.test.ts` proves an absent key leaves `idleOutputMs` unstamped on both review payloads, while `idleOutputTimeoutMs: 0` stamps zero on both.
- [x] The review-payload tests fail if the review-step wiring is removed, limited to one behavior, widened to absent configuration, or changed to drop zero.
- [x] `v2/src/config/machine-config-loader.test.ts` tests `allows idleOutputTimeoutMs at or below iterationTimeoutMs` and `omits idleOutputMs when idleOutputTimeoutMs is 0 (disabled)` stay green.

## Documentation updates

- None; semantic documentation is isolated in `02-document-review-idle-budget-semantics.md`.
