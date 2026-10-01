# Accept single immediate-child staging directory

## Problem

Plan drafters that write `.jarvis-plan-stage/<timestamp>-<name>/{index.md,00-*.md}` (matching durable spec dir naming) fail shape validation because nested discovery only accepts `…/spec/<name>/` and repo-relative `…/spec/<name>/` suffix layouts, not a single immediate child directory of the stage root.

## Decision ledger

- When top-level shape validation fails, treat exactly one immediate child **directory** of the staging root whose contents pass `validatePlanDraftShapeAtRoot` as an accepted nested spec root, flattening with the same `flattenNestedPlanDraftStaging` path as `spec/<name>/`; rules out requiring a `spec/` container for timestamp-named dirs.
- Count immediate-child candidates together with existing `discoverNestedPlanDraftLayoutRoots` results; require exactly one candidate across both sources, else `plan.draft.shape:nested-roots=<n>` from subspec 00; rules out accepting multiple immediate children or mixing two valid roots without an ambiguity failure.
- Extend `hasPreservablePlanDraftStageContent` so nested-only immediate-child staging survives `contract_miss` redraft the same way nested-only `spec/<name>/` staging does; rules out wiping valid timestamp-nested trees on shape miss.
- If subspec 01 discovery changes nested candidate counts for fixtures already pinned in subspec 00, update those `write.test.ts` expectations in subspec 01 only; rules out silent AC drift or reopening subspec 00 after 01 lands.

## Prerequisites

- Subspec 00 lands suffixed `plan.draft.shape:*` reasons and shape-family compose fallback.

## Task checklist

- Implement immediate-child discovery in `write.ts` and wire it into `resolvePlanDraftStagingRoot`, `validatePlanDraft` flattening, `checkStagedPlanDraft`, and `hasPreservablePlanDraftStageContent`.
- Add `write.test.ts` coverage: one immediate child dir (e.g. `20261001T010529Z-example/`) with `index.md` and `00-*.md` completes plan-draft write (or passes `checkStagedPlanDraft`), flattens to the staging root, and leaves the same durable layout as flat staging; pre-fix top-level-only resolution fails this fixture.
- Extend nested-only redraft preservation coverage when the tree lives under an immediate child instead of `spec/<name>/`, or add a focused preservation test if cheaper.

## Acceptance criteria

- [x] `v2/src/execution/write.test.ts` includes a test (new or extended) where the stage holds only `<stage>/<timestamp>-<name>/index.md` and `00-*.md`, plan-draft completion or `checkStagedPlanDraft` succeeds, nested bytes flatten to the staging root, and `spec/` is not required; fails against the pre-fix resolver that ignores immediate-child directories.
- [x] Same file, a stage with two immediate-child shape-valid directories settles `plan.draft.shape:nested-roots=2`, not bare `plan.draft.shape`; fails against pre-fix behavior.
- [x] Same file, a stage with one shape-valid `spec/<name>/` and one shape-valid immediate-child directory settles `plan.draft.shape:nested-roots=2`, not bare `plan.draft.shape`; fails against pre-fix behavior.
- [x] Same file, nested-only immediate-child staging survives `contract_miss` redraft like `plan-draft shape contract_miss preserves nested-only staging for redraft` (new or extended test with timestamp-named child dir); fails against pre-fix preservation that only recognizes `spec/<name>/`.
- [x] `bun run typecheck` passes.
- [x] `bun run test:v2` passes.

## Documentation updates

- None in this subspec (`v2/docs/v1-behaviors.md` is subspec 02).
