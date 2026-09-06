# Surviving-mutation resume publication-time repair

## Problem

`resumeReviewMutationFinalization` replays mutation re-verification and the ready gate immediately on `surviving_mutation_failed` when `mutationRepair` deps are omitted — the shape plain `run resume` uses. The gate deterministically re-fails on the unchanged tree and the daemon surfaces `internal_error` instead of running publication-time `write.mutation-repair` via `publishWithReadyRepair` (#3395).

## Decisions

- On `surviving_mutation_failed` admission, when the terminal record carries `survivingMutation` evidence and `deps.mutationRepair` is omitted, auto-derive repair deps from the completed write sibling's authored snapshot write step and terminal `survivingMutation` fields, then enter `publishWithReadyRepair`'s `write.mutation-repair` tail before mutation re-verification; rules out finalization-only replay that can never succeed by construction.
- Auto-derived bindings resolve implement role via `resolveInvocationBindings(resolveExecutableRole("implement"), snapshotWriteStep.agents, machine agentModelConfig, …)` — extract or mirror `buildImplementRecoverMutationRepairDeps` in `daemon-workflow-admission-handlers.ts`; rules out ad hoc per-call-site binding logic.
- Authored snapshot write step for a durable row `implement~link-N` is the base step returned by shared `findSnapshotStepForRunStepId`, not the linked run row's minted id; rules out binding repair to the linked row's step metadata.
- `stepRules` for auto-derived repair come from the write sibling's `queuedInput.stepRules` when present, else `DEFAULT_WRITE_STEP_RULES`; iteration timeout/ceiling/idle fields come from the snapshot write step or machine defaults when absent; rules out inventing repair prompt rules outside the existing write-step contract.
- When implement agents, machine `agentModelConfig`, or `stepRules` cannot be resolved, settle non-resumable with `composeRunOperatorError` `reason: "no_binding"`, `nextAction: "fix_config"`, `retryable: false`; rules out a bare `internal_error` or a retryable `surviving_mutation_failed` row that cannot repair.
- When repair exhausts `MAX_MUTATION_REPAIR_ATTEMPTS`, settle non-resumable with `composeRunOperatorError` `reason: "mutation_repair_exhausted"`, `nextAction: "inspect_spec"`, `retryable: false` (existing `settleMutationRepairExhausted` projection); rules out returning a bare `internal_error` for a retryable historical `resumable: true` record.
- `implement.recover` explicit `mutationRepair` params remain an override path; rules out breaking the existing recover admission contract.

## Tasks

- [x] In `resumeReviewMutationFinalization` / `replayMutationFinalization`, when the terminal record carries `survivingMutation` evidence and no `deps.mutationRepair` was supplied, build repair loop input from the write-sibling authored snapshot step and run publication-time `write.mutation-repair` through `publishWithReadyRepair` before mutation re-verification.
- [x] Add a `workflow-runner-resume.test.ts` regression that calls `resumeReviewMutationFinalization` without explicit `mutationRepair`, stubs the ready finalizer to throw `SurvivingMutationError` on the first pass, and asserts a `write.mutation-repair` invocation runs before the gate is re-entered (or the row settles non-resumable with `composeRunOperatorError` `reason: "mutation_repair_exhausted"` / `nextAction: "inspect_spec"`, or `reason: "no_binding"` / `nextAction: "fix_config"` when bindings are unresolvable).

## Acceptance criteria

- [x] `v2/src/execution/workflow-runner-resume.test.ts` proves `surviving_mutation_failed` resume without explicit `mutationRepair` runs publication-time `write.mutation-repair` before re-entering mutation re-verification, or settles non-resumable with `composeRunOperatorError` `reason: "mutation_repair_exhausted"` / `nextAction: "inspect_spec"` or `reason: "no_binding"` / `nextAction: "fix_config"`; it fails against the current finalization-only replay reachable on main when `mutationRepair` is omitted and the ready finalizer throws `SurvivingMutationError`.
- [x] `v2/docs/write-behavior.md` records that `surviving_mutation_failed` resume on a review-behavior row auto-derives publication-time `write.mutation-repair` when `mutationRepair` deps are omitted, or settles non-resumable with the operator actions above.
- [x] `v2/docs/v1-behaviors.md` records the same publication-time repair admission (parity catalog).
- [x] `bun run test:v2` passes.

## Documentation updates

- `v2/docs/write-behavior.md` — publication-time `write.mutation-repair` auto-derivation on `surviving_mutation_failed` resume.
- `v2/docs/v1-behaviors.md` — surviving-mutation resume publication-time repair.
