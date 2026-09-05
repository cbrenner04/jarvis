# Re-key shared/prompts/review-implement-growth-budget.test.ts

## Problem

Rows `shr-rigb-body-baselines` and `shr-rigb-role-placeholders` anchor growth and placeholder invariants to hand-maintained baseline maps and frontmatter string literals instead of registry artifact metadata.

## Decision ledger

- Body-length ceilings derive from committed baseline exports co-located with the test (`IMPLEMENT_REVIEW_*_BASELINE_BODY_LENGTH`) compared against `registry.getById(id).body.length`, not duplicated numeric literals inside a private map only; rules out a second baseline table that drifts from the exported constants.
- Placeholder expectations derive from each artifact's committed frontmatter via a shared reader that throws on missing fields, not a hand-maintained `IMPLEMENT_REVIEW_ROLE_PLACEHOLDERS` map; rules out literal placeholder strings duplicated only in the test.
- Frontmatter field extraction routes through shared loud-failure marker slicing; rules out `readPlaceholdersField` returning silently when frontmatter delimiters move.

## Task checklist

- [ ] Re-key audit rows `shr-rigb-body-baselines` and `shr-rigb-role-placeholders` per the decision ledger.
- [ ] Replace local frontmatter parsing with shared loud-failure locators.

## Acceptance criteria

- [ ] `shared/prompts/review-implement-growth-budget.test.ts` test `implement review role body growth stays within budget` compares registry body lengths against the exported baseline constants without a duplicated private baseline map; it fails against the pre-fix `IMPLEMENT_REVIEW_ROLE_BASELINES` object literal and passes after re-key.
- [ ] `shared/prompts/review-implement-growth-budget.test.ts` test `implement review role placeholders unchanged` reads placeholders from each artifact's committed frontmatter via a loud-failure helper rather than a hand-maintained expected map; it fails against the pre-fix `IMPLEMENT_REVIEW_ROLE_PLACEHOLDERS` literal map and passes after re-key.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:shared` passes.
- [ ] `bun run test:integration:shared` passes.

## Documentation updates

None — locator contract is pinned by tests and adopted by later surface intents.
