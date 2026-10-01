# Write-behavior plan-draft output shape

## Problem

`v2/docs/write-behavior.md` **Draft output shape contract** and **One-shot normalizer-miss repair** still describe bare `plan.draft.shape` for nested-discovery failures and omit exactly one immediate child directory of `.jarvis-plan-stage/` (timestamp-named wrapper) among accepted layouts, while `v2/src/execution/write.ts` emits suffixed reasons and merges immediate-child discovery with `spec/<name>/` and repo-relative candidates.

## Decision ledger

- Treat `write-behavior.md` as the durable contract home for accepted staging layouts and shape `failureReason` strings; `operator-runbook.md` and `v1-behaviors.md` summarize operator actions only; rules out duplicating the full candidate-count rules in the runbook.
- Document accepted layouts as: flat stage root; exactly one shape-valid immediate child directory at the stage root; exactly one `.../spec/<name>/` tree; exactly one repo-relative prefix ending in `spec/<name>/`; rules out prose that limits nested acceptance to `spec/<name>/` and repo-relative paths only.
- Document settlement reasons as the suffixed family (`plan.draft.shape:missing-dir`, `:no-index`, `:no-subspecs`, `:nested-roots=<n>`) with `<n>` the combined candidate count from byte-discovery; rules out stating that zero or multiple candidates fail bare `plan.draft.shape` without a suffix.
- Align **One-shot normalizer-miss repair** with `isEligibleDraftContractReprompt` / `draftContractRepromptDetail`: repairable shape suffixes (`:no-index`, `:no-subspecs`, `:nested-roots=<n>`) share one `draft_contract_reprompt` whose detail is the flat-layout instruction while `contract_miss_detail.failureReason` keeps the suffixed string; bare `plan.draft.shape`, `:missing-dir`, normalizer text, and `plan.draft.blocker` follow the existing eligibility split; rules out describing only normalizer misses as reprompt-eligible.
- Update **Harness blocker clearing** / stage-preservation bullets in the same file to include exactly one immediate-child directory alongside flat `index.md` and byte-discovery nested candidates; rules out `spec/<name>/`-only preservation wording copied from pre–nested-child docs.

## Prerequisites

- Subspec 00 is optional for editing order; implementation may land 01 before 00. Code prerequisites match intent (shape suffixes and immediate-child resolution in `write.ts`).

## Task checklist

- Rewrite **Draft output shape contract** to match `resolvePlanDraftStagingRoot`, `discoverPlanDraftNestedLayoutRoots`, and `validatePlanDraftShapeAtRoot` behavior (including flatten-on-success).
- Rewrite **One-shot normalizer-miss repair** eligibility and `draft_contract_reprompt.detail` behavior for repairable shape suffixes.
- Touch only `write-behavior.md` sections that still cite bare `plan.draft.shape` or omit immediate-child acceptance.

## Acceptance criteria

- [x] `v2/docs/write-behavior.md` **Draft output shape contract** lists flat staging, exactly one immediate child directory, `spec/<name>/`, and repo-relative nested layouts, and documents suffixed `plan.draft.shape:*` failure reasons instead of bare `plan.draft.shape` for structural misses.
- [x] Same file **One-shot normalizer-miss repair** documents repairable `plan.draft.shape:no-index`, `:no-subspecs`, and `:nested-roots=<n>` versus ineligible bare `plan.draft.shape` and `:missing-dir`.
- [x] Same file stage-preservation prose for plan-draft matches `hasPreservablePlanDraftStageContent` in `v2/src/execution/write.ts`: flat `index.md` at the stage root, exactly one nested byte-discovery candidate, or exactly one immediate child directory under the stage root (that branch does not require shape validity).

## Documentation updates

- `v2/docs/write-behavior.md` — plan-draft staging layout matrix, suffixed shape reasons, and draft-contract reprompt eligibility.
