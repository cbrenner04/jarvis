---
name: terse-implement-review-role-prompts
---

# Terse implement review role prompts

## Problem

Implement debate and light review roles (`prompts/implement/review-*.md`) are byte-level copies of `prompts/patch/review-*.md` except title and one diff-description paragraph, held apart only by `shared/prompts/review-prompt-divergence.test.ts`. They carry the same verbose delimiter explanations and long identify lists as patch while rendering on every implement review cycle.

## Decision ledger

- Rewrite all four `implement.prompt.review.*` role bodies in the intent-family terse style; rules out retaining patch-parity verbose skeletons on the v2 implement path.
- Compress each role's instruction list to what that role uniquely owns; rules out duplicating adversary lists in critic.
- Preserve load-bearing contracts: self-contained-verdict and empty-verdict semantics, read-only/write boundaries, and merge-base unified-diff branch-diff prose distinct from patch summary-only wording; rules out collapsing implement back onto patch ids or prose.
- Leave `prompts/patch/review-*.md` untouched; rules out churning frozen v1 surface.
- Update `shared/prompts/review-prompt-divergence.test.ts` to whatever assertions remain meaningful after the rewrite; rules out deleting the patch-vs-implement split pin.
- Record pre-rewrite body lengths and pin each rewritten body below its baseline; rules out silent prompt growth.

## Acceptance criteria

- [ ] `shared/prompts/review-implement.test.ts` and `shared/prompts/review-prompt-divergence.test.ts` stay green with unchanged `implement.prompt.review.*` placeholder declarations.
- [ ] Rewritten implement adjudicator and critic bodies still contain self-contained-verdict, empty-verdict, and read-only boundary contract substrings; implement adversary, advocate, and adjudicator still carry merge-base unified-diff prose and not summary-only patch wording; regressions fail against the pre-fix prompts.
- [ ] `shared/prompts/review-prompt-divergence.test.ts` still proves patch and implement registry bodies diverge on branch-diff prose; removing an assertion fails against the pre-fix test.
- [ ] A growth-budget test records each implement review role's pre-rewrite body length and asserts the rewritten body is strictly smaller; it fails when a body is not shortened.
- [ ] `bun run typecheck`, `bun run test:v1`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

## Prerequisites

- Plan review role prompts are rewritten in intent-family terse style with load-bearing contracts preserved.
