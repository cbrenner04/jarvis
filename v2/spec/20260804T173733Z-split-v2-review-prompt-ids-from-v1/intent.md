---
name: split-v2-review-prompt-ids-from-v1
---

# v2 implement review renders its own review prompt artifacts

## Problem

`prompts/patch/review-{adversary,advocate,adjudicator}.md` are rendered by both engines: v1 via
`v1/src/modes/patch/prompt.ts` and v2 via `PATCH_REVIEW_DEBATE_ROLE_PROMPT_IDS` in
`shared/prompts/review-implement.ts`. They supply different `BRANCH_DIFF` payloads — v1 sends
`getBranchDiffSummary` (`--stat` plus paths), v2 sends a merge-base unified diff — so prose accurate
for one engine is wrong for the other. Three of four v2 roles still say the payload is "not a
unified diff" while receiving one, because fixing the prose would make v1's prompts lie. Every
future v2-only review change hits the same wall.

`prompts/patch/review-critic.md` (id `patch.prompt.review.critic`) is v2-only already — v1 never
renders it — but it shares the same registry and the same stale "not a unified diff" prose, so it
should be split and corrected alongside the other three roles rather than left inconsistent with
them.

`revision:` does not resolve this: `registry.ts` parses it but nothing selects a variant by it.
Prompts are keyed by `id`, one artifact per id.

## Decisions

- Register v2-owned artifacts under distinct ids and point the v2 render path at them; v1 keeps its existing ids and files untouched — uses the registry as it already works (manifest plus id lookup).
- Rules out revision-based selection in the registry: selection machinery pays off with several live revisions per id, not with one engine permanently diverging.
- Duplication is intended, not debt: v1 is maintenance-only and should stay frozen while v2 evolves.
- Split all four roles (critic included) so v2 owns a complete set, even though v1 never renders the critic.
- Correct the v2 debate prose in the same change so all four roles describe the merge-base unified diff they actually receive.
- Leave `prompts/patch/review.md` alone; it has no consumer.
- Rules out changing v1's `getBranchDiffSummary` or its call sites.

## Acceptance criteria

- [ ] v2 implement review renders v2-owned artifacts for critic, adversary, advocate, and adjudicator; v1 renders its existing artifacts unchanged.
- [ ] All four v2 role prompts describe the payload as a merge-base unified diff; no v2 prompt says "not a unified diff".
- [ ] v1's rendered review prompts are byte-identical to before the change.
- [ ] New artifacts are registered in `prompts/registry.txt`; a test fails when a v2 review id is missing from the manifest.
- [ ] A test renders both engines' review prompts and asserts they diverge as intended; it fails against the pre-split code.

## Documentation updates

- `v2/docs/workflow-runner.md` — v2 owns its review prompt artifacts.
- `v2/docs/v1-behaviors.md` — record the prompt-id split and that v1's prompts are frozen.

## Prerequisites

- v2 implement review supplies a merge-base unified diff as `BRANCH_DIFF`
