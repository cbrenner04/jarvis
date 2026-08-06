---
name: plan-review-hollow-pin-criterion
---

# Plan review flags mutation-checkpoint criteria that omit the enclosing test name

A mutation-checkpoint criterion that names only the pinning file and directive — not the enclosing test title — will go `hollow` at implement time even when the `// @mutate` directive is correct. Plan review should surface that risk at plan time, not after implement runs burn.

## Decisions

- Plan debate review gains a hollow-pin pass for mutation-checkpoint criteria: flag a criterion whose text names no plausible enclosing test title (heuristic: no backticked/quoted test-name-like token beyond the pinning file and directive) as an at-risk hollow pin — rules out discovering the referential miss only at implement time.
- Hollow-pin pass lands on plan debate review roles in `shared/prompts/review-plan.ts`, not the intent-split prompt — independent of `plan-review-must-falsify-guard-premises` (same seam; serial sibling ordering against that seed). Rules out duplicating the check in the wrong seam or blocking on the falsify-guard seed landing first.
- Out of scope: reintroducing the all-directives-in-file fallback.

## Acceptance criteria

- [ ] `shared/prompts/review-plan-hollow-pin.test.ts` feeds a mutation-checkpoint criterion that names no enclosing test (only the pinning file + directive) and asserts plan review flags an at-risk hollow pin; a well-formed criterion does not trip it; fails against the pre-fix review roles.
- [ ] Mutation checkpoint: a `// @mutate` directive disabling the plan-review hollow-pin heuristic turns the regression RED; pin via a unique-basename test, naming the enclosing test.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- None — authoring and operator guidance ship in `mutation-checkpoint-criterion-enclosing-test-docs`.

## Prerequisites

- `linkDirectivesToCriterion` links a `// @mutate` directive to a criterion only when the criterion text contains the directive's pin title (no all-directives-in-file fallback).
- Mutation-checkpoint criteria authoring guidance requires including the directive's pin title in the criterion (verbatim or linker-matching substring).
- Plan debate review step (`review-plan` prompt/roles) runs over drafted spec files.
