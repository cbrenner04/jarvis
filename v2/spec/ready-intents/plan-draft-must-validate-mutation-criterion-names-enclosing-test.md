---
name: plan-draft-must-validate-mutation-criterion-names-enclosing-test
---

# Plan-draft rejects mutation-checkpoint criteria that omit a resolvable enclosing test title

Splitting does not apply: enclosing-test resolution, plan-draft completion validation, and regression pins share the execution-loop mutation-checkpoint verifier and `validatePlanDraft` seam.

`linkDirectivesToCriterion` links a `// @mutate` directive only when the criterion text contains the directive's enclosing `test()`/`it()` title. Authoring guidance (#2655) and plan-review advisory hollow-pin (#2660) do not block plan-draft, so criteria omitting the pin title land and go hollow at implement time even when the directive and pinning resolution are correct.

## Decisions

- Plan-draft MUST hard-reject (not advisory) staged subspecs whose ticked/authored `Mutation checkpoint:`, `Keystone checkpoint:`, or directive-shaped `@mutate` criterion does not name an enclosing `test()`/`it()` title resolvable in the referenced pinning file — rules out advisory-only hollow-pin (#2660) or implement-time-only detection.
- Rejection names the offending criterion and the missing or unresolvable test title — rules out a generic hollow-risk warning the author can ignore.
- Validation runs in v2 `validatePlanDraft` / `composePlanDraftArtifactCheck` on the staged spec tree before plan-draft completion — rules out plan-review-only hard enforcement; plan debate hollow-pin stays advisory.
- `validatePlanDraft` and `composePlanDraftArtifactCheck` take `worktreeRoot` alongside `specDir`; `executePlanDraftWrite` passes its in-scope `worktreePath` — rules out pinning checks against spec-dir alone or a caller-side parallel validator.
- Scan `## Acceptance criteria` `Mutation checkpoint:` / `Keystone checkpoint:` / directive-shaped `@mutate` criteria in staged `NN-*.md` subspecs; skip human-only; exclude `index.md` and `intent.md` — rules out index routing noise.
- Enclosing-test check aligns with implement-time linking: when the pinning file resolves to an on-disk file, criterion text must contain a pin title that exists in that file (`includes(pinTitle)`, case-sensitive) — rules out the weaker backtick/quote heuristic alone (#2660) and deferring to implement for titles absent from a resolved pinning file (#2697 scope is existing titles omitted from criterion text, not greenfield test authoring).
- Pinning-file resolution reuses verifier pin-path rules (path-qualified vs basename, extension tolerance from `mutation-checkpoint-pin-resolution`) — rules out divergent plan-draft vs implement resolution.
- Pinning-file resolution failure (`unresolved_pinning_test`, ambiguous basename, missing file) skips the plan-draft enclosing-test check — rules out plan-draft duplicating implement-time pinning refusal or blocking specs whose pinning files do not exist yet.
- Implement-time verifier and hollow messaging unchanged — rules out re-tuning `contract_miss` at implement in this slice.
- v1 `validateDraftOutput` out of scope — rules out v1 parity here (cf. unsatisfiable-AC v2 deferral).
- Out of scope: multiline-title resolution and extension-tolerance algorithm changes (shipped #2696).

## Acceptance criteria

- [ ] A staged plan draft whose mutation-checkpoint or keystone criterion names no enclosing test (or names a title absent from the resolved on-disk pinning file) settles `contract_miss` with `failureReason` naming the criterion and the missing or unresolvable title; a regression in `write.test.ts` fails against advisory-only behavior.
- [ ] A staged plan draft whose mutation-checkpoint criteria all name resolvable enclosing tests in their pinning files passes plan-draft validation with no finding; a regression in `write.test.ts` fails against the pre-fix code.
- [ ] A staged plan draft whose mutation-checkpoint criterion references an unresolvable pinning file (missing on disk) passes plan-draft enclosing-test validation with no finding; a regression in `write.test.ts` fails if plan-draft hard-rejects unresolved pinning.
- [ ] Mutation checkpoint: a `// @mutate` directive inside the named pinning test disabling the criterion-names-enclosing-test check turns the `write.test.ts` enclosing-test rejection regression RED.
- [ ] `v1/docs/spec-guidance.md` § Mutation-checkpoint criteria states enclosing-test names are enforced at plan-draft, not guidance-only.
- [ ] `v2/docs/operator-runbook.md` § Gate trust documents plan-draft rejection when a mutation-checkpoint or keystone criterion names no resolvable enclosing test in a resolved pinning file.
- [ ] `v2/docs/v1-behaviors.md` records plan-draft hard rejection of mutation-checkpoint / keystone criteria missing a resolvable enclosing pin title.
- [ ] `v2/docs/write-behavior.md` § Draft output shape contract documents enclosing-test `contract_miss` / `failureReason` propagation alongside existing normalizer rejection diagnostics.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v1/docs/spec-guidance.md` § Mutation-checkpoint criteria — criterion MUST name its enclosing test (enforced at plan-draft, not guidance-only).
- `v2/docs/operator-runbook.md` § Gate trust — plan-draft rejects a mutation-checkpoint or keystone criterion that names no resolvable enclosing test in a resolved pinning file; implement-time hollow is caught at plan time.
- `v2/docs/v1-behaviors.md` — plan-draft hard-rejects mutation-checkpoint / keystone criteria missing a resolvable enclosing pin title.
- `v2/docs/write-behavior.md` § Draft output shape contract — enclosing-test rejection `contract_miss` / `failureReason` propagation.

## Prerequisites

- `linkDirectivesToCriterion` links a `// @mutate` directive to a criterion only when the criterion text contains the directive's pin title (case-sensitive `includes`, no all-directives-in-file fallback).
- Pinning-test resolution tolerates multiline `test.each` continuation titles and basename extension mismatch among `.ts`/`.tsx`/`.js`/`.jsx` (`mutation-checkpoint-pin-resolution`).
- Mutation-checkpoint criteria authoring guidance requires the enclosing `test()` title in the criterion (`mutation-checkpoint-criterion-enclosing-test-docs`).
- Plan-draft `validatePlanDraft` propagates structured rejection reasons through `composePlanDraftArtifactCheck` (`propagate-plan-draft-normalizer-reason`).
