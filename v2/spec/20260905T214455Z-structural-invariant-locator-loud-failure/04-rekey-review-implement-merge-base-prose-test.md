# Re-key shared/prompts/review-implement.test.ts merge-base prose pins

## Problem

Row `shr-ri-merge-base-prose` pins merge-base unified-diff provenance to hand-maintained substring lists and a one-way `.not.toContain("not a unified diff")` guard (`vacuous-pass-risk: yes`).

## Decision ledger

- Merge-base provenance phrases are asserted via a shared committed marker set used across implement review rendering tests, not duplicated literals only in this file; rules out marker strings that can drift from the prompt template corpus.
- `.not.toContain("not a unified diff")` pairs with a presence check that implement bodies include merge-base unified-diff wording; rules out one-way absence that passes when rendered output is empty.
- Branch-diff extraction for critic and debate roles uses shared loud-failure marker slicing for bounded diff regions; rules out local extractors that return empty strings when diff markers move.

## Task checklist

- [ ] Re-key audit row `shr-ri-merge-base-prose` in case `renderPatchReviewCriticPrompt branch diff > renders stat, changed paths, and merge-base unified diff for critic and debate roles`.
- [ ] Route diff-region extraction through `shared/structural-test-locator.ts` where markers bound rendered output.

## Acceptance criteria

- [ ] `shared/prompts/review-implement.test.ts` test `renders stat, changed paths, and merge-base unified diff for critic and debate roles` derives merge-base provenance markers from a shared source-of-truth constant and pairs `.not.toContain("not a unified diff")` with implement merge-base presence checks; it fails against the pre-fix one-way substring pins (`vacuous-pass-risk: yes` on audit row `shr-ri-merge-base-prose`) and passes after re-key.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:shared` passes.
- [ ] `bun run test:integration:shared` passes.

## Documentation updates

None — locator contract is pinned by tests and adopted by later surface intents.
