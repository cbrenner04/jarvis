---
name: plan-draft-must-validate-mutation-criterion-names-enclosing-test
---

# Plan-draft rejects mutation-checkpoint criteria that omit a resolvable enclosing test title

Splitting does not apply: enclosing-test resolution, plan-draft completion validation, and regression pins share the execution-loop mutation-checkpoint verifier and `validatePlanDraft` seam.

`linkDirectivesToCriterion` links a `// @mutate` directive only when the criterion text contains the directive's enclosing `test()`/`it()` title. Authoring guidance (#2655) and plan-review advisory hollow-pin (#2660) do not block plan-draft, so criteria omitting the pin title land and go hollow at implement time even when the directive and pinning resolution are correct.

## Decisions

- Plan-draft MUST hard-reject (not advisory) staged subspecs whose ticked/authored `Mutation checkpoint:` or directive-shaped `@mutate` criterion does not name an enclosing `test()`/`it()` title resolvable in the referenced pinning file — rules out advisory-only hollow-pin (#2660) or implement-time-only detection.
- Rejection names the offending criterion and the missing or unresolvable test title — rules out a generic hollow-risk warning the author can ignore.
- Validation runs in v2 `validatePlanDraft` / `composePlanDraftArtifactCheck` on the staged spec tree before plan-draft completion — rules out plan-review-only hard enforcement; plan debate hollow-pin stays advisory.
- Scan `## Acceptance criteria` mutation-checkpoint criteria in staged `NN-*.md` subspecs; skip human-only; exclude `index.md` and `intent.md` — rules out index routing noise.
- Enclosing-test check aligns with implement-time linking: criterion text must contain a pin title that exists in the resolved pinning file (`includes(pinTitle)`, case-sensitive) — rules out the weaker backtick/quote heuristic alone (#2660).
- Pinning-file resolution reuses verifier pin-path rules (path-qualified vs basename, extension tolerance from `mutation-checkpoint-pin-resolution`) — rules out divergent plan-draft vs implement resolution.
- Implement-time verifier and hollow messaging unchanged — rules out re-tuning `contract_miss` at implement in this slice.
- v1 `validateDraftOutput` out of scope — rules out v1 parity here (cf. unsatisfiable-AC v2 deferral).
- Out of scope: multiline-title resolution and extension-tolerance algorithm changes (shipped #2696).

## Acceptance criteria

- [ ] A staged plan draft whose mutation-checkpoint criterion names no enclosing test (or names a title absent from the resolved pinning file) settles `contract_miss` with `failureReason` naming the criterion and the missing or unresolvable title; a regression in `write.test.ts` fails against advisory-only behavior.
- [ ] A staged plan draft whose mutation-checkpoint criteria all name resolvable enclosing tests in their pinning files passes plan-draft validation with no finding; a regression in `write.test.ts` fails against the pre-fix code.
- [ ] Mutation checkpoint: a `// @mutate` directive inside the named pinning test disabling the criterion-names-enclosing-test check turns the `write.test.ts` enclosing-test rejection regression RED.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v1/docs/spec-guidance.md` § Mutation-checkpoint criteria — criterion MUST name its enclosing test (enforced at plan-draft, not guidance-only).
- `v2/docs/operator-runbook.md` § Gate trust — plan-draft rejects a mutation-checkpoint criterion that names no resolvable enclosing test; implement-time hollow is caught at plan time.

## Prerequisites

- `linkDirectivesToCriterion` links a `// @mutate` directive to a criterion only when the criterion text contains the directive's pin title (case-sensitive `includes`, no all-directives-in-file fallback).
- Pinning-test resolution tolerates multiline `test.each` continuation titles and basename extension mismatch among `.ts`/`.tsx`/`.js`/`.jsx` (`mutation-checkpoint-pin-resolution`).
- Mutation-checkpoint criteria authoring guidance requires the enclosing `test()` title in the criterion (`mutation-checkpoint-criterion-enclosing-test-docs`).
- Plan-draft `validatePlanDraft` propagates structured rejection reasons through `composePlanDraftArtifactCheck` (`propagate-plan-draft-normalizer-reason`).
