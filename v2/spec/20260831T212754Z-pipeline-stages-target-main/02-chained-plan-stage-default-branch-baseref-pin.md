# Chained plan stage default-branch baseRef pin

## Problem

Chained plan stage resolution has no `prior.branch` `baseRef` pin in `resolvePlanStage`; preset builders already set plan write-step `baseRef` via `getBaseBranch` in `publication-workflow-steps.ts`. No production code change is expected — forward-regression pin only (green pre-fix).

## Surface

Primary: `v2/src/daemon/pipeline-stage-resolve.test.ts`. Out of scope: `resolvePlanStage` body unless a pin exposes a latent pin.

## Decisions

- Plan `baseRef` contract is preset-builder write-step output, not `resolvePlanStage` input — rules out adding `getBaseBranch` to `resolvePlanStage` for symmetry with implement.
- Regression uses real `WORKFLOW_PRESET_BUILDERS`, not fake builders — rules out asserting builder input fields plan never sets.
- Fixture `prior.branch` must differ from repository default branch — rules out a vacuous pin when both equal `main`.
- Assert only plan write-step `baseRef` fields preset builders set — rules out `landing.baseRef` when plan presets do not expose it.

## Task checklist

- Add forward-regression `chained plan stage resolves write-step baseRef to repository default branch, not prior branch` using a git fixture (`createChainedHandoffRepo` or equivalent), real `WORKFLOW_PRESET_BUILDERS`, and `prior.branch` ≠ default branch.
- Assert resolved plan write-step `baseRef` equals repository default branch, not `prior.branch`.

## Acceptance criteria

- [x] `pipeline-stage-resolve.test.ts` — `chained plan stage resolves write-step baseRef to repository default branch, not prior branch` drives chained plan stage resolution through real preset builders and asserts resolved plan write-step `baseRef` is the repository default branch, not `prior.branch`; forward-regression pin (green pre-fix; no implement-style `prior.branch` pin exists in `resolvePlanStage` today).
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- None — behavior unchanged.
