# v1 and v2 share review prompt artifacts, so neither can edit them

## Problem

`prompts/patch/review-{adversary,advocate,adjudicator}.md` are rendered by **both** engines:
v1 at `v1/src/modes/patch/prompt.ts:148` and v2 through
`PATCH_REVIEW_DEBATE_ROLE_PROMPT_IDS` in `shared/prompts/review-implement.ts`. The two supply
different payloads for the same `BRANCH_DIFF` placeholder — v1 sends `getBranchDiffSummary`
(`--stat` plus paths), v2 is moving to a merge-base unified diff — so prose that is accurate for one
engine is wrong for the other.

The result is already visible. `implement-review-supplies-unified-diff` had to leave three of four
review roles reading "the text between `<<<DIFF_BEGIN>>>` and `<<<DIFF_END>>>` is a branch change
summary … **not a unified diff**" while actually receiving a unified diff, because correcting the
prose would have made v1's prompts lie instead. Only the critic
(`patch.prompt.review.critic`, which v1 never renders — its only critic reference is the unrelated
`plan.prompt.review.critic`) could be updated.

`revision:` in the frontmatter does not help: `registry.ts:109` parses and stores it, but **nothing
reads it to select a variant**. Prompts are keyed by `id`, one artifact per id, seeded from
`prompts/registry.txt`. It is a change marker, not a version selector.

This will recur. Every v2-only review change — corrected prose, a verification command the reviewer
may call (`reviewer-verification-command`), execution permissions
(`review-roles-are-forbidden-from-verifying`) — hits the same wall.

## Decisions

- Register v2-specific artifacts under distinct ids (e.g. `patch.prompt.review.adversary.v2`) and
  point `PATCH_REVIEW_DEBATE_ROLE_PROMPT_IDS` at them; v1 keeps its existing ids and files
  untouched. Uses the registry as it already works — a manifest plus id lookup.
- Rules out adding revision-based selection to the registry: selection machinery pays off with
  several live revisions per id, and this is one engine permanently diverging from another, not
  drift to be reconciled.
- Treat the duplication as intended, not as debt: v1 is maintenance-only and v2 is primary, so v1's
  prompts *should* be frozen while v2's evolve. Splitting makes that explicit instead of coupling
  two engines through a file neither can safely edit.
- Correct the v2 debate prose in the same change, so all four roles describe the payload they
  actually receive.
- Leave the unwired `prompts/patch/review.md` alone; it has no consumer.
- Rules out changing v1's `getBranchDiffSummary` or its call sites.

## Acceptance criteria

- [ ] v2 implement review renders v2-owned artifacts for critic, adversary, advocate, and
      adjudicator; v1 renders its existing artifacts unchanged.
- [ ] All four v2 role prompts describe the payload as a merge-base unified diff; no v2 prompt says
      "not a unified diff".
- [ ] v1's rendered review prompts are byte-identical to before the change.
- [ ] New artifacts are registered in `prompts/registry.txt`, and a test fails if a v2 review id is
      missing from the manifest.
- [ ] Coverage renders both engines' prompts and asserts they diverge as intended.
- [ ] `bun run typecheck`, `test:v1`, `test:v2` pass.

## Documentation updates

- `v2/docs/workflow-runner.md` — v2 owns its review prompt artifacts.
- `v2/docs/v1-behaviors.md` — record the prompt-id split and that v1 prompts are frozen.
