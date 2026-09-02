---
name: plan-draft-shape-accepts-repo-relative-stage-layout
---

# Plan drafts accept repo-relative spec-directory staging layout

Unsplit rationale: Staging-root resolution, flattening, shape validation, preserve-stage predicates, and regression coverage stay within the execution-loop plan-draft completion boundary in `write.ts`; persistence, daemon, and CLI contracts do not change.

## Primary implementation surface

- Execution-loop plan-draft validation and normalization in `v2/src/execution/write.ts`

## Prerequisites

- Plan-draft staging accepts a flat tree at the staging root or exactly one nested `spec/<name>/` tree, flattening accepted nested input to the staging root before downstream normalization.

## Problem

`resolvePlanDraftStagingRoot` probes only `join(stagingDir, "spec")`, so agents that stage at the repo-relative path their guidance names — e.g. `.jarvis-plan-stage/v2/spec/<name>/` when `plan.targetDir` is `v2/spec` — settle `contract_miss` with `plan.draft.shape` despite a sound draft. #3212 fixed the sibling `spec/<name>/` layout; this seed closes the repo-relative prefix gap.

## Decisions

- Accept a staged tree nested under any single repo-relative prefix that ends in the project's spec directory (`v2/spec/<name>/`, `spec/<name>/`, and the configured `targetDir` form); rules out enumerating one hardcoded prefix per project layout.
- Resolution stays unambiguous: exactly one discoverable candidate spec directory across all accepted prefixes, else `plan.draft.shape`; rules out silently picking one of several nested trees.
- Flatten accepted repo-relative nested trees to the staging root before downstream normalization, reusing the #3212 flatten contract; rules out leaving repo-relative containers on disk through validation.
- `checkStagedPlanDraft` and recovery revalidation use the same targetDir-free staging-root resolver as completion — discover accepted prefix paths from bytes under `stagingDir` only; completion may also consult `getTargetDir(specPath)` but recovery call sites do not thread `specPath`/`targetDir`; rules out a workflow-runner signature change for this shape fix.
- Extend `preserveStage` and recovery revalidation to recognize the same repo-relative nested layouts; rules out wiping sound repo-relative drafts on shape `contract_miss` redraft.
- Do not fix this with a reprompt arm; rules out `plan-draft-contract-miss-reprompts-before-blocking` for a draft that is already shape-correct at the wrong prefix.
- Keep refusal for genuinely shapeless drafts (no `index.md`, zero `NN-*.md` subspecs) unchanged; rules out relaxing structural validation to accept partial trees.

## Acceptance criteria

- [ ] `v2/src/execution/write.test.ts` test `plan-draft completion accepts repo-relative targetDir staging and flattens before normalization` drives plan-draft completion with `.jarvis-plan-stage/v2/spec/<name>/{index.md,00-*.md}`, proves validation passes and the staging tree is flat before module-boundary normalization and landing continue, and fails against the pre-fix `spec/`-only probe.
- [ ] `v2/src/execution/write.test.ts` test `plan-draft shape contract_miss preserves repo-relative-only staging for redraft` proves a shape `contract_miss` on repo-relative-only staging (no top-level `index.md`) leaves `.jarvis-plan-stage/v2/spec/<name>/` intact for the next agent pass; fails against the pre-fix `preserveStage` predicate that only counts `spec/` children.
- [ ] `v2/src/execution/write.test.ts` test `checkStagedPlanDraft accepts repo-relative targetDir staging after resolve-and-flatten` proves recovery revalidation resolves `.jarvis-plan-stage/v2/spec/<name>/`, flattens to the staging root, and passes; fails against the pre-fix `spec/`-only probe.
- [ ] `v2/src/execution/write.test.ts` test `plan-draft completion accepts nested spec/ staging and flattens before normalization`, `plan-draft shape contract_miss preserves nested-only staging for redraft`, and `checkStagedPlanDraft accepts nested spec/ staging after resolve-and-flatten` stay green (no regression of #3212).
- [ ] `v2/src/execution/write.test.ts` test `plan-draft contract_miss rejects ambiguous nested spec directories across prefixes` refuses two nested candidate spec directories under different accepted prefixes with `plan.draft.shape`; fails against the pre-fix code that only counts `spec/` children.
- [ ] `v2/src/execution/write.test.ts` test `plan-draft contract_miss on stage without index.md settles plan.draft.shape` stays green (shapeless-tree refusal unchanged).
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — extend the draft output shape contract for repo-relative `targetDir` nested trees and flatten-before-normalize behavior (#3212 authoritative home).
- `v2/docs/v1-behaviors.md` — record plan-draft staging acceptance beyond flat-or-`spec/<name>/` to repo-relative prefixes ending in the spec directory.
- `v2/docs/workflow-runner.md` — cross-link to `write-behavior.md` for recovery revalidation of accepted staging layouts (no new recovery workflow semantics).
