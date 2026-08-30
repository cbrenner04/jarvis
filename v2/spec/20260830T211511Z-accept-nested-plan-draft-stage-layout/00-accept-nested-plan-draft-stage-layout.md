# Accept nested plan-draft stage layout

## Problem

Plan-draft completion validates `index.md` and numbered subspecs only at `.jarvis-plan-stage/` top level, while injected spec guidance demonstrates durable `spec/<name>/index.md` layout; agents following that example write `.jarvis-plan-stage/spec/<name>/` and settle `contract_miss` with `plan.draft.shape`.

## Decision ledger

- Accept either flat `.jarvis-plan-stage/{index.md,NN-*.md}` or exactly one `.jarvis-plan-stage/spec/<name>/` spec tree, then flatten the accepted nested tree to the staging root before downstream normalization; rules out prompt-only enforcement that remains vulnerable to injected durable-layout examples.
- When top-level shape validation already passes, use the flat tree and skip nested resolution; rules out rejecting valid flat drafts because a `spec/` directory also exists.
- When top-level shape fails, resolve nested candidates only as immediate subdirectories of `.jarvis-plan-stage/spec/`; rules out deeper nesting or selecting among non-`spec/` containers.
- Reject `spec/` containers with zero or multiple candidate spec directories as `plan.draft.shape`; rules out ambiguous directory selection.
- Promote accepted nested drafts to the same flat staging and durable layout as flat drafts; rules out two on-main artifact contracts.
- Run nested resolution and flattening before `preserveStage` admission, `composePlanDraftArtifactCheck`, post-complete recovery copy, and exported `checkStagedPlanDraft`; rules out wiping or refusing valid nested trees on redraft or plan-stage recovery.
- Keep changes in `v2/src/execution/write.ts` within the plan-draft completion boundary; persistence, daemon, and CLI contracts stay unchanged; rules out cross-surface wiring in this spec.
- Mutation proof for the exactly-one guard is a `write.test.ts` regression that inverts the guard directly and asserts the ambiguous-`spec/` fixtures flip outcome; rules out production `invert*ForTest` hooks.

## Prerequisites

none

## Task checklist

- Add staging-root resolution in `write.ts`: if top-level shape passes, use the flat tree; else if `.jarvis-plan-stage/spec/` holds exactly one immediate child **directory**, treat it as the nested spec root; else if `spec/` exists with zero or multiple child directories, fail `plan.draft.shape`. Nested candidates are child directories of `.jarvis-plan-stage/spec/` only — not files, not deeper nesting, not `.jarvis-plan-stage/<name>/` without a `spec/` container.
- Flatten an accepted nested tree by moving `spec/<name>/*` into `.jarvis-plan-stage/` and removing the emptied `spec/` container before `normalizePlanDraftSpecDir` and existing module-boundary normalization.
- Wire resolution and flattening into `validatePlanDraftShape`, `composePlanDraftArtifactCheck`, `executePlanDraftWrite` (`preserveStage` and post-complete durable recovery), and `checkStagedPlanDraft`; update `preserveStage` so nested-only staging (`.jarvis-plan-stage/spec/<name>/…` with no top-level `index.md`) survives a shape `contract_miss` redraft.
- Add `write.test.ts` regression for nested acceptance with pre-fix failure, flat-layout preservation and durable landing parity, ambiguous `spec/` rejection with a co-located killing test that inverts the exactly-one nested-spec-directory guard, nested-only redraft preservation, and `checkStagedPlanDraft` recovery revalidation.

## Acceptance criteria

- [ ] `v2/src/execution/write.test.ts` test `plan-draft completion accepts nested spec/ staging and flattens before normalization` drives plan-draft completion with `.jarvis-plan-stage/spec/<name>/{index.md,00-*.md}`, asserts validation passes, the staging tree is flat before module-boundary normalization and landing continue, and fails against the pre-fix top-level-only validator.
- [ ] `v2/src/execution/write.test.ts` — `plan-draft completion normalizes the k=2 staged fixture before shape validation` stays green (flat completion and normalization path unchanged).
- [ ] `v2/src/execution/write.test.ts` test `plan-draft flat staging lands the same durable spec tree` proves flat `.jarvis-plan-stage/{index.md,00-*.md}` completion copies the expected durable `specPath` tree unchanged from pre-fix.
- [ ] `v2/src/execution/write.test.ts` test `plan-draft contract_miss rejects ambiguous nested spec/ directories` rejects nested `spec/` containers with zero or multiple candidate spec directories as `plan.draft.shape`; a co-located test inverts the exactly-one nested-spec-directory guard and asserts the ambiguous fixtures flip outcome, proving coverage; fails against the pre-fix top-level-only validator on the ambiguous fixtures.
- [ ] `v2/src/execution/write.test.ts` test `plan-draft shape contract_miss preserves nested-only staging for redraft` drives a nested-only `.jarvis-plan-stage/spec/<name>/…` tree through shape `contract_miss`, then a second write attempt, and asserts the nested tree is still present before resolution runs.
- [ ] `v2/src/execution/write.test.ts` test `checkStagedPlanDraft accepts nested spec/ staging after resolve-and-flatten` asserts operator-placed nested staging passes `checkStagedPlanDraft` after resolve-and-flatten wiring and ambiguous `spec/` fixtures still settle `plan.draft.shape`; fails against the pre-fix top-level-only `checkStagedPlanDraft`.

## Documentation updates

- Deferred to subspec 01.
