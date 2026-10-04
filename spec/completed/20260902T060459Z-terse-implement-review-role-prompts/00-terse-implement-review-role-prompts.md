# Terse implement review role prompt bodies

## Problem

Implement debate and light review roles (`prompts/implement/review-*.md`) are byte-level copies of `prompts/patch/review-*.md` except title and one diff-description paragraph, held apart only by `shared/prompts/review-prompt-divergence.test.ts`. They carry the same verbose delimiter explanations and long identify lists as patch while rendering on every implement review cycle.

## Decision ledger

- Rewrite all four `implement.prompt.review.*` registry bodies in the intent-family terse style (terse role header, bare data blocks, short Rules); rules out retaining patch-parity verbose skeletons on the v2 implement path.
- Compress each role's instruction list to what that role uniquely owns (adversary: findings; advocate: per-finding response; adjudicator: self-contained outcome verdict; critic: light-path outcome verdict); rules out duplicating adversary identify lists in critic.
- Preserve load-bearing contracts: critic and adjudicator self-contained-verdict and empty-verdict semantics, all roles' read-only boundaries, and merge-base unified-diff `BRANCH_DIFF` prose distinct from patch summary-only wording; rules out collapsing implement back onto patch ids or prose.
- Leave `prompts/patch/review-*.md` untouched; rules out churning frozen v1 surface.
- Leave frontmatter `id`, `placeholders`, `behavior`, `kind`, profile wiring, and `shared/prompts/review-implement.ts` render path unchanged; rules out coupling the prose diet to harness changes.
- Pin pre-rewrite body lengths as constants and require each rewritten body to be strictly shorter; rules out silent prompt growth or length-neutral rewrites that only reshuffle verbosity.
- Retain `shared/prompts/review-prompt-divergence.test.ts` patch-vs-implement branch-diff divergence pin; tighten only if an assertion becomes meaningless after the rewrite; rules out deleting the split guard.

## Pre-rewrite body length baselines

Artifact body bytes after frontmatter (`registry.getById(...).body.length`, measured at spec draft time):

- `implement.prompt.review.critic`: 1842
- `implement.prompt.review.adversary`: 1627
- `implement.prompt.review.advocate`: 1792
- `implement.prompt.review.adjudicator`: 2433

## Tasks

- Add `shared/prompts/review-implement-growth-budget.test.ts` exporting per-role baseline constants; add test `implement review role body growth stays within budget` asserting each registry `body.length` is strictly less than its baseline, and test `implement review role placeholders unchanged` asserting each role's frontmatter `placeholders` array is byte-identical to the pre-rewrite declaration.
- Add `shared/prompts/review-implement-contract-preservation.test.ts` with test `implement review role contract substrings preserved` asserting critic and adjudicator self-contained-verdict and empty-verdict semantics, read-only boundaries on all four roles, merge-base unified-diff prose on adversary/advocate/adjudicator/critic, and critic absence of adversary-style identify lists; it fails against the pre-fix prompts when a contract substring is removed or adversary lists are reintroduced in critic.
- Wire `shared/prompts/review-implement-growth-budget.test.ts` and `shared/prompts/review-implement-contract-preservation.test.ts` in `shared/prompts/render-observer-tests.ts` for each changed `prompts/implement/review-*.md`.
- Rewrite `prompts/implement/review-adversary.md` body to intent-family terse shape; drop repeated "The text between …" delimiter explanations; keep adversary-specific finding obligations only; bump `revision`.
- Rewrite `prompts/implement/review-advocate.md` body likewise; keep per-finding response obligations only; bump `revision`.
- Rewrite `prompts/implement/review-adjudicator.md` body likewise; keep self-contained verdict and empty-verdict obligations; bump `revision`.
- Rewrite `prompts/implement/review-critic.md` body likewise; keep light-path outcome verdict scope without adversary-style identify lists; bump `revision`.
- Retain `shared/prompts/review-prompt-divergence.test.ts` patch-vs-implement branch-diff divergence assertions; adjust only if an assertion no longer applies after the rewrite.

## Acceptance criteria

- [x] `shared/prompts/review-implement-growth-budget.test.ts` test `implement review role body growth stays within budget` measures each `implement.prompt.review.*` registry `body.length` (post-frontmatter body bytes) and asserts strictly less than its pinned pre-rewrite baseline; it fails against the pre-fix prompts.
- [x] `shared/prompts/review-implement-growth-budget.test.ts` test `implement review role placeholders unchanged` asserts each `implement.prompt.review.*` frontmatter `placeholders` array matches the pre-rewrite declaration; it fails when any binding changes.
- [x] `shared/prompts/review-implement-contract-preservation.test.ts` test `implement review role contract substrings preserved` fails against the pre-fix prompts when critic or adjudicator self-contained-verdict or empty-verdict semantics, any role's read-only boundary, merge-base unified-diff prose on debate/critic roles, or critic editorial scope (no adversary-style identify lists) is removed.
- [x] `shared/prompts/review-prompt-divergence.test.ts` still proves patch and implement registry bodies diverge on branch-diff prose; removing an assertion fails against the pre-fix test.
- [x] `shared/prompts/review-implement.test.ts` stays green.
- [x] `shared/prompts/review-profile.test.ts` stays green.
- [x] `shared/prompts/registry.test.ts` stays green.
- [x] `bun run typecheck` passes.
- [x] `bun run test:shared` passes.
- [x] `bun run test:integration:shared` passes.
- [x] `bun run test:v1` passes.
- [x] `bun run test:integration:v1` passes.
- [x] `bun run test:v2` passes.
- [x] `bun run test:integration:v2` passes.

## Documentation updates

None — prompt ids, placeholders, profile wiring, and render path are unchanged; load-bearing review contracts are preserved in template bodies and pinned by contract-preservation tests.
