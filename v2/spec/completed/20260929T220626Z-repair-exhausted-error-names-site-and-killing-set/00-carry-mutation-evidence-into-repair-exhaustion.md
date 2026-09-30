# Carry mutation evidence into repair exhaustion

## Problem

`mutation_repair_exhausted` is terminal, but its `loop_finished` record and composed operator error discard the last surviving mutation's source site and resolved killing set. The operator sees the recovery guidance without the evidence needed to inspect that survivor.

## Decision ledger

- Persist and project the latest available `SurvivingMutationError` through every `mutation_repair_exhausted` exit, updated after each repair attempt, including budget exhaustion and a later blocked or unsettled exit; rules out reporting attempt-1's survivor after a later attempt already found a different one.
- Reuse the existing `survivingMutation*` evidence fields — mutation, source file/line, killing tests, killing-set result — while retaining `reason: "mutation_repair_exhausted"`, `retryable: false`, `nextAction: "inspect_spec"`, and current recovery copy; rules out a second exhausted-only evidence schema or changed recovery semantics.
- Leave legacy `mutation_repair_exhausted` records with no persisted survivor fields unaugmented; rules out fabricating a mutation site or killing set that was never recorded.
- When the current survivor's killing-set result is `unknown` — reconstructed from a legacy `surviving_mutation_failed` record whose evidence fields predate this contract — omit its killing-set fields from the composed error while keeping its mutation and site; rules out presenting an unobserved legacy result as a resolved test.
- Canonical home for the evidence-field contract is `v2/docs/daemon-host.md`, alongside its existing `surviving_mutation_failed` projection; `v2/docs/operator-runbook.md` cross-links rather than restating it; rules out drift between two written copies of the same field contract.

## Task checklist

- Thread the latest available survivor into every `mutation_repair_exhausted` exit (budget exhaustion, blocked, and unsettled), updating it after each repair attempt, and record its mutation, source file and line, resolved killing tests, and observed killing-set result on `loop_finished`.
- Project persisted survivor evidence from `mutation_repair_exhausted` through `composeRunOperatorError` without changing its terminal recovery classification; omit killing-set fields when the resolved result is `unknown`.
- Cover budget exhaustion, a later blocked or unsettled repair after the survivor changes, a non-empty `passed-confirmed` killing set end to end, legacy `surviving_mutation_failed` unknown-result omission, direct operator-error composition, and legacy `mutation_repair_exhausted` records with no survivor fields.
- Document the evidence contract canonically in `v2/docs/daemon-host.md`, cross-link it from `v2/docs/operator-runbook.md`, and maintain the v1 parity catalog.

## Acceptance criteria

- [x] `v2/src/execution/workflow-runner-resume-review-dispatch.test.ts` proves each `mutation_repair_exhausted` exit — budget exhaustion, blocked, and unsettled — records the latest available survivor's mutation, source file and line, resolved killing tests, and observed killing-set result on terminal `loop_finished`, including a case where a later repair attempt's survivor differs from attempt 1's; it fails against the pre-fix evidence-dropping settlement reachable on main.
- [x] `v2/src/execution/workflow-runner-resume-review-dispatch.test.ts` proves a budget-exhaustion case with a non-empty resolved killing set and a `passed-confirmed` observed result projects that killing set and result unchanged on `loop_finished`, not `[]` or `not-run`; it fails against the pre-fix evidence-dropping settlement reachable on main.
- [x] `v2/src/daemon/run-operator-error.test.ts` proves `composeRunOperatorError` returns the persisted mutation, source file/line, non-empty resolved killing set, and `passed-confirmed` result for `mutation_repair_exhausted` while preserving its non-retryable `inspect_spec` classification and existing recovery guidance; it fails against the pre-fix mapper reachable on main.
- [x] `v2/src/daemon/run-operator-error.test.ts` proves that when the current survivor's killing-set result is `unknown` — reconstructed from a legacy `surviving_mutation_failed` record — the composed operator error keeps the mutation and site but omits the killing-set fields rather than presenting them as observed.
- [x] `v2/src/daemon/run-operator-error.test.ts` proves a legacy `mutation_repair_exhausted` record with no persisted survivor fields still composes without invented evidence.
- [x] `bun run typecheck` passes.
- [x] `bun run test:v2` passes.
- [x] `bun run test:integration:v2` passes.

## Documentation updates

- Update `v2/docs/daemon-host.md` (the canonical home for the operator-error evidence-field contract, alongside its existing `surviving_mutation_failed` projection) to state that `mutation_repair_exhausted` reports the last available mutation, source file/line, resolved killing set, and observed result alongside unchanged manual-recovery guidance, and that an `unknown` legacy killing-set result is omitted rather than shown.
- Cross-link `v2/docs/operator-runbook.md`'s `mutation_repair_exhausted` troubleshooting entry to that `daemon-host.md` contract instead of restating it.
- Update `v2/docs/v1-behaviors.md` to record the changed v2 terminal-error evidence contract and its lack of a v1 counterpart.
