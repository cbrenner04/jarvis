# Canonical pipeline state derivation

## Problem

`derivePipelineState` owns aggregate pipeline state for observation, but `isPipelineContinuable`, fan-out branch continuable scans, and resume admission helpers walk stage rows with separate precedence rules that can disagree with derivation on the same durable snapshot.

## Surface

Primary: `v2/src/daemon/pipeline-execution.ts`. In-scope: `pipeline-execution.test.ts` derivation and continuable/resume regressions; no changes to `derivePipelineState` ordering outcomes beyond shared extraction.

## Prerequisites

- Subspec 01 landed: bypass inventory complete so derivation consolidation does not fight unpinned parallel walks.

## Decision ledger

- One exported derivation (`derivePipelineState` and its fan-out helpers) is the sole source of aggregate `PipelineDerivedState`; `isPipelineContinuable`, unscoped `resumePipeline` admission, and `recoverContinuablePipelines` eligibility read that derivation instead of re-walking prefix/suffix precedence independently; rules out parallel precedence walks that can return different aggregate states on the same rows.
- In-flight aggregate callers bounded to `isPipelineContinuable`, unscoped `resumePipeline`, and `recoverContinuablePipelines`; excluded pinned exceptions are `resolveBranchResumeAdmission` and branch-scoped `resumePipeline`; rules out unnamed parallel walks surviving consolidation.
- Fan-out continuable detection composes `derivePipelineState` with narrow lane predicates (`approvalOutcomePermitsActivation`, `reopenedFailurePermitsActivation`, `isPipelineSettlementPending`) rather than a second suffix aggregation; rules out preserving `fanOutBranchHasContinuableWork` as a parallel aggregate state machine.
- Branch-scoped `resumePipeline` keeps `resolveBranchResumeAdmission` (pinned in subspec 01); rules out folding branch-scoped admission into aggregate derivation.
- Linear and fan-out ordering outcomes stay pinned by existing tests; rules out using consolidation to change `rejected`-before-`failed`, settlement-first running, or position-order walks.

## Task checklist

- Extract any shared suffix/prefix aggregation `derivePipelineState` already uses into helpers callable from `isPipelineContinuable` without duplicating precedence.
- Rewire `isPipelineContinuable` fan-out and default-branch tails to consult `derivePipelineState` for aggregate running/pending/awaiting-approval/failed/rejected/interrupted signals before applying continuable-only guards.
- Rewire unscoped `resumePipeline` and `recoverContinuablePipelines` eligibility checks to use the same derivation entry point (no second stage-row walk for aggregate state).
- Add `pipeline-execution.test.ts` regression `isPipelineContinuable agrees with derivePipelineState on fan-out continuable fixtures` using a fan-out fixture where pre-fix `fanOutBranchHasContinuableWork` returns true while `derivePipelineState` reads `failed` because `branchSuffixPredecessorsSatisfied` blocks actionable pending (pattern: settled failed branch plus sibling `pending` suffix row not reachable under derivation's `scanFirstActionableFanOutSuffixStage` skip); fails against the pre-fix separate walk and passes after consolidation.
- Run `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2`.

## Acceptance criteria

- [ ] `v2/src/daemon/pipeline-execution.test.ts` test `isPipelineContinuable agrees with derivePipelineState on fan-out continuable fixtures` uses a fan-out fixture constructible on pre-fix code where `fanOutBranchHasContinuableWork` admits continuation while `derivePipelineState` reads `failed` (via the `branchSuffixPredecessorsSatisfied` gap in `fanOutBranchHasContinuableWork` vs `scanFirstActionableFanOutSuffixStage`); fails against the pre-fix separate walk and passes after consolidation.
- [ ] `v2/src/daemon/pipeline-execution.test.ts` test `reports running when any workflow stage row reads running` stays green.
- [ ] `v2/src/daemon/pipeline-execution.test.ts` describe `derivePipelineState fan-out suffix settlement-first` stays green with no assertion dropped.
- [ ] `v2/src/daemon/pipeline-execution.test.ts` describe `pipeline activation after restart` stays green (recoverContinuablePipelines and related resume eligibility unchanged at the margin).
- [ ] `v2/docs/v1-behaviors.md` records canonical aggregate derivation and durable cross-process stage exclusion for dispatch, adoption, and recovery.
- [ ] `v2/docs/daemon-host.md` records canonical aggregate derivation as the single source for in-flight aggregate decisions (`isPipelineContinuable`, unscoped `resumePipeline`, `recoverContinuablePipelines`), with branch-scoped resume as the pinned exception.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:v2` passes.
- [ ] `bun run test:integration:v2` passes.

## Documentation updates

- `v2/docs/v1-behaviors.md` — canonical state derivation as the single aggregate source; durable `pipeline_stage_admission` cross-process exclusion.
- `v2/docs/daemon-host.md` — canonical aggregate derivation for in-flight callers; cross-ref branch-scoped resume exception.
