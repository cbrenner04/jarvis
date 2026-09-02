# Accept repo-relative plan-draft stage layout

## Problem

`resolvePlanDraftStagingRoot` probes only `join(stagingDir, "spec")`, so agents staging at `.jarvis-plan-stage/v2/spec/<name>/` (the repo-relative path their guidance names when `plan.targetDir` is `v2/spec`) settle `contract_miss` with `plan.draft.shape` despite a sound draft. #3212 fixed the sibling `spec/<name>/` layout; this subspec closes the repo-relative prefix gap.

## Decision ledger

- Accept staged layout as flat at the staging root; exactly one immediate child directory under `.jarvis-plan-stage/spec/` (#3212); or exactly one repo-relative path under the staging root whose terminal directory passes `validatePlanDraftShapeAtRoot` and whose path segments end in a spec-directory suffix (`spec/<name>/`, `v2/spec/<name>/`, `custom/spec/<name>/`, and other multi-segment forms discoverable from staged bytes alone); rules out `.jarvis-plan-stage/foo/<name>/` and `spec/<container>/<name>/` deeper-than-`spec/<name>/` nesting.
- When top-level shape validation already passes, use the flat tree and skip nested resolution; rules out rejecting valid flat drafts because a repo-relative container also exists.
- Discover nested candidates only in accepted layouts above; require exactly one candidate across all accepted layouts, else `plan.draft.shape`; rules out silently picking one of several nested trees and rules out unconstrained recursive scan of arbitrary directories that pass `validatePlanDraftShapeAtRoot`.
- Flatten accepted repo-relative nested trees to the staging root before downstream normalization, promoting the accepted spec directory's contents and removing emptied prefix containers; rules out leaving repo-relative containers on disk through validation.
- `resolvePlanDraftStagingRoot`, `checkStagedPlanDraft`, recovery revalidation, `preserveStage`, and completion share one targetDir-free byte-discovery resolver; rules out threading `specPath`/`targetDir` through workflow-runner for this shape fix.
- `preserveStage` admits when top-level `index.md` exists or when the byte-discovery resolver would find exactly one accepted nested candidate (including repo-relative-only trees); rules out `listNestedPlanDraftSpecDirs(spec/).length === 1` as the sole nested-only admission predicate (#3212 resolver/predicate parity).
- Do not fix this with a reprompt arm; rules out `plan-draft-contract-miss-reprompts-before-blocking` for a draft already shape-correct at the wrong prefix.
- Keep refusal for genuinely shapeless drafts (no `index.md`, zero `NN-*.md` subspecs) unchanged; rules out relaxing structural validation to accept partial trees.
- Mutation proof for the exactly-one guard uses a `write.test.ts` regression with co-located `@mutate` inverting the exactly-one guard on ambiguous cross-prefix fixtures; rules out rejection-only AC that passes without proving the guard fires.

## Prerequisites

- Plan-draft staging accepts a flat tree at the staging root or exactly one nested `spec/<name>/` tree, flattening accepted nested input to the staging root before downstream normalization (#3212).

## Task checklist

- Extend staging-root resolution in `write.ts`: when top-level shape passes, use the flat tree; else discover candidates only in accepted layouts — exactly one immediate child directory under `.jarvis-plan-stage/spec/`; or exactly one repo-relative path under the staging root whose terminal directory passes `validatePlanDraftShapeAtRoot` and whose segments end in a spec-directory suffix (e.g. `spec/<name>/`, `v2/spec/<name>/`, `custom/spec/<name>/`); reject zero or multiple candidates and reject deeper-than-`spec/<name>/` paths such as `spec/<container>/<name>/`; accept only when exactly one candidate exists.
- Generalize flattening so an accepted repo-relative nested root promotes its files to `.jarvis-plan-stage/` and removes emptied prefix containers before `normalizePlanDraftSpecDir`.
- Wire the extended resolver and flatten into `validatePlanDraftShape`, `composePlanDraftArtifactCheck`, `executePlanDraftWrite` (`preserveStage` and post-complete durable recovery), and exported `checkStagedPlanDraft`; align `preserveStage` with the shared byte-discovery resolver (top-level `index.md` or exactly one accepted nested candidate).
- Add `write.test.ts` regressions for repo-relative and `custom/spec/` byte-discovered acceptance, repo-relative-only redraft preservation, `checkStagedPlanDraft` recovery revalidation, ambiguous cross-prefix rejection with `@mutate`, `spec/<container>/<name>/` depth refusal, and #3212 preservation.

## Acceptance criteria

- [ ] `v2/src/execution/write.test.ts` test `plan-draft completion accepts repo-relative targetDir staging and flattens before normalization` drives plan-draft completion with `.jarvis-plan-stage/v2/spec/<name>/{index.md,00-*.md}`, asserts validation passes, the staging tree is flat before module-boundary normalization and landing continue, and fails against the pre-fix `spec/`-only probe.
- [ ] `v2/src/execution/write.test.ts` test `plan-draft completion accepts custom/spec/ byte-discovered staging and flattens before normalization` drives plan-draft completion with `.jarvis-plan-stage/custom/spec/<name>/{index.md,00-*.md}`, asserts validation passes and the staging tree is flat before module-boundary normalization and landing continue, and fails against the pre-fix `spec/`-only probe.
- [ ] `v2/src/execution/write.test.ts` test `plan-draft shape contract_miss preserves repo-relative-only staging for redraft` drives a repo-relative-only `.jarvis-plan-stage/v2/spec/<name>/…` tree through shape `contract_miss`, then a second write attempt, and asserts the repo-relative tree is still present before resolution runs; fails against the pre-fix `preserveStage` predicate that only counts `spec/` children.
- [ ] `v2/src/execution/write.test.ts` test `checkStagedPlanDraft accepts repo-relative targetDir staging after resolve-and-flatten` asserts operator-placed repo-relative staging passes `checkStagedPlanDraft` after resolve-and-flatten wiring; fails against the pre-fix `spec/`-only probe.
- [ ] `v2/src/execution/write.test.ts` test `plan-draft contract_miss rejects ambiguous nested spec directories across prefixes` refuses two nested candidate spec directories under different accepted prefixes as `plan.draft.shape`; co-located `@mutate` inverts the exactly-one guard and asserts the ambiguous fixtures flip outcome; fails against the pre-fix code that only counts `spec/` children.
- [ ] `v2/src/execution/write.test.ts` test `plan-draft contract_miss rejects spec/container/name depth nesting` refuses `.jarvis-plan-stage/spec/<container>/<name>/` with a single shape-valid leaf as `plan.draft.shape`, reachable on the #3212 base; fails against an unconstrained recursive shape scan that would accept the leaf.
- [ ] `v2/src/execution/write.test.ts` test `plan-draft completion accepts nested spec/ staging and flattens before normalization` stays green (no regression of #3212).
- [ ] `v2/src/execution/write.test.ts` test `plan-draft shape contract_miss preserves nested-only staging for redraft` stays green (no regression of #3212).
- [ ] `v2/src/execution/write.test.ts` test `checkStagedPlanDraft accepts nested spec/ staging after resolve-and-flatten` stays green (no regression of #3212).
- [ ] `v2/src/execution/write.test.ts` test `plan-draft contract_miss on stage without index.md settles plan.draft.shape` stays green (shapeless-tree refusal unchanged).

## Documentation updates

- Deferred to subspec 01.
