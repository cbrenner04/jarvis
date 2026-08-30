# Pipeline stage resolution through shared preparation

Authoritative for pipeline stage resolution through shared preparation: acceptance criteria, documentation updates, and material decisions in this file supersede `intent.md` where they differ.

## Problem

`pipeline-stage-resolve.ts` still assembles workflow steps outside `prepareWorkflowStart`: direct `WORKFLOW_PRESET_BUILDERS` calls, local plan/implement builder shims, `FIXED_REVIEW_PASSES = 1`, and unstamped steps that `pipeline-execution.ts` stamps again at dispatch. Implement stages pass hardcoded review passes into builder input instead of `resolveImplementReviewConfig`, overriding configured project policy.

## Decision ledger

- Route `resolveStageWorkflowSteps` through `prepareWorkflowStart` via a pipeline adapter that maps stage posture, artifacts, and persisted `PipelineContext` into `WorkflowStartPreparationRequest`; rules out retaining daemon-local `invokePlanPresetBuilder`, `invokeImplementPresetBuilder`, and per-workflow resolve helpers as a second production assembly path.
- Return stamped steps from shared preparation and stop re-stamping them in dispatch for stages resolved in this slice; rules out `stampPipelineDispatchSteps` on bytes already stamped by `prepareWorkflowStart`.
- Omit hardcoded `reviewPasses` on implement builder input so `resolveImplementReviewConfig` owns pass count and behavior from project config and posture; rules out `FIXED_REVIEW_PASSES` or daemon-local review overrides.
- Apply shared preparation for each fan-out branch resolution, not only single-stage resolution; rules out fan-out dispatch retaining raw preset-builder output without preparation.
- Deferred to first consumer: pipeline stale-reset flag normalization into `WorkflowStartPreparationRequest.staleReset` — pin when dispatch wires the shared stale-reset gate in `01-pipeline-dispatch-stale-reset-through-shared-preparation.md`.

## Tasks

- Add a pipeline preparation adapter (daemon-owned) that builds `WorkflowStartPreparationRequest` from workflow stage, artifacts, and `PipelineContext`, using `context.configPath` for stamping and canonical implement review resolution.
- Replace direct preset-builder assembly in `resolveStageWorkflowSteps` and fan-out resolution with `prepareWorkflowStart`; delete `FIXED_REVIEW_PASSES` and unused local builder shims once unreachable.
- Return prepared stamped steps from resolution; remove duplicate `stampPipelineDispatchSteps` calls on those steps in `advanceWorkflowStage` and `runFanOutBranchAction`.
- Add or extend regressions for configured implement review passes and behavior; keep fan-out artifact binding tests green.

## Acceptance criteria

- [x] `v2/src/daemon/pipeline-stage-resolve.test.ts` test `pipeline implement resolution uses configured review passes and review behavior on the review step` configures project `implement.reviewPasses` above one and a non-default `implement.reviewBehavior`, resolves an implement stage, and asserts the built review step carries both configured values; it fails against `FIXED_REVIEW_PASSES = 1` reachable in `pipeline-stage-resolve.ts`.
- [x] `v2/src/daemon/pipeline-stage-resolve.test.ts` — `fan-out implement resolution binds active branchKey plan artifact when siblings populate out of order` stays green.
- [x] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- None in this slice; durable docs land in `02-preparation-parity-structural-authority-and-docs.md`.
